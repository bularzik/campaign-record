# Journal edit flicker/loop + first-class inline journals

**Date:** 2026-07-17
**Status:** Approved design, ready for implementation planning

## Problem

Two related defects, both rooted in text/journal pages being second-class in the hub's inline-edit machinery.

### Defect 1 — edit pane flickers and hub becomes unresponsive

When editing a page in the hub, after a period the edit pane flickers severely and all hub controls become unresponsive except the window close box.

**Confirmed live (World B, current main, standalone Playwright repro):**
- The hub subscribes to `create/update/deleteJournalEntryPage` and `…JournalEntry` and, in `_onDocumentChanged`, fires a **full** `this.render()` (debounced 100ms) on any of them (`hub-mixin.mjs:158-177, 224-241`).
- The `record` template is its own ApplicationV2 part (`hub-mixin.mjs:79-84`). A full render re-renders it, producing a **fresh `.record-pane-mount` node** every time.
- `_onRender` then calls `RecordPane.mount()` (`hub-mixin.mjs:1003-1012`). Because the mount node changed, `sheet.element.parentElement === container` is false, so it runs `container.replaceChildren(sheet.element)` + `await sheet.render({force:true})` (`record-pane.mjs:38,43`) — **re-parenting and rebuilding the live embedded sheet**, which disconnects the active `<prose-mirror>`.
- Measured: **one external `updateJournalEntryPage` = 1 hub render + 1 pane re-mount, and it throws `Cannot read properties of null (reading "matchesNode")`** (the editor teardown faulting in ProseMirror internals).
- **Typing alone fires nothing** (15 keystrokes over 4s → 0 renders/updates): core does not save-per-keystroke here, so the trigger is *external* page updates, not keystrokes.
- **A dirty editor amplifies it**: with unsaved keystrokes, one external update produced **2 updates + 2 renders** (the update, plus the teardown force-saving the in-progress text), then settled — throwing `matchesNode` each time.

So it is not infinitely self-sustaining in isolation, but every external update, while a journal editor is open in the pane, tears down + rebuilds the editor (flicker), throws an exception, and can force-save half-typed content. In a live campaign, external updates arrive in a stream (auto-capture filing media, another connected client, combat/token activity); a steady trickle → continuous flicker and a main thread churning on re-mounts + exceptions → "unresponsive except close." The reported "after a period" matches updates accumulating over a session.

The guard that is *supposed* to prevent mid-edit re-renders, `hasInlineFocus` (`inline-edit.mjs:82-90`, used at `hub-mixin.mjs:190-200`), only recognizes `.campaign-record-content.inline-edit` (typed records). A core text-page editor never matches, so nothing defers the hub render while editing a journal.

### Defect 2 — journals ignore the "toggle inline editing" setting

`inlineEditableView` requires `viewedPage.type.startsWith("campaign-record.")` (`hub-mixin.mjs:835-839`), and `computeInlineEdit` requires the typed-record `system` fields. Text pages are type `"text"`, so the inline-editing toggle never applies to them; they only ever use core's view/edit-mode sheet — the same sheet torn down in Defect 1.

## Goals

1. Editing any page in the hub (journal or record, inline or explicit edit mode) is never interrupted by external document updates — no flicker, no forced partial save, no `matchesNode` error.
2. Journals honor the inline-editing setting: **on** → always-open inline editor like a record; **off** → rendered content + an edit button.

## Design

### Part 1 — Stop the pane from re-rendering out from under the editor

**Root fix.** When a document-change hook fires while a *still-valid* record is open, re-render only the non-`record` parts (`["header", "index", "timeline"]`), never the `record` part. The `.record-pane-mount` node then keeps its identity, so `RecordPane.mount()` hits its existing `sheet.element.parentElement === container` early-return (`record-pane.mjs:37`) and never touches the embedded editor: no re-parent, no teardown, no forced save, no `matchesNode`, no flicker. The embedded sheet already re-renders its own content on its own document's update, so the hub does not need to.

- A pure helper decides the parts: given `{ hasView, viewInvalidated }`, return the render parts. When a record is open and remains valid → `["header", "index", "timeline"]`. When no record is open, or the viewed page was deleted/invalidated → full render (all parts) so the pane rebuilds or clears.
- `_onDocumentChanged` already nulls `state.view` when the viewed page is deleted (`hub-mixin.mjs:236-239`); that path must trigger a full render so the pane clears. The helper keys off whether the view is still present/valid after the hook is processed.
- `#debouncedRender` becomes parts-aware (renders the computed parts) rather than always `this.render()`.

**Defense-in-depth.** Broaden the pane's deferral guard so *any* active editor focus in the mount defers a full re-render until focusout — not just `.campaign-record-content.inline-edit`. Extract the "is the user actively editing inside this root" predicate so it matches a focused `prose-mirror`, contenteditable, `input`, `select`, or `textarea` anywhere in the root, independent of the `.inline-edit` container. Focused action buttons still must NOT defer (they are none of those element types, preserving today's behavior where a row add/delete re-renders to show its result). This protects the residual full-render paths (e.g. a create/delete elsewhere that invalidates the view) while the user is mid-edit.

Part 1 protects **both** inline editing and explicit edit-mode editing (inline off), because it stops the record-part re-render regardless of which sheet is mounted.

### Part 2 — Journals first-class inline

Include `text` pages in the inline-editable decision so the toggle applies uniformly:

- `inlineEditableView` (`hub-mixin.mjs:835-839`) and `computeInlineEdit` (`inline-edit.mjs:11-13`) treat a `text` page in a hub group with update permission as inline-editable when the setting is on. When on → always-open inline editor; when off → rendered content + edit button (core editor).
- **Mechanism.** BaseRecordSheet already carries the inline-prose machinery: the debounced `{render:false}` saver (`inline-edit.mjs:36-72`), defer-render-while-focused (`base-record-sheet.mjs:68-84`), focusout flush, and preclose flush (`base-record-sheet.mjs:198-231`). Extract that machinery into a shared base/mixin that operates on `prose-mirror[data-inline-prose]` elements keyed by their `name` (field path) — it already does. Add a Campaign Record text-page sheet that uses it to render `text.content` as an always-open `<prose-mirror data-inline-prose name="text.content">` in the inline view, and rendered content + edit affordance otherwise.
- `RecordPane.mount()` selects this sheet for `text` pages that live in a hub group, instead of core's `page._getSheetClass()`. Outside a hub group, text pages keep core's sheet untouched (records are world-registered and can live in any journal; the same containment rule as `computeInlineEdit`'s `inGroup`).

Journals then get the same inline view/edit affordances as records and the same Part 1 protection.

## Module boundaries & testing

Matches the repo's pure-logic-tested / Foundry-I/O-e2e convention.

- **Pure / unit-tested (vitest):**
  - The render-parts decision helper (`{ hasView, viewInvalidated }` → parts list).
  - The broadened active-editor focus predicate (extends/renames today's `hasInlineFocus`), including that focused buttons do not defer and focused editors/inputs do.
  - The inline-editable decision extended to `text` pages (`computeInlineEdit` / the `inlineEditableView` predicate).
- **Foundry-I/O (Playwright e2e):**
  - Regression: editing a text page in the pane while an external `updateJournalEntryPage` fires produces **0 pane re-mounts and 0 `matchesNode` errors** (baseline today: 1 re-mount + a throw per update). The standalone repro built during diagnosis is the basis.
  - Inline toggle on/off changes a journal's editing affordance (always-open editor vs. rendered content + edit button).
  - Editing a journal is uninterrupted across a burst of external updates (content and caret preserved).

## Edge cases

- Viewed page deleted while open → full render, pane clears (existing `state.view` nulling path drives the full-render branch).
- Mode toggle / navigation → full render (user-initiated; re-mounts intentionally).
- Text page outside a hub group → core sheet, unchanged (no inline behavior, no CR text sheet).
- Inline editing off → journals use core edit-mode sheet, still protected by Part 1 from mid-edit teardown.
- Non-record document updates that invalidate the view (permission/visibility change) → full render via the helper's `viewInvalidated` branch.

## Out of scope

- Changing core's ProseMirror editor or its collaborative save cadence.
- Reworking record (non-text) inline editing beyond the shared-machinery extraction.
- The auto-capture / external-update sources themselves (they are legitimate; the fix is to stop re-rendering the pane on them).
