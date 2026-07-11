# Import Dialog Scrollable Review List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Import Document wizard's review step keep its action buttons reachable when a document splits into many sections, without the window ever exceeding the viewport.

**Architecture:** Cap the `ApplicationV2` window at a viewport-relative height and turn the review step into a flex column: the target-group header and the footer are pinned, and only the `.import-sections` table scrolls. This is a presentation fix — a template wrapper element plus wizard-scoped CSS. No JavaScript logic changes.

**Tech Stack:** Foundry VTT ApplicationV2 + Handlebars templates, plain CSS, Playwright e2e (against the shared Foundry install), vitest for the (unchanged) logic layer.

## Global Constraints

- No changes to `scripts/logic/doc-import.mjs` or any import logic — this is presentation only. Existing vitest suites must stay green (`npm test`).
- CSS must be scoped to `.import-wizard-app` (the wizard app's class from `ImportWizard.DEFAULT_OPTIONS.classes`) so no other sheet is affected. Match house style: class-scoped selectors, `rem` units, CSS vars with literal fallbacks (e.g. `var(--color-…, #hex)`), 2-space indent.
- The window keeps `position: { width: 640, height: "auto" }` in `import-wizard.mjs` — the CSS max-height provides the cap. Do not change the position object unless visual verification proves it necessary (see Task 2, Step 6).
- **Before running any e2e (`npm run test:e2e`), read and follow the `foundry-e2e` skill** — it governs session locking, the module symlink, and unlock for the shared Foundry install. Do not start the Foundry server or run Playwright without it.

---

### Task 1: Failing e2e regression test — Create button stays on-screen

Add a test to the existing import spec that fails against today's code: with a 30+ section document, assert the window fits the viewport, the Create button is on-screen, and the section list (not the window) is the scroll region. Today's `createImport` test passes only because Playwright auto-scrolls to click — this test checks what a human actually sees.

**Files:**
- Modify: `tests/e2e/21-import-export.spec.mjs` (add one `test(...)` inside the existing `test.describe("import and export", …)` block, after the import test at line 78)

**Interfaces:**
- Consumes: the existing `gmPage` fixture, `FIXTURE` constant (`adventure-notes.docx`, ~33 sections), and `#campaign-record-import` wizard id — all already defined in this file.
- Produces: nothing consumed by later tasks; this is a verification deliverable. It references `.import-sections-scroll`, the wrapper element Task 2 adds.

- [ ] **Step 1: Write the failing test**

Insert this test immediately after the closing `});` of the `"GM imports the adventure-notes docx through the wizard"` test (currently line 78), still inside the `describe` block:

```javascript
  test("review step keeps the Create button on-screen for a many-section import", async () => {
    await gmPage.evaluate(async () => {
      const { ImportWizard } = await import("/modules/campaign-record/scripts/apps/import-wizard.mjs");
      ImportWizard.open();
    });
    const wizard = gmPage.locator("#campaign-record-import");
    await wizard.waitFor({ timeout: 15_000 });

    await wizard.locator('[data-source-id="docx-file"] input[type="file"]').setInputFiles(FIXTURE);

    // Review step: the fixture produces 30+ rows — enough to overflow the viewport.
    const rows = wizard.locator("table.import-sections tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(30);

    const viewport = gmPage.viewportSize();
    const win = await wizard.boundingBox();

    // The window must never be taller than the screen.
    expect(win.y + win.height).toBeLessThanOrEqual(viewport.height + 1);

    // The Create button must be fully visible within the window bounds.
    const createBtn = wizard.locator('[data-action="createImport"]');
    await expect(createBtn).toBeInViewport();
    const btnBox = await createBtn.boundingBox();
    expect(btnBox.y + btnBox.height).toBeLessThanOrEqual(win.y + win.height + 1);

    // The section list — not the window — must be the scroll region.
    const listScrolls = await wizard.locator(".import-sections-scroll").evaluate(
      (el) => el.scrollHeight > el.clientHeight + 1
    );
    expect(listScrolls).toBe(true);

    // Close without importing (creates no group; nothing to clean up).
    await wizard.locator('[data-action="cancel"]').click();
    await wizard.waitFor({ state: "detached", timeout: 10_000 });
  });
```

- [ ] **Step 2: Run the test and verify it FAILS**

First follow the `foundry-e2e` skill to acquire the session lock and start the server. Then run only the new test:

Run: `npx playwright test tests/e2e/21-import-export.spec.mjs -g "keeps the Create button on-screen"`

Expected: FAIL. Pre-fix, the `.import-sections-scroll` element does not exist (its `.evaluate` rejects / the locator has no match) and/or `win.y + win.height` exceeds the viewport height because the auto-height window grows past the screen.

- [ ] **Step 3: Do not commit yet**

Leave the red test uncommitted; Task 2 makes it green and commits the test together with the fix so no red commit lands in history. Do not `git add` the spec file in this task.

---

### Task 2: Implement the fix — template wrapper + wizard-scoped CSS

Wrap the review table in a scroll container and add wizard-scoped CSS that caps the window, scrolls the list, and pins the header and footer.

**Files:**
- Modify: `templates/import/wizard.hbs:29-69` (wrap `<table class="import-sections">…</table>` in a `<div class="import-sections-scroll">`)
- Modify: `styles/campaign-record.css` (append wizard rules at end of file, currently 556 lines)
- Test: `tests/e2e/21-import-export.spec.mjs` (the test from Task 1 — now expected to pass)

**Interfaces:**
- Consumes: the `.import-sections-scroll` selector asserted by Task 1; the `.import-review`, `.form-group`, `.form-footer`, and `.import-sections` classes already in `wizard.hbs`; the `.import-wizard-app` class from `import-wizard.mjs`.
- Produces: the final fix. No later task depends on it.

- [ ] **Step 1: Wrap the review table in a scroll container**

In `templates/import/wizard.hbs`, inside `<form class="import-review">`, wrap the existing `<table class="import-sections">` … `</table>` block (lines 29–69) in a new div so the form's direct children become: `.form-group`, `.import-sections-scroll`, `.form-footer`.

Change:
```hbs
    <table class="import-sections">
```
to:
```hbs
    <div class="import-sections-scroll">
    <table class="import-sections">
```
and change the table's closing tag:
```hbs
    </table>
```
to:
```hbs
    </table>
    </div>
```
Do not alter the `<thead>`, `<tbody>`, rows, or any `{{#each}}` — only add the wrapping div.

- [ ] **Step 2: Append the wizard CSS**

Add to the end of `styles/campaign-record.css`:

```css
/* Import wizard: keep the review step's actions reachable when a document
   splits into many sections. Cap the window height, scroll only the section
   list, and pin the group header and the footer buttons. */
.import-wizard-app {
  max-height: 90vh;
}

.import-wizard-app .window-content {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.import-wizard-app .import-review {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.import-wizard-app .import-review > .form-group,
.import-wizard-app .import-review > .form-footer {
  flex: 0 0 auto;
}

.import-wizard-app .import-sections-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.import-wizard-app .import-sections thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background-color: var(--color-bg-option, var(--color-bg, #e8e6dc));
}
```

- [ ] **Step 3: Run the logic test suite (regression guard)**

Run: `npm test`
Expected: PASS — all existing vitest suites green (the logic layer is untouched). This confirms the presentation change broke nothing.

- [ ] **Step 4: Run the e2e regression test and verify it PASSES**

Following the `foundry-e2e` skill (session lock + server already up from Task 1, or re-acquire), run:

Run: `npx playwright test tests/e2e/21-import-export.spec.mjs -g "keeps the Create button on-screen"`
Expected: PASS — window fits the viewport, the Create button is on-screen, and `.import-sections-scroll` is the scroll region.

- [ ] **Step 5: Run the full import/export e2e spec (no regression)**

Run: `npx playwright test tests/e2e/21-import-export.spec.mjs`
Expected: PASS — the original import and export tests still pass alongside the new one.

- [ ] **Step 6: Visual confirmation**

With the Foundry server still up, open the wizard and import `adventure-notes.docx` (or any 30+ section docx). Confirm by eye:
- The whole window fits on screen; the footer's Cancel / Back / **Create** buttons are visible without scrolling.
- Scrolling happens inside the section list; the target-group header and footer stay put.
- The sticky table header (`Section / Type / Timepoint / Adjust`) has a readable, opaque background as rows scroll under it. If the background color looks wrong for the theme, adjust the `background-color` value in the `thead th` rule (this is the one value the plan leaves to visual judgment).
- If — and only if — the window still fails to bound its content (list does not scroll, footer clipped), fall back to a concrete numeric height: set `height: 760` (px) in the `position` object in `scripts/apps/import-wizard.mjs`, which forces `.window-content` to become a bounded scroll container, then re-verify. Prefer the CSS-only solution; treat this as a documented fallback only.

- [ ] **Step 7: Commit the test and the fix together**

```bash
git add templates/import/wizard.hbs styles/campaign-record.css tests/e2e/21-import-export.spec.mjs
git commit -m "fix: scroll import review list so action buttons stay reachable

Cap the import wizard at 90vh and make the review step a flex column:
the target-group header and footer are pinned while the section list
scrolls, so Create is always reachable no matter how many sections a
document produces. Add an e2e regression assertion for the layout.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **Out of scope:** the split modal (`#promptSplit`, a `DialogV2` in `import-wizard.mjs:204`) can overflow the same way for a section with very many blocks. Do not fix it here — it is a separate follow-up.
- The source step of the wizard is short and intentionally untouched; it still auto-sizes.
- If the `foundry-e2e` environment is unavailable, Task 1 Step 2 and Task 2 Steps 4–6 cannot run. In that case, do the Step 6 visual confirmation manually against a local Foundry world, still land the test code (it will run in CI), and note in the PR that e2e was verified manually.
