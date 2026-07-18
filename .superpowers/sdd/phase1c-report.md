# Phase 1 Task 1c Report — group-hub-sheet New Entry dialog

**Spec:** `tests/e2e/22-group-hub-sheet.spec.mjs`
**Failure fixed:** `:67` "a record created into another group opens in this hub's pane in edit mode"

## Method

Followed the plan's systematic-debugging steps: reproduced the failure in isolation with
`--trace on` (`-g "record created into another group"`), read the Playwright error-context DOM
snapshot at the timeout, formed and verified a root-cause hypothesis against the product source,
fixed the test, then reran in isolation and as the full spec file.

## Failure — `:67`

**Symptom:** `page.locator('dialog select[name="group"] ...').selectOption(b.groupId)` timed out
at 90s. The test opens Alpha's `GroupHubSheet`, opens New Entry, fills name + type, then tries to
select group Beta from a `select[name="group"]` that never appears.

**Trace evidence:** The error-context DOM snapshot at timeout shows the New Entry dialog with
exactly one `<select>` (the type select, already showing "NPC" selected) and the filled name
textbox — no second `<select>` for group at all. The dialog markup itself never renders a group
picker in this context.

**Root cause:** `scripts/logic/new-record-form.mjs` `buildNewRecordGroupField(groups, current)`
sets `showGroupPicker: !scoped`, where `scoped = groups.some(g => g.id === current)`.
`GroupHubSheet.groupScopeId` (`scripts/apps/hub/group-hub-sheet.mjs:15-17`) returns
`this.document.id` — the sheet's own group — which is always a valid group in the list, so
`scoped` is always `true` and the group `<select>` is never rendered on a `GroupHubSheet`'s New
Entry dialog. `#onNewRecord` (`scripts/apps/hub/hub-mixin.mjs:369-408`) resolves
`groupId: button.form.elements.group?.value ?? this.groupScopeId` — with no select present, it
always falls through to the scoped group.

This is intentional, already-shipped product behavior: commit `3758d71` ("Hide New Entry record
selector when hub is scoped to a group", PR #18, merged 2026-07-13) — its message states
verbatim: "When the campaign hub is scoped to a single group, the New Entry dialog hides the
redundant campaign-record selector and defaults the entry into the scoped group." Confirmed via
`git log -S "record created into another group"` that this test was added in commit `a39b739` on
2026-07-10 — three days *before* PR #18 shipped the behavior the test now contradicts. The test
is stale against an intentional design change, same pattern as Task 1a/1b's failures (test bugs
against intentional, already-shipped product behavior, not product regressions).

**Second latent issue (found after fixing the group-picker block):** once the group-select step
was removed, the test still failed at `await expect(sheet.locator(".record-pane-mount
form")).toBeVisible()`. `.record-pane-mount form` is used nowhere else in the entire e2e suite
(confirmed by grep across all specs) — every other spec asserts on
`.campaign-record-content.inline-edit` or a named field directly. Root cause:
`RecordPane.mount()` (`scripts/apps/hub/record-pane.mjs:44-53`) forces `tag: "div"` for
`mode === "view"`, and `#onNewRecord`'s `navigateToRecord(page.uuid)` call takes no mode option,
defaulting to `"view"`. A freshly created record therefore never gets a literal `<form>` root —
it opens in view mode, which (with `inlineEditing` defaulting on, same mechanism as Task 1a/1b)
renders NPC fields as live `<input>`s inside a `<div>`, not inside a `<form>`. This assertion
predates PR #18 and never held under current behavior; it was masked in the original test by the
earlier `selectOption` timeout that always fired first.

## Fix (test-only)

- Reworked the test to reflect current dialog behavior: assert the group `<select>` is absent
  (`toHaveCount(0)`) instead of trying to select a different group, with a comment naming PR #18
  as the reason. Kept a second group ("Beta") in the test purely to prove scoping holds even when
  other groups exist to pick from (mirrors `buildNewRecordGroupField`'s actual logic, which
  doesn't care about group count).
- Replaced the stale `.record-pane-mount form` assertion with
  `.record-pane-mount .campaign-record-content.inline-edit` (the convention used everywhere else
  in the suite) plus a direct `[name="system.role"]` visibility check, matching the sibling
  `21-hub-record-pane.spec.mjs:229` assertion style, with a comment explaining why no literal
  `<form>` appears.
- Renamed the test from "a record created into another group opens in this hub's pane in edit
  mode" to "a record created via New Entry opens in this hub's pane in edit mode" (the "into
  another group" premise is no longer reachable through this UI).
- Final assertions confirm the record lands in Alpha (the scoped group) and NOT in Beta.

No product code changed. No `test.fixme()` used. No blind waits or force-clicks introduced.

## Verification

- Isolated rerun of the fixed test (`--trace on`): 1 passed (7.9s).
- Full spec file (`npx playwright test tests/e2e/22-group-hub-sheet.spec.mjs`), all 4 tests:
  **4 passed** (29.0s).

## Root cause classification

Test bug against intentional, already-shipped product behavior — not a product regression.
Two compounding stale assertions in the same test: (1) expecting a group picker that PR #18
deliberately removed for scoped hubs, and (2) expecting a literal `<form>` element that inline-
editing-default-on (same mechanism identified in Task 1a/1b) never produces for a freshly
created record opened in view mode. No product behavior-change flag needed for the PR
description beyond noting the test now correctly reflects PR #18's group-picker-hiding design.
