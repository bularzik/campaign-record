# Auto-encounter capture for theater-of-the-mind combat

**Date:** 2026-07-14
**Status:** Design approved, pending spec review

## Problem

The `combatStart` auto-capture handler creates an Encounter entry and attaches
it to a timepoint when combat begins. It resolves the combat's scene as
`combat.scene ?? game.scenes.active` (the latter handling Foundry v13's
unlinked-by-default combats). When **neither** is present — a theater-of-the-mind
combat with no active scene — the handler currently returns without doing
anything, so no Encounter is captured.

We want that case handled too: with no scene, create a **new timepoint** and
attach the auto-created Encounter to it, so the fight still lands on the
campaign timeline.

## Scope

- Applies only to the `combatStart` auto-capture path in
  `scripts/hooks/auto-capture.mjs`.
- The scene-based path (Place + its timepoint, `scene` set on the Encounter) is
  unchanged.
- The other combat lifecycle hooks (`createCombatant`/`updateCombatant` roster
  sync, `deleteCombatant` departure notes, `deleteCombat` outcome summary) are
  unchanged — they key off the `ENCOUNTER_FLAG`, not the scene, so they already
  work for a scene-less Encounter once it exists.

## Behavior

On `combatStart`, for the active GM with an auto-capture target group:

1. Resolve `scene = combat.scene ?? game.scenes.active ?? null`.
2. Collapse the live roster into counted combatant rows (unchanged).
3. **If a scene resolved** (existing behavior):
   - `ensurePlaceForScene(group, scene, { createTimepoint: false })` → the
     scene's Place and its timepoint id.
   - Encounter name = `"Combat at {scene}"`; `system = { scene: scene.uuid,
     combatants }`.
4. **If no scene resolved** (theater of the mind — new behavior):
   - Build a label from today's date:
     `"Combat on {date}"` where `{date}` = `new Date().toLocaleDateString()`.
   - Create a **new** timepoint with that label via `addTimepoint(group, label)`
     (always new — never reuse the newest existing timepoint). `campaignDate` is
     left `null` for the GM to set later.
   - Encounter name = the same `"Combat on {date}"` label; `system = {
     combatants }` (no `scene` key).
5. **Shared tail** (both paths): create the Encounter
   `JournalEntryPage` (`type: typeId("encounter")`), `addLink` it to the
   resolved timepoint, and `combat.setFlag(ENCOUNTER_FLAG, encounter.uuid)`.

### Guard ordering

The target-group check moves **before** scene resolution (there is no reason to
resolve a scene we cannot use), and the previous `if (!scene) return`
early-exit is replaced by the theater-of-the-mind branch.

## Architecture

Approach: **branch inside the `combatStart` handler** (Approach A). All combat
capture logic stays in one place; the two branches differ only in how they
obtain `timepointId` and in the Encounter's `name`/`system`, then converge on a
shared tail. No new module or helper is introduced:

- Rejected — extending `ensurePlaceForScene` to accept a null scene: that
  function's single purpose is matching/creating a *Place* for a scene, and
  there is no Place without a scene; overloading it muddies that boundary.
- Rejected — a dedicated `ensureScenelessTimepoint` helper: it would be a
  one-line wrapper over `addTimepoint` with a single caller. Extract later only
  if the branch grows.

## Data

The scene-less Encounter omits `system.scene`. `EncounterModel.scene` is a
nullable `DocumentUUIDField`, so this is the same shape as a manually-created
Encounter with no scene — the Encounter sheet and view already render that case.

## i18n

One new key in `lang/en.json` under `CAMPAIGNRECORD.AutoCapture`:

- `EncounterNameNoScene`: `"Combat on {date}"`

Used for **both** the Encounter page name and the new timepoint's label. The
existing `EncounterName` (`"Combat at {scene}"`) is unchanged.

## Error handling

Unchanged from the existing handler — no `try/catch`; Foundry logs errors thrown
from hook callbacks. The new path introduces no new failure modes: `addTimepoint`
and `addLink` are the same primitives the scene path and the shared-media capture
already rely on.

## Testing

Extend `tests/e2e/25-auto-capture-engine.spec.mjs` with a theater-of-the-mind
case (the scene-based path stays covered by the existing case):

1. Ensure **no active scene**: deactivate any active scene so
   `game.scenes.active` is null.
2. Create an **unlinked** combat (`Combat.create({})`), add a combatant, and
   `startCombat()`.
3. Assert:
   - a new timepoint was created (timeline count grew, label matches
     `"Combat on …"`);
   - the Encounter was created with `system.scene` empty/null;
   - the Encounter is attached to that new timepoint
     (`timepointsForRecord(...) > 0`);
   - the shared tail still works — roster growth and the end-of-combat outcome
     summary behave as in the scene case.

Restore scene-activation state as needed so the suite (serial, single worker)
remains order-independent.

## Out of scope

- Reusing an existing timepoint for a scene-less combat (design decision:
  always create a new one).
- Setting `campaignDate` automatically (left blank for the GM).
- Any change to the scene-based capture path or the other combat lifecycle hooks.
