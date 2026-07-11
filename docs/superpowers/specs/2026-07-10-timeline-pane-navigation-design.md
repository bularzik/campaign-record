# Timeline & Hub Navigation: All Pages Open In-Pane

**Date:** 2026-07-10
**Status:** Approved

## Problem

Clicking a timeline tile can open a page outside the campaign hub. Timeline **link chips**
pointing at a journal page call `doc.parent.sheet.render(true)` — for a page in an ordinary
journal that is the standard journal sheet; for a page in another campaign group it is that
group's hub in a **second window**. Timeline **record chips** and content links inside record
text route in-pane only when the page is inside the hub's current scope; cross-group targets
open the other group's hub window.

## Decision (user-approved)

One navigation rule everywhere inside a hub: **any `JournalEntryPage` activated from a hub
opens in that hub's record pane** — regardless of which group or journal the page belongs to.
This applies to timeline record chips, timeline link chips, content links inside record text,
index/search entries, and the new-record landing. Non-page targets keep current behavior
(image links → `ImagePopout`, other documents → their own sheets, broken links → warning).

## Design

### 1. Identity: uuid everywhere

The pane's view state and history currently carry a bare `pageId` and resolve it only within
the hub's scoped groups, so out-of-scope pages can never resolve.

- `state.view` becomes `{ uuid, mode }`.
- `#resolveViewedPage()` becomes `fromUuidSync(state.view.uuid)` (tolerating resolution
  failure → `null`), followed by the visibility check (§3).
- `pane-history.mjs` (pure, unit-tested): record entries become `{ kind: "record", uuid }`;
  `prunePage(history, pageId)` becomes `pruneUuid(history, uuid)`.
- `navigateToRecord(uuid, { mode, pushHistory })` takes a uuid.
- `GroupHubSheet.goToPage(pageId)` (core-compat API) stays; it builds the uuid from its own
  document's page collection.
- `_configureRenderOptions`' `options.pageId` handling (core's content-link routing into a
  group sheet from outside the hub) converts the incoming pageId to a uuid on consumption.
- `_onDocumentChanged`'s deleted-page pruning compares `doc.uuid`.

`RecordPane` is untouched — it is already keyed by `page.uuid:mode`.

### 2. One routing rule

`classifyLinkTarget(doc)` simplifies: any `JournalEntryPage` → `{ kind: "in-pane", uuid }`;
everything else → `{ kind: "external" }`. The `scopedGroupIds` parameter and the
`"other-group"` kind disappear. `record-links.test.js` updates accordingly.

Callers lose their open-another-window branches:

- `#onOpenRecord` — cross-group/out-of-scope chips now `navigateToRecord(uuid)`.
- `#onOpenLink` — page links navigate in-pane; the image-popout and non-page document
  branches are unchanged; unresolvable links keep the existing broken-link warning.
- `#onNewRecord` — a record created into another group lands in **this** pane in edit mode.
- The content-link click handler in `_onRender` — any page link navigates this pane;
  non-page links fall through to Foundry's default handling.

### 3. Visibility

`isRecordVisible` only checks the module's hidden flag; document permission was implicitly
handled by scope. Opening arbitrary pages requires a real permission check:

- Viewable in pane = `page.testUserPermission(user, "OBSERVED")` AND
  `isRecordVisible(user, page)`.
- The pure hidden-flag predicate stays Foundry-free in `visibility.mjs`; the
  `testUserPermission` call happens at the call site in `_prepareContext`, matching the
  codebase's pure-logic / Foundry-plumbing separation.
- A page that fails resolution or visibility falls back to the index exactly as a deleted
  page does today (history pruned, `state.view` cleared).

### 4. Deliberately unchanged

- The navigation rail lists only scoped records. An out-of-scope page shows in the pane with
  its name in the header; nothing is highlighted in the rail.
- Inline editing stays gated on the campaign-group parent (`computeInlineEdit`'s `inGroup`).
  Ordinary-journal pages render the standard read-only view in the pane; the explicit
  edit-mode toggle still works for them (`canEdit` = `canUserModify`, already generic).
- Core behavior outside the hub (e.g. clicking a content link in a regular journal window)
  is unchanged.

### 5. Testing

Unit:
- `pane-history`: uuid entries, `pruneUuid`, back/forward unchanged semantics.
- `record-links`: every `JournalEntryPage` classifies in-pane; non-pages external.
- Visibility predicate rows (hidden flag × GM), permission composition covered at e2e level.

E2E (extend `21-hub-record-pane` / timeline specs):
- Timeline link chip to an ordinary journal's page opens in the current pane (no core
  journal sheet window).
- Cross-group record chip opens in the current pane (no second hub window).
- Permission-restricted page falls back to the index silently (same path as the
  deleted-page fallback; the broken-link warning is only for click-time unresolvable links).
- New record created into another group lands in this pane in edit mode.
