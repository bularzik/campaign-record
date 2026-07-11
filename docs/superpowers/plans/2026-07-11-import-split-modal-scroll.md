# Import Split Modal Scrollable Block List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the import wizard's "Split section" dialog's Cancel / Split buttons reachable when a section has many blocks, by capping and scrolling the block list instead of letting the dialog grow past the viewport.

**Architecture:** CSS-only fix. The split dialog's `content` is `<div class="cr-split-modal">…</div>` and the Cancel/Split buttons are rendered by `DialogV2` in its own footer, *outside* `.cr-split-modal`. Capping `.cr-split-modal` with a viewport-relative `max-height` + `overflow-y: auto` bounds the content so the dialog auto-sizes to content-plus-buttons and always fits the screen.

**Tech Stack:** Foundry VTT v13 `DialogV2`, plain CSS, Playwright e2e against the shared local Foundry server, vitest for the (unchanged) logic layer.

## Global Constraints

- **CSS only.** No changes to `scripts/apps/import-wizard.mjs` (`#promptSplit`), `templates/import/wizard.hbs`, or any logic. The `.cr-split-modal` / `.cr-split-block` / `.cr-split-gap` markup stays as-is.
- CSS scoped to the module-unique `.cr-split-modal` class. House style: `rem`/viewport units, 2-space indent, matches existing rules in `styles/campaign-record.css`.
- Exact rule to add: `max-height: 70vh; overflow-y: auto;` on `.cr-split-modal`.
- Existing vitest suites must stay green (`npm test`).
- **The full e2e suite must be run this time** (the user has disconnected from the local Foundry server, freeing it). **Before running any e2e, read and follow the `foundry-e2e` skill** — it governs session locking, the module symlink, server start, and unlock for the shared install.
- Work on branch `worktree-import-dialog-scroll` (already checked out); this extends PR #9. Do not create a new branch or PR.

---

### Task 1: Failing e2e regression test — split dialog stays on-screen

Add a test that opens the Split dialog on a multi-block section and fails against today's code because `.cr-split-modal` is not capped.

**Files:**
- Modify: `tests/e2e/21-import-export.spec.mjs` (add one `test(...)` inside the existing `test.describe("import and export", …)` block, after the review-list test added on this branch)

**Interfaces:**
- Consumes: the existing `gmPage` fixture, `FIXTURE` constant (`adventure-notes.docx`), the `#campaign-record-import` wizard id, the review-table split control `[data-action="splitSection"]`, and the dialog markup from `#promptSplit` (`.cr-split-modal`, buttons `[data-action="split"]` / `[data-action="cancel"]`). All already exist.
- Produces: nothing consumed by later tasks; a verification deliverable.

- [ ] **Step 1: Write the failing test**

Insert this test inside the `describe` block, immediately after the closing `});` of the `"review step keeps the Create button on-screen for a many-section import"` test:

```javascript
  test("split dialog keeps the Split button on-screen for a many-block section", async () => {
    await gmPage.evaluate(async () => {
      const { ImportWizard } = await import("/modules/campaign-record/scripts/apps/import-wizard.mjs");
      ImportWizard.open();
    });
    const wizard = gmPage.locator("#campaign-record-import");
    await wizard.waitFor({ timeout: 15_000 });
    await wizard.locator('[data-source-id="docx-file"] input[type="file"]').setInputFiles(FIXTURE);

    // Wait for the review step, then open the split dialog on the first
    // section that can be split (a section with more than one block).
    await expect(wizard.locator("table.import-sections tbody tr").first()).toBeVisible({ timeout: 30_000 });
    const splitBtn = wizard.locator('[data-action="splitSection"]:not([disabled])').first();
    await expect(splitBtn).toBeVisible({ timeout: 15_000 });
    await splitBtn.click();

    const dialog = gmPage.locator("dialog, .application.dialog").last();
    await dialog.waitFor({ timeout: 15_000 });
    const modal = dialog.locator(".cr-split-modal");
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // The block list must be a bounded scroll region (the fix); pre-fix the
    // computed overflow-y is "visible" and max-height is "none".
    const box = await modal.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { overflowY: cs.overflowY, maxHeight: cs.maxHeight };
    });
    expect(box.overflowY).toBe("auto");
    expect(box.maxHeight).not.toBe("none");

    // The dialog must fit the viewport and the Split button must be on-screen.
    const viewport = gmPage.viewportSize();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewport.height + 1);
    await expect(dialog.locator('[data-action="split"]')).toBeInViewport();

    // Close the dialog, then the wizard.
    await dialog.locator('[data-action="cancel"]').click();
    await dialog.waitFor({ state: "detached", timeout: 10_000 });
    await wizard.locator('[data-action="cancel"]').click();
    await wizard.waitFor({ state: "detached", timeout: 10_000 });
  });
```

- [ ] **Step 2: Run the test and verify it FAILS**

Follow the `foundry-e2e` skill to acquire the session lock and start the server, then run only the new test:

Run: `npx playwright test tests/e2e/21-import-export.spec.mjs -g "split dialog keeps the Split button on-screen"`
Expected: FAIL at `expect(box.overflowY).toBe("auto")` — pre-fix, `.cr-split-modal` has computed `overflow-y: visible` and `max-height: none`.

- [ ] **Step 3: Do not commit yet**

Leave the red test uncommitted; Task 2 adds the CSS and commits the test with the fix so no red commit lands. Do not `git add` in this task.

---

### Task 2: Add the cap-and-scroll CSS and verify green

Add the single CSS rule, confirm the e2e test passes, run the full e2e suite and vitest, then commit the test and fix together.

**Files:**
- Modify: `styles/campaign-record.css` (append one rule at the end of the file)
- Test: `tests/e2e/21-import-export.spec.mjs` (the Task 1 test — now expected to pass)

**Interfaces:**
- Consumes: the `.cr-split-modal` content class from `#promptSplit` (`import-wizard.mjs:216`).
- Produces: the final fix. No later task depends on it.

- [ ] **Step 1: Append the CSS rule**

Add to the end of `styles/campaign-record.css`:

```css
/* Split-section dialog: keep the Cancel/Split buttons reachable when a
   section has many blocks — scroll the block list instead of growing the
   dialog past the viewport. */
.cr-split-modal {
  max-height: 70vh;
  overflow-y: auto;
}
```

- [ ] **Step 2: Run the e2e test and verify it PASSES**

Following the `foundry-e2e` skill (server already up from Task 1, or re-acquire), run:

Run: `npx playwright test tests/e2e/21-import-export.spec.mjs -g "split dialog keeps the Split button on-screen"`
Expected: PASS — `.cr-split-modal` now reports `overflow-y: auto`, a numeric `max-height`, the dialog fits the viewport, and the Split button is on-screen.

- [ ] **Step 3: Run the full e2e suite (explicit user requirement)**

Run: `npm run test:e2e`
Expected: PASS — the full suite is green, including both import-wizard regression tests (`21-import-export.spec.mjs`) added on this branch. If any pre-existing spec fails for reasons unrelated to this change, capture the failure output and report it rather than silently proceeding.

- [ ] **Step 4: Run the vitest logic suite (regression guard)**

Run: `npm test`
Expected: PASS — all vitest suites green (logic untouched).

- [ ] **Step 5: Commit the test and the fix together**

```bash
git add styles/campaign-record.css tests/e2e/21-import-export.spec.mjs
git commit -m "fix: scroll split-section dialog so its buttons stay reachable

Cap .cr-split-modal at 70vh with overflow-y:auto so a section with many
blocks scrolls its block list instead of pushing the dialog's Cancel/Split
buttons off-screen. Add an e2e regression assertion. Follow-up to the
import review-list scroll fix on this branch.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Push to update PR #9**

Run: `git push`
Expected: the branch updates; PR #9 reflects the new commit. Follow the `foundry-e2e` skill's unlock step to release the shared server when done.

---

## Notes for the implementer

- The `.cr-split-modal` class is module-unique, so the bare selector does not need app-scoping — do not add a `classes` option to the `DialogV2.wait` call.
- If no fixture section is splittable (no enabled `[data-action="splitSection"]`), the test's `expect(splitBtn).toBeVisible()` will time out. This is not expected — `adventure-notes.docx` has multi-paragraph sections — but if it happens, report it as a fixture gap rather than weakening the test; the `overflow-y`/`max-height` computed-style assertions are the core regression guard and must stay.
- This is the follow-up flagged by the review-list fix; no other dialogs are in scope.
