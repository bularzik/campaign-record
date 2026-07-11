# Index/Search Merge — Design

**Date:** 2026-07-11
**Status:** Approved, ready for implementation planning
**Branch/worktree:** `worktree-index-search-merge`

## Problem

The Campaign Hub has three tabs: Index, Timeline, and Search. The Index has a
tag-filter text box that narrows the record list by a case-insensitive
substring match on each record's tags. The Search tab is a separate,
full-content search across all groups with prefix matching and snippets that
show *where* a query matched.

Two issues motivated this work:

1. **Redundancy in the mental model.** Finding a record happens in two places
   (filter the Index, or use the Search tab), which is more UI than the value
   justifies. Simpler is better: there should be one place to find records.
2. **A misunderstanding about tags.** Tags *are* editable — every record type
   includes a tags editor in its Edit sheet and in inline-edit mode — but it
   renders as Foundry's generic, unpolished `formGroup` widget over a free
   string set, so it's easy to miss. This is noted for context but is **out of
   scope**; tags are not being removed or redesigned here.

## Decision

Merge Search into the Index and remove the standalone Search tab. The Index
becomes the single place to find records. The existing search engine
(`scripts/logic/search-index.mjs`) is unchanged — it simply feeds the Index
instead of a separate tab.

Explicitly **out of scope**: the tags data model and tag editor, and the entire
group model (creation, selection, scoping). Groups are being handled, if at
all, in a separate future session.

## Behavior

### Unified search box

The Index's current tag-filter text box becomes a single search box that drives
the search engine. Internally, `state.tag` and `state.query` collapse into one
`state.query`.

- **Empty or 1 character:** the Index shows today's behavior — the full record
  list, with type/group filters and sort applied. (The 2-char floor matches the
  search engine's existing minimum; below it, no content search runs.)
- **2+ characters:** the Index list is intersected with search-engine hits,
  which match against name, tags, **and** all record content. The current
  type/group filters, sort, and GM visibility are all still honored. Because the
  engine already indexes tags, tag-filtering is preserved for free — no
  dedicated tag box is needed.

### Snippets toggle

A `☑ snippets` checkbox sits next to the search box, **off by default**, with
its state remembered as a client setting.

- **Off:** matching rows stay compact (today's row layout).
- **On:** each content-matched row expands to show its per-field snippets,
  reusing the `matches: [{ field, snippet }]` array the engine already returns.

Name-only or tag-only matches have no snippet to show and render compact either
way.

### "Matches in other groups" hint

Because search now respects the current filters, a record that matches but is
hidden by the active type/group filters would silently not appear. To cover
that, when filters are active the Index runs one additional unscoped search
(ignoring type/group filters) and diffs the counts. If matches exist outside the
current filters, it shows an actionable line:

> *N more matches in other groups — clear filters*

Clicking anywhere on the line clears the active filters (no separate "dismiss"
affordance — changing the query or clearing filters makes it go away). The hint
only appears when N > 0 **and** filters
are active. On the default "All Groups" view with no type filter, there are no
"other" areas, so it never shows.

### Type filter: chips → multi-select dropdown

The `type-chips` button row becomes a single multi-select dropdown to reclaim
horizontal space. It drives the same `state.types` Set the chips drive today, so
the filtering logic is unchanged — only the control and its change-handler
change. Foundry v13's `<multi-select>` custom element renders selected types as
removable chips inside one compact control.

Resulting header row:
`[type ▾] [search box……] [☑ snippets] [sort ▾] [hidden] [clear] [+ New]`

## Components

### Removed

- The `search` tab (`static TABS.primary`), the `search` PART, and
  `templates/hub/search.hbs`.
- `#searchResults()` and `context.searchGroups`; the standalone search-input
  binding — all folded into the Index path.
- `state.tag` and the `tag-filter` `<input>` — replaced by `state.query` driving
  the unified box.

### Kept (now feeding the Index)

- `scripts/logic/search-index.mjs` — the inverted index, prefix matching,
  snippets, GM-only field filtering.
- `#ensureSearchIndex()` and the live re-index document hooks
  (`_onDocumentChanged`).

### Changed

- `#indexEntries()` becomes the single source of truth for the record list.
  With a 2+ char query it runs the engine (scoped to the current group/type
  filters, respecting GM visibility), attaches each hit's `matches[]` to its row
  for the snippet toggle, then sorts. Under 2 chars it returns today's plain
  filtered list.
- `templates/hub/index.hbs` — replace the type-chips row with the dropdown,
  replace the tag-filter input with the search box + snippets checkbox, and add
  optional per-row snippet rendering and the "other groups" hint.
- Header-row control bindings in the mixin — the search input, the snippets
  toggle, and the type dropdown change-handlers.

## Data flow

1. User types in the search box → debounced → `state.query` updated →
   Index part re-renders.
2. `#indexEntries()`:
   - `< 2` chars: `collectRecords` → apply type/group/hidden filters → sort.
   - `>= 2` chars: `collectRecords` for the visible set → run `search(index,
     query, { gm })` → keep hits present in the visible set → attach
     `matches[]` → apply type/hidden filters → sort.
3. If filters are active, run one unscoped `search` and compute the count of
   matches not present in the filtered result → feed the "other groups" hint.
4. Template renders rows; if the snippets client setting is on, matched rows
   render their `matches[]` snippets.

## Error / edge handling

- **1-char query:** no content search; full filtered list (documented above).
- **GM-only content:** already handled by `search(..., { gm })`; non-GM users
  never see `gm:`-prefixed snippets.
- **Empty query with snippets toggle on:** nothing to expand; toggle is inert.
- **Stale index on document change:** existing re-index hooks already keep the
  index current; unchanged.

## Testing

- Grep for and update existing tests that reference the Search tab,
  `tag-filter`, `searchGroups`, or `state.tag`.
- Add coverage: unified-box content matching at the 2-char boundary; snippets
  toggle on/off row rendering; the type dropdown driving `state.types`; the
  "other groups" hint appearing only when filters hide matches.
- Localization: add strings for the snippets toggle label, the search-box
  placeholder, and the "other groups" hint; remove the Search tab label. Repurpose
  or retire `CAMPAIGNRECORD.Hub.FilterTag`.
- Run the vitest suite and the relevant Playwright hub specs.

## Non-goals

- Removing or redesigning tags (the data field or its editor).
- Any change to the group model: creation, the group picker, scoping, or
  cross-group record assignment.
- Changes to the search engine's matching algorithm or indexed fields.
