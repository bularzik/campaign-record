# Import Split Modal — Scrollable Block List

**Date:** 2026-07-11
**Status:** Approved design
**Branch:** `worktree-import-dialog-scroll` (extends PR #9)
**Area:** Import wizard split dialog (`scripts/apps/import-wizard.mjs` `#promptSplit`, `styles/campaign-record.css`)

## Problem

The "Split section" dialog is built in `#promptSplit` (`import-wizard.mjs:204-233`)
as a `DialogV2.wait` whose `content` is
`<div class="cr-split-modal">…one <p class="cr-split-block"> per block…</div>`.
For a section with many blocks, that div grows taller than the viewport, the
dialog outgrows the screen, and Foundry's **Cancel / Split** buttons — rendered
in the dialog's own footer as siblings of `.cr-split-modal` — get pushed
off-screen and become unreachable.

This is the same class of bug fixed for the review list in the
`2026-07-11-import-dialog-scroll-design.md` spec, and was flagged there as an
explicit follow-up.

## Goal

The Split dialog's action buttons must stay reachable regardless of how many
blocks a section contains, without the dialog exceeding the viewport.

## Approach — cap and scroll the block list (CSS only)

Mirror the review-list fix, adapted to a dialog. Because the buttons live
*outside* `.cr-split-modal` (in the dialog's own footer), capping the content
div is sufficient — no change to the dialog chrome is needed.

- Add CSS scoped to `.cr-split-modal`: a viewport-relative `max-height` (~70vh,
  leaving room for the dialog title and button row) plus `overflow-y: auto`.
- The block list scrolls internally; the dialog auto-sizes to the capped content
  plus its button row, so it always fits the viewport and Cancel / Split stay
  visible.

The `.cr-split-modal` class is unique to this module, so the selector needs no
app-scoping. Alternatives considered and rejected: whole-dialog scroll (buttons
reachable only after scrolling) and adding a `classes` option to the
`DialogV2.wait` call (unnecessary indirection — the unique content class is
already targetable).

## Changes

### `styles/campaign-record.css`
Append one rule (no other wizard CSS changes):

```css
/* Split-section dialog: keep the Cancel/Split buttons reachable when a
   section has many blocks — scroll the block list instead of growing the
   dialog past the viewport. */
.cr-split-modal {
  max-height: 70vh;
  overflow-y: auto;
}
```

### `scripts/apps/import-wizard.mjs`, `templates/import/wizard.hbs`
No changes. The `#promptSplit` content, the `.cr-split-block` / `.cr-split-gap`
markup, and the logic layer are untouched.

## Testing

- Add an e2e regression test (in `tests/e2e/21-import-export.spec.mjs`) that:
  opens the review step, clicks the Split control on a multi-block section,
  and asserts the dialog fits the viewport, the Split confirm button is
  on-screen, and `.cr-split-modal` is capped (`overflow-y: auto` with a
  `max-height` shorter than its `scrollHeight` when content overflows).
- If no fixture section has enough blocks to exceed 70vh, the test still asserts
  the applied `overflow-y: auto` + `max-height` computed style (proving the rule
  engages) plus the dialog-fits-viewport check, rather than relying on a taller
  fixture.
- Per the user's note that the local Foundry server is now free, **run the full
  e2e suite** via the `foundry-e2e` contract to validate this test plus the
  earlier review-list test (`21-import-export.spec.mjs`).
- The logic layer is unchanged, so existing vitest suites (`npm test`) stay
  green. No new unit tests are meaningfully addable for pure CSS.

## Out of scope

No other dialogs are in scope. The review-list fix from the companion spec is
already committed on this branch (commit `4dad6c5`).
