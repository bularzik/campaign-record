# Hub Record Pane — Design

**Date:** 2026-07-09
**Status:** Approved
**Branch:** `feature/hub-record-pane`

## Problem

Campaign Record currently splits the workflow across two UIs. The Campaign Hub
handles browsing (index, timeline, search), but viewing or editing a record
opens the **core journal sheet** in a separate window, where editing requires a
right-click context menu. Likewise, double-clicking a campaign group in the
journal sidebar opens the core journal sheet instead of the hub, so reaching
the hub requires a separate footer button.

This design removes the split: records are viewed and edited **inside the
hub**, and opening a group from the sidebar opens the hub directly.

## Goals

1. View any record in-pane inside the Campaign Hub.
2. Toggle to edit mode via an edit icon on the page (no context menu).
3. Free jump-navigation between records — following link chains (including
   loops) never requires unwinding a path.
4. Double-clicking a campaign group in the journal sidebar opens the hub for
   that group.
5. Plain text journal pages in groups get the same in-hub view/edit treatment.

## Non-Goals

- Changing record data models, visibility rules, or permissions.
- Changing the standalone record sheets' templates or behavior.
- Multi-pane / side-by-side record comparison.

## User Experience

### Opening a group

- Double-clicking a campaign group in the journal sidebar — or activating any
  `@UUID` link to the group — opens the Campaign Hub **as that group's sheet**,
  scoped to the group (no group dropdown).
- The sidebar footer button and Ctrl+Shift+H keybinding continue to open the
  standalone cross-group hub with the group dropdown ("All groups"), unchanged.

### Viewing a record

- The Index / Timeline / Search tabs remain. Clicking an index row, a search
  hit, a timeline record chip, or a record link inside another record opens
  that record **in-pane**, filling the hub's content area.
- The record pane is not a fourth tab: it is a view state that replaces the
  active tab's content. The tab bar stays visible; selecting any tab leaves
  the record pane and returns to that tab with active filters preserved.
- Record pane header: `[‹]` left-panel toggle, `[←][→]` history buttons, the
  record's name, and `[✎]` edit toggle (only shown when the user can edit that
  record). Below the header, the record renders exactly as its sheet does
  today.

### Left panel (navigation rail)

- A slim collapsible rail lists **all records in the group**, grouped by type,
  with the hub's active filters (type chips, tag, hidden-only) applied.
- The currently viewed record is highlighted and scrolled into view.
- Clicking any rail entry jumps straight to that record — navigation is free
  jumping, never stack-unwinding.
- The chevron toggle slides the rail in/out; its state persists per client.
- In the standalone "All groups" hub, the rail lists records from all visible
  groups, grouped by type.

### History

- `[←][→]` walk a browser-style history as a convenience for retracing a step.
  The index is the root entry. New navigation truncates forward history.
  Loops (a → b → c → a …) are ordinary entries and need no special handling —
  the rail, not the history, is the primary navigation.

### Editing

- `[✎]` swaps the record to its edit form **in place**; the icon becomes an
  eye ("done") toggle to flip back to view mode.
- Saving matches existing sheet behavior: submit-on-change persists each field
  change immediately; there is no explicit save button.
- Plain text journal pages render in-pane and edit in-pane with Foundry's
  ProseMirror editor.
- Creating a new record from the hub opens it in-pane in edit mode instead of
  popping a window.

### Links

- Record → record links in the **same group** navigate in-pane (pushing
  history).
- Links to records in a **different group** open that group's own hub window.
- Links to non-record documents (Actors, Scenes, Items, …) open their normal
  sheets, as today.

### Permissions

Unchanged. Players see what visibility rules allow; `[✎]` appears only on
records the user can update; GM notes remain GM-only.

## Architecture

### GroupHubSheet (new)

A `DocumentSheetV2`-based sheet for `JournalEntry` that renders the hub UI
with its group pinned to the document.

- `JournalEntry` has no subtypes, so the sheet is registered as an available
  (non-default) sheet via `DocumentSheetConfig.registerSheet`.
- Each campaign group document gets the `core.sheetClass` flag set to it:
  at group creation for new groups; via migration for existing groups.
- If the module is disabled or removed, Foundry's core fallback renders the
  default journal sheet — no broken documents.

### Shared hub core (refactor)

The standalone `CampaignHub` (`ApplicationV2` singleton) and `GroupHubSheet`
(`DocumentSheetV2`) share all parts, tabs, state, actions, and index /
timeline / search logic through a mixin (`HubMixin(Base)`), since their base
classes differ. `campaign-hub.mjs` (~535 lines) is refactored so the shared
body lives in the mixin and the two subclasses stay thin:

- `CampaignHub`: group dropdown, `state.groupId` mutable, singleton
  open/toggle statics, footer button + keybinding target.
- `GroupHubSheet`: `groupId` pinned to `this.document.id`, no dropdown,
  standard document-sheet lifecycle.

### Record pane (new component)

Owns the in-pane record display:

- **Embedded sheet cache** — one frameless sheet instance per viewed page,
  mirroring core `JournalEntrySheet.getPageSheet()`:
  `new SheetClass({ document: page, mode, window: { frame: false,
  positioned: false } })`. The instance's element is mounted into the pane;
  the instance is properly **closed** (not just detached) when navigating
  away or when the hub closes, so editors and listeners clean up.
- Because embedded sheets are real rendered `DocumentSheet` instances,
  Foundry re-renders them automatically on document updates — live sync for
  free. All ten record sheets are reused untouched; future record types work
  automatically.
- **View state** — `{ pageId, mode: "view" | "edit" }` per hub instance.
- **History** — plain array of visited states plus a cursor; the index is the
  root entry.

### Link interception

A capture-phase click handler on the hub's content catches `a.content-link`
clicks. If the target resolves to a `JournalEntryPage` inside a campaign
group: same group → in-pane navigation; different group → render that group's
sheet (its hub). Anything else falls through to Foundry's default handler.

### Text pages

Embedded via core's text page sheet in view mode; edit mode embeds the same
sheet with `mode: "edit"` (ProseMirror).

**Risk (spike first):** frameless embedding of a core text page sheet in
*edit* mode is the one pattern core itself does not use (core opens edit in a
window). The implementation plan front-loads a spike to verify it. Fallback,
only if it genuinely fights us: a hub-owned ProseMirror editor bound to
`page.text.content` via the documented `foundry.applications.elements` /
ProseMirror APIs.

### Changes to existing code

| Location | Change |
| --- | --- |
| `#onOpenRecord` (hub) | Navigate in-pane instead of rendering the core journal sheet |
| `#onOpenLink` (timeline) | Record chips navigate in-pane; other docs unchanged |
| `#onNewRecord` (hub) | Open the created record in-pane in edit mode |
| Group creation (`create-group-dialog` / `data/groups`) | Set `core.sheetClass` flag |
| `logic/migrations` + `data/migration-runner` | Migration stamping the flag on existing groups |
| Record sheets (`BaseRecordSheet` + 10 subclasses) | **Untouched** |
| `hooks/directory.mjs`, data models, logic modules | **Untouched** (except group creation above) |

## Edge Cases & Error Handling

- **Record deleted while viewed** → pane falls back to the index; history
  entries pointing at it are pruned.
- **Permission lost mid-view** (e.g. GM hides a record a player is viewing) →
  existing doc hooks re-render; the pane falls back to the index when the page
  is no longer visible to the user.
- **Navigating away mid-edit** is safe: submit-on-change means no unsaved
  state; the embedded sheet is closed so ProseMirror instances tear down.
- **Embedded sheet render failure** → warning notification and return to the
  index rather than a blank pane.
- **Broken links** → existing warning notification, no navigation.
- **Same record open in two hubs** (group sheet + "All groups" hub) → each hub
  owns its own embedded sheet instances; no shared DOM.
- **Migration** is idempotent and skips groups where a user manually selected
  a different sheet.

## Testing

### Unit (vitest)

- History logic: push, truncate-forward, cursor moves, loop sequences,
  pruning deleted entries.
- Link-target classification: same-group record / cross-group record /
  non-record document / broken UUID.

### E2E (Playwright, World B)

- Sidebar double-click on a group opens the hub as its sheet.
- Index row click renders the record in-pane; tab bar returns to index with
  filters intact.
- In-record link click jumps in-pane and highlights the target in the rail.
- Back/forward traversal, including a link loop.
- Rail collapse/expand persists across reopen.
- `[✎]` edit persists a field change and flips back to view.
- Text page in-pane view and ProseMirror edit.
- Cross-group link opens the other group's hub.
- New-record flow lands in-pane in edit mode.
- Player permission gating: no `[✎]` on records the player cannot edit.

### Regressions

Existing e2e specs asserting the old open-the-journal-sheet behavior are
updated to the new in-pane expectation; the remainder of the suite (55 specs)
and all 71 unit tests must stay green.
