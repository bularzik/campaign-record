# Record-overlay & Type-filter fixes — design

**Date:** 2026-07-11
**Branch:** `worktree-record-overlay-and-type-filter-fixes`

## Problem

Four defects/gaps in the campaign hub:

1. **No way to close an open record.** Once a record opens, its overlay covers the
   timeline and there is no dismiss control — only Back/Forward history arrows.
2. **Record content is unreadable in dark mode.** The record-type page templates (NPC,
   PC, Quest, etc.) render light-on-light: the app is dark-themed (light text) but the
   overlay forces a light parchment background.
3. **No way to unlink a linked actor or scene.** Records can link an Actor (NPC/PC) or a
   Scene (Place), but nothing clears the link once set.
4. **Type-filter UI problems.** The expand/collapse rail toggle shares a row with other
   controls; type selection produces chips; and there is no compact summary of the
   active filter.

Items 2 and 3 in the original report ("light background" and "sub-document templates
displaying white") are the **same** root cause and are handled together as item 2 here.

## Scope

Four changes, all in the hub / record-sheet layer. No data-model or migration changes.

---

### 1. Close button on the record overlay

Add an "✕" close button to `record-pane-header`, positioned last so it lands in the
upper-right corner. It renders only when a record is open (`{{#if view}}`).

A new `closeRecord` action in `hub-mixin.mjs` sets `this.state.view = null` and
re-renders, revealing the persistent timeline underneath. This is the same dismiss path
already used internally when a viewed record is deleted or becomes unviewable. Navigation
history (Back/Forward) is left intact.

**Files:** `templates/hub/record.hbs`, `scripts/apps/hub/hub-mixin.mjs`,
`lang/en.json` (tooltip + aria-label), `styles/campaign-record.css` (if spacing needs it).

### 2. Theme fix (readable record content in light and dark)

**Root cause:** `styles/campaign-record.css:552` — `.hub-record.active` hardcodes
`background: var(--color-bg, var(--dnd5e-color-parchment, #ededed))`, a light surface.
Line 663 has the same light fallback (`#e8e6dc`). The module content CSS sets no text
color, so it inherits the app theme's text color. In Foundry dark mode that text is
light, painted on the forced light surface → unreadable. In light mode it happens to work.

**Fix:** Stop forcing a light surface. The overlay must be opaque (it covers the
timeline), so it adopts the app's **themed** content surface — dark in dark mode, light in
light mode — instead of a hardcoded parchment fallback. The two hardcoded light fallbacks
(lines ~552 and ~663) are the targets; the mounted record-sheet surface is adjusted with
them if needed so nested content inherits correctly.

**Acceptance:** Open a record with Foundry in **dark** mode → content readable. Switch
Foundry to **light** mode → still readable. Verified in both **view** and **edit** modes.
This is verified against a running Foundry instance in both themes — module CSS alone
cannot be eyeballed for correctness.

**Files:** `styles/campaign-record.css`.

### 3. Unlink actor / scene

In the edit templates that surface a link — `templates/npc/edit.hbs`,
`templates/pc/edit.hbs`, `templates/place/edit.hbs` — render an **Unlink** button
alongside the existing "Link Actor/Scene" button, shown only when a link exists
(`{{#if enriched.actorLink}}` / `{{#if enriched.sceneLink}}`).

Add `unlinkActor` and `unlinkScene` actions in `base-record-sheet.mjs` that clear the
stored UUID (`system.actor` / `system.scene` → `""`), mirroring the existing
`linkActor`/`linkScene` handlers. `unlinkScene` is a no-op on sheets without a scene field.

**Files:** `scripts/sheets/base-record-sheet.mjs`, `templates/npc/edit.hbs`,
`templates/pc/edit.hbs`, `templates/place/edit.hbs`, `lang/en.json`.

### 4. Type-filter redesign

**a. Rail toggle alone on the top row.** Move `.rail-toggle` out of `.index-controls`
into a new row that is the first child of `.hub-index`, by itself at the top-left. The
collapsed-rail CSS (`campaign-record.css:561-562`), which currently keeps only the
rail-toggle visible, is retargeted to the new row so collapse behavior is preserved.

**b. Replace chips with a checkbox dropdown.** Remove the `.doctype-chip` markup and CSS,
the `removeType`/`clearTypes` chip affordances, and the "Add type…" `<select>`. Replace
with a custom dropdown:

- A **trigger button** (`.doctype-summary`) toggles a popup panel.
- A **panel** (`.doctype-menu`, absolutely positioned within a `position: relative`
  filter container) lists every type as a row: `[checkbox] [icon] Label`. Toggling a
  checkbox adds/removes the type in `state.types` and live-filters the list. The menu
  **stays open** across the resulting `#renderList()` so multiple types can be toggled in
  one interaction — its open state is restored after re-render, mirroring the existing
  index-search focus-restore pattern (`hub-mixin.mjs` ~lines 687–698). Clicking outside
  the filter closes the menu.
- `buildDoctypeFilter` (`scripts/logic/doctype-filter.mjs`) changes from
  `{chips, available, hasSelection}` to `{items: [{type, label, icon, checked}], summary}`.
  It stays pure (label resolver injected) for testability.

**c. Trigger label:**

- **Menu open** → the trigger reads **"All Types"** (serves as the panel header).
- **Menu closed** → a selection summary:
  - nothing checked → **"All types"** (everything shown),
  - one checked → that single label (e.g. **"Journal"**),
  - N (>1) checked → first label + `+(N-1)` (e.g. 3 checked → **"Journal +2"**).
  - First label follows `RECORD_TYPES` order (with `journal` last, as today).
- Edge cases: if every box is checked, the closed label still shows **"All types"** (same
  visible effect as none checked). The `+N` counts the remaining selected types after the
  first (2 checked → "Journal +1", 3 → "Journal +2").

**Files:** `templates/hub/index.hbs`, `scripts/logic/doctype-filter.mjs`,
`scripts/apps/hub/hub-mixin.mjs`, `styles/campaign-record.css`, `lang/en.json`.

---

## Testing

- **Unit (vitest):** `tests/doctype-filter.test.js` updated for the new `{items, summary}`
  model, covering the summary-label cases (none / one / many / all checked).
- **E2E (playwright):** `tests/e2e/15-hub-types.spec.mjs` updated for checkbox selection,
  the summary label, and the moved rail toggle. New coverage for the record close button
  (dismiss reveals timeline) and unlink (clearing a linked actor). Existing
  `19-actor-picker.spec.mjs` continues to cover linking.
- **Theme (manual):** record content readable in a running Foundry instance in both light
  and dark themes, in view and edit modes.

## Out of scope

- No changes to the data models, migrations, or record types themselves.
- No change to link *creation* UX (drag + picker) beyond adding the unlink counterpart.
- Filter *semantics* unchanged: an empty `state.types` set shows all types.
