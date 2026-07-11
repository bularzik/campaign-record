# Merge Index + Timeline — Design

**Date:** 2026-07-11
**Status:** Approved, ready for implementation planning
**Branch/worktree:** `worktree-merge-index-timeline`

## Problem

The Campaign Hub currently has two mutually-exclusive tabs — **Index** and
**Timeline** — plus a third view state that appears when an entry is opened: a
`.hub-record` pane with a collapsible **rail** (the filtered index grouped by
type) beside the mounted entry sheet.

This means finding an entry, seeing the timeline, and reading an entry are three
separate screens. You cannot see the timeline and an entry at once, and the
index/rail duplication (full Index tab vs. compact rail) is two renderings of
the same list. The tab-switching also complicates cross-tab drag (a record
dragged from Index must hover the Timeline tab to reach a drop target).

## Decision

Collapse the two tabs and the record pane into a **single two-pane
master–detail display**:

- **Left pane — the full Index, always present.** Search box, doctype-chips
  filter, sort, snippets toggle, and the record list. Collapsible to a thin
  strip via the existing rail toggle + `RAIL_SETTING`.
- **Right pane — the Timeline by default; an opened entry overlays it.** The
  timeline stays live underneath; navigating Back reveals it again.

The **Index / Timeline tab nav is removed** from the header. The separate
`.hub-record` full-screen view and the compact type-grouped **rail** are
removed — the always-present left Index replaces the rail entirely.

Explicitly **out of scope**: the search engine (`search-index.mjs`), the
timeline data model (`timepoints.mjs`), entry sheets themselves (including the
v1.2.6 scene picker, which renders inside the overlay unchanged), the group
model, and pane history semantics (back/forward behavior is preserved as-is).

## Layout

```
+----------------------------------------------------------+
| Campaign Hub                                          [x] |  window title
+----------------------------------------------------------+
| [group v] [import] [export] [inline]     (no more tabs)   |  hub-header
+---------------------+------------------------------------+
| [search.........]«  |  Timeline            [＋][▣]        |  right-pane header
| [NPC][Place][Quest] |  ── Session 1 ──────────           |
| [Sort: Name] ☐snip  |    (Bran) (Docks) (map.png)        |
|---------------------|  ── Session 2 ──────────           |
| ☻ Bran the Ferryman |    (Tavern) (Veyra) (Debt)         |
| ⌂ Drowned Docks     |  ── Session 3 ──────────           |
| ❖ The Ferryman Debt |    (Tide-Glass) (battlemap)        |
| ◆ Tide-Glass Lantern|    ＋ Add timepoint                 |
+---------------------+------------------------------------+
     left: Index                right: Timeline (default)

When an entry is opened, it overlays the right pane:
+---------------------+------------------------------------+
| [search.........]«  | [←][→] Salt-Rimmed Tavern  [＋][✎] |  entry header
| [NPC][Place][Quest] |  ...entry sheet (view or edit)...  |
| ☻ Bran the Ferryman |  Linked Scene: 🎬  [🔗 Link Scene] |
| ⌂ Drowned Docks     |  Description: lantern-light and…   |
| ⌂ Salt-Rimmed  ◄────|  (current row highlighted at left) |
+---------------------+------------------------------------+
```

The default window width grows from **760 → ~960px** to seat a permanent index
column beside the timeline. Height is unchanged.

## Behavior

### Left Index pane (always present)

Renders the same filtered/sorted record set the Index tab renders today, using
the existing `#indexEntries()` output and all existing controls:

- **Search, doctype chips, snippets toggle** — unchanged behavior, moved into
  this pane. The debounced partial-render + refocus logic for the search input
  is preserved.
- **List ordering follows the Sort control:**
  - **Sort = Name / Updated →** a **flat list**, each row `icon · name · type`
    (the compressed row from v1.2.6; group column already gone). The per-row
    type tag is shown.
  - **Sort = Type →** the list is **grouped under small type headers**; because
    the header names the type, the redundant per-row type tag is hidden within
    grouped mode.
- **Current-entry highlight:** when an entry is open, its row is highlighted
  (gold left-rail + bold), replacing the old rail's `.current` treatment.
- The old **"New Record" button is removed from these controls** (moved — see
  right-pane header). The index controls become purely find/filter/sort.

### Collapse

The existing rail toggle (`toggleRail` action + `RAIL_SETTING`) now collapses
the **left Index pane** to a thin strip (≈42px) showing only the reopen
control, letting the timeline or entry take near-full width. The setting is
client-scoped and persists, exactly as today.

### Right pane — Timeline (default)

The timeline renders exactly as today (`#timelineGroups()`, timepoints, record
chips, links, thumbnails toggle, drag/drop, add/rename/delete timepoint). It is
always the right pane when no entry is open. Its header holds the **thumbnails
toggle** and the **New Entry** button (below).

### Right pane — Entry overlay

Opening an entry (from an index row, a timeline chip, a content-link, or New
Entry) overlays the entry onto the right pane. The **timeline is not unmounted**
— it stays live underneath and is revealed when the entry is closed via Back or
by navigating to the index. Entry mounting continues to use `RecordPane` and the
deferred-render-on-inline-focus protections unchanged.

The entry header carries the existing controls: **Back / Forward** (pane
history), the entry **title**, **New Entry (＋)**, and **Edit (✎)** toggle
(shown only when the user can modify the entry).

### New Entry (＋) — relocated

The New Entry action (today `newRecord` in the index controls) becomes an
**icon button in the right-pane header**, placed **beside Edit** in the entry
header and beside the thumbnails toggle in the timeline header — so it is
reachable in both states. Its dialog and creation flow are unchanged; on create
it navigates to the new entry in edit mode as today.

## Components touched

- **`templates/hub/`** — merge `index.hbs`, `timeline.hbs`, and `record.hbs`
  into a two-pane structure (index part + right-pane part with timeline and an
  entry-overlay region). Remove the tab nav from `header.hbs`. Move the New
  Entry button into the right-pane header; drop the rail markup.
- **`scripts/apps/hub/hub-mixin.mjs`** — remove `TABS` / tab plumbing and the
  Index↔Timeline drag-to-hover-tab handling; render index + timeline together;
  drive the entry overlay from `state.view`; retarget `toggleRail` at the left
  Index pane; drop `#railGroups()` (the left Index is now the single list).
  Widen default `position.width`.
- **`styles/campaign-record.css`** — two-pane flex layout; collapsed-strip
  state; entry overlay (`position:absolute; inset:0`) over the timeline;
  flat-vs-grouped list styles with smaller type headers; right-pane header with
  New/Edit/thumbnails; retire `.hub-record` / `.record-rail` / tab styles.
- **Tests** — update Hub e2e specs that assume tabs (`06-hub-index`,
  `08-hub-timeline`, `21-hub-record-pane`) and any that click the tab nav or the
  index-hosted New Record button; assert the two-pane layout, overlay, collapse,
  New-beside-Edit placement, and flat/grouped sort behavior.

## Non-goals / preserved invariants

- Search engine, snippet data, timeline data model, entry sheets, group model,
  and pane-history semantics are unchanged.
- GM visibility filtering, hidden-entry handling, and permission checks on
  edit/timeline actions are unchanged.
- Inline-edit focus protection (deferred re-render while typing in the pane
  mount) is preserved.
- The v1.2.6 scene picker and doctype-chips filter are reused, not modified.
