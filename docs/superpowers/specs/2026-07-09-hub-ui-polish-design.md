# Campaign Hub UI Polish — Design

**Date:** 2026-07-09
**Branch:** `feature/hub-ui-polish` (worktree `.claude/worktrees/hub-ui-polish`)
**Status:** Approved

## Problem

The Campaign Hub wastes vertical space and has visual rough edges:

- The Index tab's 11 type-filter chips (10 record types + journal) each render on
  their own row because Foundry v13's base styles give buttons `width: 100%` and
  `.type-chip` never overrides it. `.index-controls` already declares
  `display: flex; flex-wrap: wrap`, but full-width children defeat it.
- There is no one-click way to clear active filters, and no indication of how
  many records the filters are hiding.
- The record list has no row separation and its trailing columns
  (subtitle/type/group) drift out of alignment between rows.
- Timeline timepoint edit buttons (insert/rename/delete) are always visible,
  cluttering every row; the Add Timepoint button is full-width.
- Search results are styled inconsistently with the Index list.

## Design

### 1. Index tab — controls restructure

`templates/hub/index.hbs`: split the single `.index-controls` container into
two rows:

- **`.type-chips` row** — the 11 chip buttons as compact pills:
  `width: auto`, reduced padding and font size, rounded corners (match the
  existing `.record-chip` pill look), wrapping across lines as needed.
- **`.index-controls` row** — tag filter input, sort select, hidden-only
  toggle (GM only), clear-filters button, filtered count, New Record button.

Target: ~3 rows total at the default 760px window width, down from ~14.

### 2. Clear-filters affordance + filtered count

- New `clearFilters` action on `CampaignHub` that resets `state.types`,
  `state.tag`, and `state.hiddenOnly` (not group/sort) and re-renders. The
  button renders only when at least one of those filters is active.
- A filtered count ("12 of 87") beside it, computed in `_prepareContext` from
  the filtered records length vs. unfiltered `collectRecords` total. Shown only
  while filters are active.
- New i18n keys in `lang/en.json`: `CAMPAIGNRECORD.Hub.ClearFilters` and
  `CAMPAIGNRECORD.Hub.FilteredCount` (format string with `{shown}`/`{total}`).

### 3. Record list readability

`styles/campaign-record.css` only:

- Zebra striping on `.record-row:nth-child(even)` with a subtle background;
  hover keeps a stronger background.
- Stable grid template: icon and name flex, subtitle/type/group columns get
  bounded widths with `text-overflow: ellipsis` so they align down the list.
- Slightly tighter row padding.

### 4. Timeline tab cleanup

CSS only:

- Timepoint edit buttons hidden (`opacity: 0`) until `.timepoint:hover`, with a
  `:focus-visible` rule so keyboard users can still tab to them.
- Add Timepoint button becomes auto-width.

### 5. Search tab touch-up

CSS only: result-type `h3` headers sized consistently with hub typography; hit
rows get the same padding/divider treatment as index rows.

## Out of scope

- No changes to filtering/sorting/search/drag-drop logic.
- No changes to record sheets or the presenter.
- No toolbar partial extraction (single consumer — YAGNI).

## Files touched

| File | Change |
| --- | --- |
| `templates/hub/index.hbs` | Two-row controls, clear button, count |
| `scripts/apps/hub/campaign-hub.mjs` | `clearFilters` action, count + `hasActiveFilters` context |
| `styles/campaign-record.css` | Pills, rows, zebra, hover-reveal, search |
| `lang/en.json` | Two new keys |
| `tests/e2e/06-hub-index.spec.mjs`, `07-hub-search.spec.mjs`, `15-hub-types.spec.mjs` | Selector updates if the restructure moves asserted markup; new coverage for clear-filters |

## Error handling

No new failure modes: `clearFilters` only mutates in-memory UI state and
re-renders. The count derives from data already collected for rendering.

## Testing

- Unit: vitest suite stays green (no logic modules change except the hub app's
  context prep, which is covered via e2e).
- E2E (Playwright, Foundry World B): existing hub specs updated for any moved
  selectors; add assertions that (a) chips lay out horizontally (multiple chips
  share a row / controls area height under a threshold), (b) clear-filters
  resets type+tag+hidden filters and disappears when nothing is filtered,
  (c) the count reflects the filtered list.
- i18n coverage gate: new keys present in `lang/en.json`.
