# Inline-Editable Record Views — Design

**Date:** 2026-07-10
**Status:** Approved
**Branch:** `feature/hub-inline-edit`

## Goal

Make campaign-record documents editable in place while viewing them, with auto-save.
A per-user toggle (default on) in the Campaign Hub header switches all record sheets
between today's read-only view and an editable-in-place view where every field can be
changed without opening the separate edit mode.

Today record pages render read-only `view.hbs` templates inside the journal sheet;
editing requires opening the page's edit mode (`edit.hbs`), a separate window. This
feature merges the two experiences: the readable view layout stays, but its fields
become live inputs and editors that persist changes automatically.

## Requirements

- **Toggle:** client-scoped module setting `inlineEditing`, boolean, default `true`.
  Controlled by a button in the Campaign Hub header (next to the thumbnails toggle,
  `fa-pen` / `fa-pen-slash`, localized tooltip). Also visible in module settings.
  Flipping it re-renders any open journal sheets so records switch modes immediately.
- **Editable view:** when the toggle is on and the user can update the page, the
  view-mode rendering of every campaign-record page type shows its fields editable
  in place, keeping the view layout (not the edit form's layout).
- **Field coverage:** all fields the edit form has appear in the editable view —
  empty optional fields (source, tags, image, rewards, …) render as subtle
  placeholder inputs so anything can be filled in without leaving the view.
  Row sections (quest objectives, checklist items, shop/loot tables) show their
  add/delete/toggle controls. When the toggle is off, the read-only view is
  unchanged from today (empty fields hidden, no controls).
- **Auto-save:** plain fields save on change; rich-text fields are always-open
  editors with debounced save-as-you-type (~2s idle) plus save-on-blur, using
  Foundry's collaborative editing so concurrent editors merge rather than clobber.
- **Permissions:** users without update permission on a record always get the
  read-only view regardless of the toggle. GM-only fields (GM notes, hidden flag,
  objective GM-visibility) keep their existing gating.
- **Escape hatch:** the separate edit mode and Foundry's edit button remain
  untouched.

## Out of scope

- The page **name** — owned by the journal sheet header; rename stays where it is.
- Plain core **text pages** inside group journals — core-owned rendering; only the
  module's record page types participate.
- OS-level conflict resolution beyond Foundry's collaborative prose editing.

## Approach

**Mode-aware view templates** (chosen over a third template set per type, and over
post-render DOM enhancement): each record type's `view.hbs` and the shared
`common-view.hbs` gain conditional blocks — `{{#if inlineEdit}}` renders the
input/select/prose-mirror for a field, `{{else}}` the current read-only markup.
One template per type keeps the read and editable views from drifting apart, and
the diff per type stays small because common fields live in the shared partial.

### Sheet flag

`BaseRecordSheet._prepareContext` computes:

```js
context.inlineEdit =
  game.settings.get(MODULE_ID, INLINE_EDIT_SETTING) &&
  this.document.canUserModify(game.user, "update") &&
  this.isView;   // view mode only — edit mode keeps its own form
```

### Auto-save plumbing

- **Plain fields** (inputs, selects, checkboxes carrying `name="system.…"`):
  a delegated `change` listener in `BaseRecordSheet` maps the field to
  `document.update({[name]: value})`. Deliberately independent of the form
  `submitOnChange` machinery, which may not run for view-mode embedded rendering —
  same pattern `bindRowInputs` already uses. Number coercion and empty-value
  guarding follow the existing `bindRowInputs` rules.
- **Row arrays:** existing `updateRows` / `bindRowInputs` path, unchanged; the
  editable view simply includes the row inputs and action buttons that today only
  exist in `edit.hbs`.
- **Prose fields** (description, GM notes, rewards, …): always-open
  `<prose-mirror>` (no `toggled` attribute), `collaborate` enabled. A debounced
  commit (~2s idle) plus save-on-blur persists as the user types. Live editors are
  instantiated only for the currently displayed page so a large group journal does
  not spawn dozens of collaboration sessions.

### Re-render guard (key risk)

Every auto-save fires `updateJournalEntryPage`, which re-renders the embedded page
view — naively destroying the editor mid-typing. Mitigation: `BaseRecordSheet`
overrides `render()` with a focus guard — **while any inline control in the sheet
has focus, re-renders are deferred and flushed on blur**. The user's own debounced
saves therefore never yank the cursor; other users' changes to plain fields appear
once the local user clicks away (prose stays live via collaboration).

This depends on core calling the page sheet's `render()` for embedded view-mode
rendering (believed true in v13). **First implementation task is a spike verifying
this**; if core re-renders embedded views through another path, fall back to
guarding at that layer before building the rest.

## Error handling

- A rejected `document.update` (permission revoked mid-session, schema validation)
  warns via `ui.notifications` and re-renders to resync the sheet — same pattern as
  `bindRowInputs`.
- A failed prose save warns but leaves the editor content intact so nothing typed
  is lost.

## Testing

- **Unit (vitest):** the `inlineEdit` flag matrix (setting × permission × mode),
  and any extracted save-mapping logic (name→update payload, number guarding).
- **Integration (Quench / Playwright per the `foundry-e2e` contract):**
  - toggle on → open a quest → edit a plain field and a prose field inline →
    document updated;
  - toggle off → view is read-only, matches today's markup;
  - player without ownership → read-only despite the toggle;
  - typing in a prose field while an auto-save lands → editor keeps focus and
    content.
