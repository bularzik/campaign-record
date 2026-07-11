# Import Document Dialog — Scrollable Review List

**Date:** 2026-07-11
**Status:** Approved design
**Area:** Import wizard (`scripts/apps/import-wizard.mjs`, `templates/import/wizard.hbs`, `styles/campaign-record.css`)

## Problem

The Import Document wizard's review step renders one row per detected section in
a `.import-sections` table, with the action buttons (Cancel / Back / **Create**)
in a `<footer>` below the table. The window is an `ApplicationV2` opened with
`position: { width: 640, height: "auto" }`, so it grows to fit its content.

When a document is split into many sections, the table grows taller than the
viewport. The footer is pushed below the bottom of the screen, and because the
window is not a scroll region, the user cannot reach the buttons and cannot
complete the import.

There are currently no wizard-specific styles; the dialog relies entirely on
Foundry defaults.

## Goal

The action buttons must always be reachable regardless of how many sections a
document produces, without the window ever exceeding the viewport.

## Approach — Sticky footer + scrollable section list

Constrain the wizard to a viewport-relative maximum height and restructure the
review step into a vertical stack:

- **Pinned top:** the target-group header (`.form-group`).
- **Scrolling middle:** the `.import-sections` table is the only region that
  scrolls when sections overflow. The table head (`<thead>`) stays visible via
  sticky positioning so column labels remain readable while scrolling.
- **Pinned bottom:** the footer (Cancel / Back / Create) is always visible.

This is the most idiomatic Foundry fix and fully solves the reported problem.
Alternatives considered and rejected: whole-dialog scroll (buttons reachable
only after scrolling to the bottom, not always visible) and pagination (adds
interaction complexity and complicates merge/split across page boundaries —
heavier than the problem warrants).

## Changes

### `templates/import/wizard.hbs`
- Wrap `<table class="import-sections">` in a scroll container
  (`<div class="import-sections-scroll">`) inside the `.import-review` form.
- No logic or data changes; the `.form-group` header and `<footer>` remain
  siblings of the scroll container so they can be pinned.

### `styles/campaign-record.css`
Add rules scoped to `.import-wizard-app` (the app's class) — the first
wizard-specific CSS in the file:
- Cap the window height at a viewport-relative maximum (~85–90vh).
- Make `.import-review` a flex column with `min-height: 0`.
- Give `.import-sections-scroll` `flex: 1; overflow-y: auto; min-height: 0`.
- Keep `.form-group` (header) and `.form-footer` (footer) `flex: 0 0 auto` so
  they stay pinned.
- Make `.import-sections thead th` `position: sticky; top: 0` so column headers
  stay visible while the body scrolls.

### `scripts/apps/import-wizard.mjs`
- Keep `height: "auto"` so the short source step still auto-sizes; the CSS
  max-height provides the cap for the review step.
- No behavior change expected. During implementation, confirm whether a
  `max-height` position hint is needed alongside the CSS cap for the window
  content to become a bounded scroll container.

## Testing

- The logic layer (`scripts/logic/doc-import.mjs`) is unchanged, so the existing
  vitest suites remain green.
- This is a presentation fix (CSS + a template wrapper element), which vitest
  does not exercise. Verify visually via the Foundry manual/e2e path: import a
  document that produces enough sections to overflow the viewport and confirm
  the Create button is reachable and the window does not exceed the screen.
- No new unit tests are meaningfully addable for pure CSS layout.

## Out of scope

The split modal (`#promptSplit`, a `DialogV2`) can overflow the same way for a
section with very many blocks. This is the same class of bug but is not what was
reported. Recommended as a separate follow-up rather than bundled here.
