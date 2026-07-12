# Auto-Capture Events — Design

**Date:** 2026-07-11
**Status:** Approved (design), pending implementation plan

## Summary

Automatically record play as it happens. When the GM **activates a map**, the
module creates (or reuses) a **Place** for that scene and adds a fresh
**timepoint** to the end of the timeline for the visit. When the GM **begins a
combat**, the module creates an **Encounter**, keeps its participant list in
sync while the fight runs, and writes an outcome summary (who died, was injured,
or fled) when the combat ends. Every auto-created record lands in a single
**target Campaign Record** chosen by a world setting.

## Goals

- Turn two routine GM actions (activate scene, begin combat) into timeline
  entries with no manual bookkeeping.
- Keep the Encounter's participants and outcome faithful to what actually
  happened at the table.
- Make the destination (target group) discoverable and changeable by anyone,
  from the Hub.

## Non-goals

- No auto-capture for record types other than Place and Encounter.
- No attempt to detect combat outcomes in systems that do not expose HP the
  common way — injuries degrade gracefully, deaths rely on the core "defeated"
  marker.
- No retroactive capture of scenes activated / combats run before the feature
  (or its target) existed.

## Architecture

A self-contained **auto-capture subsystem** following the existing
`logic/` (pure, testable) + `hooks/` (Foundry wiring) split:

| File | Responsibility |
| --- | --- |
| `scripts/logic/auto-capture.mjs` | Pure functions, no Foundry globals: `collapseParticipants`, `summarizeOutcome`, `pickLatestTimepoint`, `matchPlaceForScene`. Unit-tested with vitest. |
| `scripts/hooks/auto-capture.mjs` | Registers the Foundry hooks, single-writer guarded; orchestrates logic + `data/timepoints.mjs` + `data/groups.mjs`. |
| `scripts/settings/auto-target.mjs` | Registers the target-group world setting; get/set helpers with socket relay. |
| `templates/hub/header.hbs`, `scripts/apps/hub/hub-mixin.mjs` | Gear menu that absorbs Import / Export / Edit-in-place and adds the target selector. |

Registration is wired from `scripts/campaign-record.mjs` (a
`registerAutoCapture()` in `init`/`ready`, alongside the existing registrations).

### Single-writer guard

Foundry fires document hooks on **every** connected client. All auto-capture
handlers early-return unless the current user is the active GM:

```js
if (game.user !== game.users.activeGM) return;
```

so exactly one client performs each write and multi-GM worlds never double up.

## Feature 1 — Map activation → Place + timepoint

**Trigger:** `updateScene` where `changes.active === true`.

1. Resolve the target group (see *Target-group setting*). If none, do nothing —
   the feature is dormant until a target exists.
2. `matchPlaceForScene(group, scene.uuid)` — find an existing `place` page in the
   target group whose `system.scene === scene.uuid`. Create one only if absent:
   - `name`: scene name
   - `placeType`: `"poi"` (schema default)
   - `scene`: `scene.uuid`
3. **Always** append a timepoint via `addTimepoint(group, scene.name)` and attach
   the Place to it. Revisiting a location therefore yields a new end-of-timeline
   timepoint each activation, while the Place record itself is reused.

## Feature 2 — Combat lifecycle → Encounter

The Encounter is created at combat start, kept current while the fight runs, and
summarized at the end. The link between a Combat and its Encounter is a flag on
the Combat document: `combat.flags.campaign-record.encounterUuid`.

### 2a. Begin Combat — `combatStart`

1. Resolve the target group. If none, do nothing.
2. Ensure a Place for `combat.scene`:
   - If a Place already exists for that scene (the common case — activation made
     it), reuse it and its **latest** timepoint (`pickLatestTimepoint`).
   - If no Place exists (activation auto-add was off, or combat runs on a
     non-active scene), create the Place **and** a new end-of-timeline timepoint,
     exactly as activation would.
3. Create an Encounter page in the target group:
   - `name`: `Combat at <scene name>`
   - `scene`: `combat.scene.uuid`
   - `combatants`: participants collapsed by actor (see below)
   - attached to the resolved timepoint (`system.timepoints`).
4. Stamp `combat.flags.campaign-record.encounterUuid` with the new page's UUID.

**Participant collapsing (`collapseParticipants`):** group combatants sharing the
same actor UUID into a single row with `count = N`; unique actors and PCs stay at
count 1. Combatants without an actor group by name. Row shape matches the
existing schema: `{ id, name, count, actor }`.

### 2b. Roster changes — `createCombatant` / `updateCombatant` / `deleteCombatant`

Only act when the combat carries our `encounterUuid` flag.

- **Adds / changes:** recompute current per-actor counts and update the Encounter
  as an **element-wise max** per actor — the list is additive and never shrinks.
  A combatant who appears mid-fight is added; increased counts sync up.
- **Removals:** do **not** shrink the Encounter (participation is historical).
  Record the departed actor and whether it was defeated at that moment into
  `combat.flags.campaign-record.departed` (`[{ actorUuid, name, defeated }]`), so
  the end summary can distinguish *fled* from *died*.

### 2c. Combat end — `deleteCombat`

If the deleted combat has no `encounterUuid` flag (combat never begun), no-op.
Otherwise resolve the Encounter page and write `summarizeOutcome` to
`encounter.system.outcome`:

- **Died** — present combatants marked defeated (`combatant.isDefeated`), plus
  departed entries recorded as defeated.
- **Fled** — departed entries recorded as *not* defeated (and not otherwise dead).
- **Injured** — present, not defeated, best-effort HP read
  (`actor.system?.attributes?.hp`) with `value < max` and `value > 0`. Silently
  omitted when the system does not expose HP that way.

`summarizeOutcome` is pure: it takes the resolved participant/departed state
(name, defeated flag, optional `{value, max}` HP) and returns the summary string,
so all three buckets and the HP-missing degradation are unit-testable.

## Target-group setting

- World setting `autoCaptureTargetGroup`: a group `JournalEntry` id, or empty
  string = dormant. `config: false` — edited only through the Hub gear menu.
- **Editable by anyone:** Foundry world settings are GM-write-only, so a non-GM
  change is relayed over the module's existing socket to `game.users.activeGM`,
  who applies `game.settings.set`. If no GM is connected, the change cannot
  persist and the user is notified.
- **New group becomes the target:** `createGroup` sets the setting to the new
  group (directly when GM, via relay when a player).
- **Resolution:** a missing or stale id (target deleted) resolves to "none",
  leaving the feature dormant rather than erroring.

## Hub gear menu

The three loose header buttons (Import, Export, Edit-in-place toggle) move into a
single gear-icon dropdown; the group picker `select` stays in place.

```
⚙ ▾
 ├ Import…              (GM-gated as today)
 ├ Export…
 ├ ☑ Edit in place      (toggle, reflects current state)
 ├──────────
 └ Auto-capture target: [ ▾ Campaign Record | None ]
```

The target selector lists every group plus a "None" option and writes the
setting via the relay path above.

## Edge cases

- **No target group:** all triggers no-op (dormant feature).
- **Stale target id:** resolves to none; feature dormant.
- **Multi-GM:** single-writer guard ensures one writer.
- **Combat created but never begun:** no Encounter, so `deleteCombat` is a no-op.
- **Combat on a non-activated scene:** fallback creates Place + timepoint.
- **Re-activating the same map:** Place reused, new timepoint added each time.
- **System without HP:** deaths still detected via defeated marker; injuries
  omitted.
- **No GM online when a player changes the target:** notify; change not persisted.

## Testing

- **vitest** (pure logic in `logic/auto-capture.mjs`): participant collapsing
  (grouping, counts, actor-less rows); outcome summarization (died / fled /
  injured buckets, HP-missing degradation, empty combat); `matchPlaceForScene`;
  `pickLatestTimepoint`.
- **quench** integration (hook wiring): activate scene → Place + timepoint;
  `combatStart` → Encounter attached to the Place's latest timepoint;
  `deleteCombat` → outcome written; roster add → participant synced.
