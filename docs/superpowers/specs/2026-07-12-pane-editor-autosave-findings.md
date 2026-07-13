# Findings: autosave for the Campaign Hub record pane (and why the naive attempts fail)

**Date:** 2026-07-12
**Status:** Research / hand-off notes. **No autosave is shipped.** This documents a
failed attempt (reverted) so a future implementer starts ahead of where we did.

## Goal

Let a user edit a record in the hub's right-hand pane and have edits persist
**without** visible manual Save buttons — a clean editor. Specifically the ask was
to hide the ProseMirror toolbar's floppy **Save** button (left of "Source HTML")
and the footer **"Save Changes"** button, and have edits auto-save.

## What actually shipped (the safe subset)

- Editor **fills the pane** and resizes (`.record-pane-mount` flex height chain).
- Core's **page-metadata row** (heading-level select + "Display Page Title"
  checkbox + optional category) is **hidden** in the pane.
- The **footer "Save Changes"** button is **hidden** (safe: pure CSS, no guard).
- The **toolbar floppy Save stays visible** — it is the editor's real commit
  control, not a redundant duplicate. Do not hide it without real autosave.

All of the above is CSS scoped to `.record-pane-mount`, so journal sheets opened
as their own window are unaffected.

## The architecture you must understand first

### Two different editor paths in the pane

1. **Typed record, inline VIEW** (`campaign-record.*` pages, default when the
   `inlineEditing` client setting is on). Template
   `templates/partials/common-view.hbs` renders an **always-open**
   `<prose-mirror data-inline-prose collaborate>`. Autosave for THIS path already
   exists and works — see `scripts/sheets/base-record-sheet.mjs`
   `#bindInlineProse` / `#onInlineChange` + `createDebouncedSaver`. These editors
   have **no** floppy Save button (no `onSave` configured).
2. **Core edit sheet** — used by a **text/journal page** (always) and by a typed
   record in **edit mode** (only when inline editing is off, since Task 9 hides
   the edit-toggle for inline-editable entries). Text pages use Foundry core's
   `templates/journal/pages/text/edit.hbs` → `<prose-mirror name="text.content"
   collaborate>` (**always-open**, no `toggled`). Typed edit mode uses
   `templates/partials/common-edit.hbs` → `<prose-mirror ... toggled collaborate>`.
   These **do** show the floppy Save button (core sets `onSave`).

The user's pain is path #2 (journal/text pages). Path #1 already autosaves.

### How a `<prose-mirror>` element commits (Foundry core)

Read `client/applications/elements/prosemirror-editor.mjs` and
`common/prosemirror/menu.mjs` in the Foundry install
(`/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app`):

- The element commits its content **only** through its private `#save()`. `#save()`
  calls `_setValue(currentContent)` and dispatches a bubbling **`change`** event.
- `#save()` is invoked by: the **toolbar Save button** (menu item
  `action: "save"`, rendered as `<button data-action="save">`, `cssClass: "right"`,
  left of the `action: "source-code"` "Source HTML" button), and — for **toggled**
  editors only — on deactivation/close.
- There is **no per-keystroke form-value sync.** The element's *form value* (what a
  form submit serializes, and what `submitOnChange` reacts to) updates **only when
  `#save()` runs**.
- BUT the element's **`el.value` getter returns the LIVE serialized content**
  on demand (this is why the inline path's `createDebouncedSaver` reading
  `el.value` works without ever calling `#save()`).

### How saving is wired

- Both core's `JournalEntryPageSheet` and this module's `BaseRecordSheet` set
  `form: { submitOnChange: true }`. So a `change` event on a form field
  auto-submits and saves. The floppy Save fires that `change`; the page-name input
  fires it on blur.
- The **footer "Save Changes"** is just a manual submit → redundant under
  `submitOnChange`. **Safe to hide.**
- The **floppy Save** is the *only* thing that commits the always-open core
  editor's content to the document (it's the only `#save()` trigger for a
  non-toggled editor). **Hiding it with no replacement = silent data loss:** the
  user's keystrokes stay in the editor view-state, never committed; the next
  re-render (`RecordPane` rebuilds the editor from `document.system`/`text.content`
  on every mount) or any `submitOnChange` re-mounts from the SERVER copy and wipes
  them. This is the first bug the user reported.

### The hub re-render / re-mount cycle

- `scripts/apps/hub/record-pane.mjs` `mount()` rebuilds the mounted sheet's DOM on
  re-render (`await sheet.render({force:true})`) — this destroys and recreates the
  live editor. Any hub re-render therefore risks tearing out an active editor.
- The hub re-renders from: user actions (they call `this.render()` /
  `#renderList()` directly), and background document-change hooks
  (`_onDocumentChanged` → `#debouncedRender`, 100ms), including remote users' edits
  and our own saves.
- To protect an active INLINE editor, `hub-mixin.mjs` `render()` **defers** when
  `hasInlineFocus(mount)` is true (focus inside `.campaign-record-content.inline-edit`),
  flushing on `focusout`. `base-record-sheet.mjs` has an equivalent guard for its
  own renders, plus `_preClose` flushes pending saves.

## The failed attempt (reverted — see git commit 809f4d7 and its revert e6318d7)

Approach tried: on `focusout` of a pane editor, programmatically click the
(CSS-hidden) floppy Save button to commit via core's own path; also commit before
navigate/close; and **broaden the hub re-render guard** from `hasInlineFocus` to a
new `hasEditableFocus` (any editable focus in the mount, not just `.inline-edit`)
so concurrent updates couldn't wipe an active edit-mode/text editor.

It produced **two serious regressions**:

1. **Every hub control died while editing.** The broadened guard deferred **all**
   hub re-renders whenever the editor had focus. But most hub controls (sort,
   filter, rail collapse, back/forward, switch entry, view/edit toggle) only take
   effect via a re-render, and focus does **not** reliably leave the editor when
   you click them — e.g. record rows are `<li data-action="openRecord">`, not
   focusable, so clicking one never blurs the editor → its `navigateToRecord`
   render was deferred forever. Only **New Entry** (opens a dialog) and **window
   close** (no hub render) kept working — which is exactly the symptom reported.
   Lesson: **a focus-based "defer all renders" guard cannot distinguish a
   background update (defer) from the user's own control action (must proceed).**
   The original `hasInlineFocus` "worked" only because the inline path's controls
   happen to blur the inline editor; it was never really correct, just unexposed.
2. **Multi-user overwrite.** Clicking Save on blur does a full-content commit that
   fights ProseMirror's collaborative (`collaborate`) editing: "first user into
   edit mode wins; their save overwrites the second user's changes." Full-document
   saves are the wrong layer for an OT-collaborative editor.

## Constraints a correct solution MUST satisfy

1. **Never lose uncommitted edits** on: idle, blur, switching entries, closing the
   hub/window, a remote update arriving mid-edit.
2. **Never freeze the hub UI.** User-initiated re-renders (sort/filter/navigate/
   rail/back-forward/toggle) must always proceed, even with an editor focused. Only
   *background* re-renders (remote updates; our own quiet autosave) may defer.
3. **Play nice with `collaborate`.** Don't clobber concurrent edits with
   full-document writes. Either disable collaboration for pane editing, or commit
   through the collaborative layer, or accept last-writer-wins *only* with a clear
   design decision.
4. **Handle the re-mount.** `RecordPane` rebuilds the editor on every render;
   pending edits must be flushed before a rebuild, and the guard must prevent a
   rebuild while typing.

## Suggested directions (unverified — for the next session to evaluate live)

- **Separate the two guards.** Keep user-action `render()` calls unguarded; apply
  the "defer while editing" guard **only** to the background path
  (`_onDocumentChanged` / `#debouncedRender`). That fixes regression #1 at the
  root. User navigation already commits-then-renders; background updates defer.
- **Reuse the inline pattern, read `el.value`.** For the pane's non-inline editors,
  bind a `createDebouncedSaver` (as `base-record-sheet.mjs` does for
  `data-inline-prose`) that reads the **live `el.value`** and does
  `document.update({ [el.name]: el.value }, { render: !quiet })`. This is the
  established, tested approach in this codebase — but confirm its interaction with
  `collaborate` on the CORE editor specifically (the inline editors are the
  module's own, not core's text sheet).
- **Consider dropping `collaborate`** on the pane editors if true multi-user
  concurrent editing of the same page isn't a product requirement — it removes the
  hardest failure mode (regression #2). This is a product decision.
- **Flush on teardown.** Mirror `base-record-sheet.mjs` `_preClose`: flush pending
  saves before the pane closes/re-mounts, and before `navigateToRecord` /
  `navigateToIndex` / `_onClose`.
- **Test live, single AND multi-user.** Every regression here only showed up in the
  running app (dead controls, multi-user overwrite); unit tests passed throughout.
  Use the `foundry-e2e` harness and manual two-browser testing before hiding the
  floppy.

## Key references

- `scripts/apps/hub/hub-mixin.mjs` — `render()` guard (`hasInlineFocus`),
  `#debouncedRender`, `_onDocumentChanged`, `navigateToRecord`/`navigateToIndex`,
  `_onClose`, and the `#pane.mount(...)` call in `_onRender`.
- `scripts/apps/hub/record-pane.mjs` — mount/re-mount rebuilds the editor DOM.
- `scripts/sheets/base-record-sheet.mjs` — working inline autosave to copy:
  `#bindInlineProse`, `#onInlineChange`, `render()` guard, `_preClose` flush.
- `scripts/logic/inline-edit.mjs` — `computeInlineEdit`, `createDebouncedSaver`,
  `hasInlineFocus`.
- `templates/partials/common-view.hbs` (inline `data-inline-prose`),
  `common-edit.hbs` (`toggled`); text pages use core's
  `templates/journal/pages/text/edit.hbs`.
- Foundry core (install path):
  `client/applications/elements/prosemirror-editor.mjs` (`#save`, live `value`
  getter), `common/prosemirror/menu.mjs` (save button `data-action="save"`,
  Source HTML `data-action="source-code"`),
  `client/applications/sheets/journal/journal-entry-page-sheet.mjs`
  (`form.submitOnChange: true`), `templates/journal/parts/page-header.hbs`
  (the `.page-metadata` row), `templates/journal/parts/page-footer.hbs`
  (the footer submit).
- Git: failed attempt = commit `809f4d7`; its revert = `e6318d7`; footer-only hide
  that shipped = `f9d1cd6`.
