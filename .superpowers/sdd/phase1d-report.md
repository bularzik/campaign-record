# Task 1d: inline-edit ProseMirror toolbar overlap — Report

## Summary

**Product CSS bug, fixed.** Not a stale test like 1a–1c.

## Reproduction

`npx playwright test tests/e2e/18-inline-edit.spec.mjs -g "prose fields save as-you-type" --trace on`

Failure: `locator.click` on `.editor-content` for `prose-mirror[name="system.description"]`
times out after 90s; retry log shows `<menu class="editor-menu" id="prosemirror-menu-...">`
"intercepts pointer events" repeatedly.

## Root cause

Extracted the trace and found the intercepting menu belonged not to the description
editor's *own* toolbar, but to the **sibling** `.gm-only` section's GM-notes editor.

A scratch geometry-dump spec (`tests/e2e/_debug-prose.spec.mjs`, deleted after use — not
committed) confirmed via `getBoundingClientRect()`:

| Element | top | bottom | height |
|---|---|---|---|
| `.record-description.form-group.stacked` (container) | 616.5 | 680.8 | 64.25 |
| `prose-mirror[name="system.description"]` (child) | 639.5 | **831.5** | 192 |
| `.gm-only.form-group.stacked` (container) | 680.8 | 745 | 64.23 |
| `prose-mirror[name="system.gmNotes"]` (child) | 703.8 | **895.8** | 192 |

Both `.form-group.stacked` sections are CSS flex children with `flex: 1 1 0; min-height: 0`
(`styles/campaign-record.css`), splitting the pane's leftover vertical space evenly. At the
`GroupHubSheet`'s own default size (760×640 — `scripts/apps/hub/group-hub-sheet.mjs:10`),
after the facts/objectives fields above them, only ~128px remains for BOTH stacked sections
combined — each gets ~64px. But their `prose-mirror` child has a hard
`--min-height: 12rem` (192px) floor (`styles/campaign-record.css:619-628`), and flexbox does
not let a child's min-height grow its already-flex-computed parent box; the child simply
renders past the parent's border edge. Neither the section nor the editor clipped that
excess, so:

- the description editor visually overflowed ~150px past its own section's bottom edge,
- painting on top of the GM-notes section immediately below it in DOM order,
- so `document.elementFromPoint` at the description editor's click coordinates resolved to
  the GM-notes section's `<menu class="editor-menu">` instead.

This reproduces with a **fresh, empty-content record** at the module's own shipped default
window size — not an artificially cramped test viewport. Any GM opening a Quest hub record
with both `description` and `gmNotes` populated, at the default `GroupHubSheet` size, would
hit the same misdirected click. Decision per the plan's rule: genuine product CSS bug.

## Fix

`styles/campaign-record.css` — added `overflow: hidden` to
`.record-pane-mount .campaign-record-content .form-group.stacked`:

```css
.record-pane-mount .campaign-record-content .form-group.stacked {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

This confines each stacked section's editor to its own flex-computed box instead of
bleeding into the next sibling's space. `.record-pane-mount` itself already has
`overflow-y: auto` (unchanged), so the pane as a whole remains scrollable.

**Visual/product change flagged:** at small pane heights where an editor's content would
have overflowed into a sibling's space (visually broken before), that editor's box is now
clipped to its computed flex height instead. No effect at pane sizes/content lengths where
neither editor needed to exceed its floor.

## Verification

Before applying the fix, verified the diagnosis wasn't a Playwright-only artifact: after
adding the CSS, re-ran the scratch spec and confirmed via `elementFromPoint` at the former
intercepting coordinate that it now resolves to a normal (non-overlapping) element, then
drove **actual click + type + save** through both editors independently:

- clicked and typed into `system.gmNotes`, polled the live document, confirmed the typed
  text landed in `gmNotes` (not lost, not misdirected).
- clicked and typed into `system.description`, same confirmation.

This rules out the fix merely relocating the bug (e.g., clipping away the description
editor's own clickable area). Ran the real failing test — passed, with its full original
assertions (content saved to the correct field, focus retained through the remount-survival
check). Then ran the full spec file and the combined Phase 1 exit-criteria run.

## Test results

- `tests/e2e/18-inline-edit.spec.mjs` alone: **7/7 passed** (28.3s; was 1 failure of 6 tests
  reported in baseline — the file has grown to 7 tests since the baseline was recorded).
- Phase 1 exit criteria — `21-hub-record-pane.spec.mjs` + `22-group-hub-sheet.spec.mjs` +
  `18-inline-edit.spec.mjs` combined: **30/30 passed**, wall time 3.7 min (vs. baseline's
  ~7.4 min for just these three files, inflated by 90s-timeout failures). No `test.fixme`
  used.

## Phase 1 status

All of 1a, 1b, 1c, 1d are now COMPLETE. Phase 1 exit criteria met.

## Commit

`fix(campaign-record): clip stacked prose-mirror sections to stop editor-toolbar overlap`
— includes the CSS fix and the plan doc Status/exit-criteria update.
