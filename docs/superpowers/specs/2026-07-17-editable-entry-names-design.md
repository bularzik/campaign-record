# Editable Entry Names in the Record Pane — Design

**Date:** 2026-07-17
**Status:** Approved

## Problem

Record names (`JournalEntryPage.name`) are displayed in the hub record pane header
(`templates/hub/record.hbs`, `<h2 class="record-pane-title">`) but cannot be edited
anywhere inside the hub. To rename a record, users must open the page in the core
JournalEntry sheet outside the module. Every other field of an editable record is
editable in place; the name should be too.

## Decision

When the viewed entry is editable, the pane header renders an **always-open text
input** styled to match `.record-pane-title`, in place of the `<h2>`. This follows
the module's inline-edit philosophy: editable fields are open editors, with no
extra click or mode switch beyond what already governs the rest of the entry.

Approaches rejected:

- **Name field in the sheet body** (`common-edit.hbs` + widening the
  `#onInlineChange` guard in `base-record-sheet.mjs`): touches every record type's
  template, duplicates the title visually, larger diff for no benefit.
- **Core rename dialog on header click:** modal, inconsistent with the chosen
  always-open interaction and the module's inline-edit feel.

## Behavior

- **Editable viewer:** header shows a borderless input pre-filled with the page
  name, visually matching the current `<h2>`.
- **Commit:** on `change` (blur or Enter). The value is trimmed. If the trimmed
  value is empty or equal to the current name, nothing saves and the input reverts
  to the current name.
- **Cancel:** Escape restores the current name in the input and blurs without
  saving.
- **Non-editable viewer:** plain `<h2>` exactly as today.
- After a successful save, the existing `updateJournalEntryPage` hook re-renders
  the hub, refreshing both the header and the index row.

## "Editable" definition

New pure function in `scripts/logic/inline-edit.mjs`:

```js
isNameEditable({ canEdit, editing, inlineEditable })
// true when canEdit && (inlineEditable || editing)
```

- `canEdit` — the existing `viewedPage.canUserModify(game.user, "update")` gate
  computed in `hub-mixin.mjs`; owner-players can rename, matching field editing.
- `inlineEditable` — the existing `isInlineEditableView(...)` result (typed
  records in a group with the inline-edit setting on).
- `editing` — manual edit mode is active (`state.view.mode === "edit"`), covering
  text pages and the inline-edit-off configuration.

This makes the name editable in exactly the situations where the rest of the
entry is editable.

## Wiring

- `hub-mixin.mjs`: add `view.nameEditable` (from `isNameEditable`) to the render
  context built alongside `view.name` / `canEdit` / `editing`.
- `templates/hub/record.hbs`: branch — input when `view.nameEditable`, `<h2>`
  otherwise. Input carries a distinct class (e.g. `record-pane-title-input`) and
  `name="name"`.
- `hub-mixin.mjs`: delegated `change` + `keydown` handling for the input —
  `change` commits via `viewedPage.update({ name })`; Enter blurs the input
  (which fires `change`); Escape resets the value and blurs without firing a
  commit. `stopPropagation` on `change` so the event does not bubble into any
  parent form handling.
- CSS: style the input to match `.record-pane-title` (font, size, weight, no
  border/background at rest; subtle affordance on focus).
- The existing `hasActiveEditorFocus` render guard already matches `input`, so
  hub re-renders will not clobber in-progress typing.

## Error handling

- Empty / whitespace-only name: no save, revert input to current name.
- Unchanged name: no save (avoids no-op document updates and re-renders).
- `document.update` rejection (e.g. permission revoked mid-session): a failed
  update fires no hook (no re-render to fall back on), so the `change` handler
  itself catches the rejection, reverts the input to `page.name`, and warns via
  `ui.notifications.warn` (matching the `InlineSaveFailed` pattern used by other
  inline saves in `base-record-sheet.mjs`).

## Testing

- **Unit** (`tests/inline-edit.test.js`): truth table for `isNameEditable` —
  all combinations of `canEdit` / `editing` / `inlineEditable`.
- **E2E** (`tests/e2e/21-hub-record-pane.spec.mjs`):
  - GM edits the header input, commits with Enter → pane title and index row show
    the new name.
  - Escape after typing reverts and does not save.
  - Empty submission reverts and does not save.
  - A player without ownership sees the static `<h2>` (no input).
  - E2E runs follow the `foundry-e2e` session-locking skill.

## Out of scope

- Renaming from index rows.
- Renaming the group journal itself.
- Any change to the core journal sheet or timepoint renaming.
