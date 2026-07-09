# Actor Picker (Drag-Free Linking for Players) — Design

**Date:** 2026-07-09
**Branch:** `main` (implemented directly; this spec written retroactively to
document the shipped design)
**Status:** Implemented

## Problem

Core Foundry gates dragging Actors out of the sidebar on the **Create Token**
permission (`TOKEN_CREATE`, Assistant GM by default). Campaign Record's NPC,
PC, and Encounter sheets link actors via drag-and-drop, so a regular Player —
who can otherwise edit records freely under the module's collaborative
defaults — has no way to link an actor at all. The drop hint ("Drop an Actor
here to link it") points at an action the player physically cannot perform.

Relatedly, the README did not explain the two permission gates players hit:
actor dragging (`TOKEN_CREATE`) and group creation (`JOURNAL_CREATE`, Trusted
Player by default).

## Design

### 1. Picker prompt — `scripts/apps/actor-picker.mjs` (new)

`promptSelectActor()`: a `DialogV2.prompt` with a `<select>` of every actor
the current user can see (`game.actors.filter((a) => a.visible)`), sorted by
name, values are actor UUIDs. Resolves to the chosen UUID, or `null` on
cancel (`rejectClose: false`). If the user can see no actors, warn
(`CAMPAIGNRECORD.Warning.NoActorsToLink`) and resolve `null`.

Visibility filtering reuses Foundry's own `Document#visible` (Limited+ — the
same test the sidebar directory uses), so the picker offers exactly the
actors the sidebar shows and can never offer one the sidebar would hide.

### 2. Sheet action — `scripts/sheets/base-record-sheet.mjs`

New `linkActor` action on `BaseRecordSheet`: await the picker, and on a
non-null UUID feed `this._onDropDocument({ type: "Actor", uuid })` — the
exact payload a sidebar drag produces. The picker is a drag-free front end to
the existing drop pipeline; no per-sheet linking logic is duplicated, and any
sheet-specific validation in `_onDropDocument` applies unchanged.

### 3. Button placement — templates

A **Link Actor** button (`data-action="linkActor"`) is added to the edit
templates of exactly the sheets whose `_onDropDocument` accepts Actors:

- `templates/npc/edit.hbs` — beside the actor-link drop zone
- `templates/pc/edit.hbs` — beside the actor-link drop zone
- `templates/encounter/edit.hbs` — beside Add Combatant

Shop/Item (Item drops), Loot (Encounter-page drops), and Place (Scene drops)
are deliberately untouched.

### 4. i18n — `lang/en.json`

New keys: `CAMPAIGNRECORD.LinkActor` (button/dialog title),
`CAMPAIGNRECORD.SelectActor` (field label), `CAMPAIGNRECORD.Link` (confirm
button), `CAMPAIGNRECORD.Warning.NoActorsToLink`.

### 5. README — permissions model

Document both player-facing permission gates: why players can't drag actors
(and that Link Actor is the alternative), and why regular Players don't see
the Create Campaign Group button (`JOURNAL_CREATE` defaults to Trusted), with
the settings path to change it.

## Out of scope

- No new permission checks: whether the link *saves* is still governed by the
  record's ownership, exactly as for a drag by a more privileged user.
- No picker for Items/Scenes (players can drag those; no core gate applies).
- No search/filter inside the picker — a plain select is enough at typical
  world actor counts.

## Files touched

| File | Change |
| --- | --- |
| `scripts/apps/actor-picker.mjs` | New: `promptSelectActor()` DialogV2 prompt |
| `scripts/sheets/base-record-sheet.mjs` | `linkActor` action feeding `_onDropDocument` |
| `templates/npc/edit.hbs`, `templates/pc/edit.hbs`, `templates/encounter/edit.hbs` | Link Actor button |
| `lang/en.json` | Four new keys |
| `README.md` | Permissions-model section: TOKEN_CREATE and JOURNAL_CREATE gates |
| `tests/e2e/19-actor-picker.spec.mjs` | New: player-role picker coverage |

## Error handling

- No visible actors → localized warning, no dialog, no-op.
- Dialog cancelled/closed → resolves `null`, no-op.
- Actor names are `escapeHTML`-ed before interpolation into the option list.

## Testing

- E2E (`tests/e2e/19-actor-picker.spec.mjs`, run as **User 2**, a regular
  Player, against an Observer-visible actor): the picker links an actor to an
  NPC record (`system.actor` set, content-link rendered) and adds a combatant
  to an Encounter record (`system.combatants` row with name + UUID).
- i18n coverage gate (`tests/i18n-coverage.test.js`) verifies the four new
  keys exist in `lang/en.json`.
