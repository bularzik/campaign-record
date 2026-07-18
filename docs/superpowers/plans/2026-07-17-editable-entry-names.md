# Editable Entry Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a viewed record is editable in the hub record pane, its name renders as an always-open inline input in the pane header that autosaves on commit.

**Architecture:** The hub app (`hub-mixin.mjs` + `templates/hub/record.hbs`) owns the pane title, so it owns the feature: a new pure decision function `isNameEditable` in `scripts/logic/inline-edit.mjs` drives a template branch (input vs `<h2>`), and delegated `change`/`keydown` handlers in `_onRender` commit via `viewedPage.update({ name })`. The render-defer guard is widened to cover the header input so re-renders never clobber typing.

**Tech Stack:** Foundry VTT v13 AppV2 (HandlebarsApplicationMixin), Vitest (unit), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-07-17-editable-entry-names-design.md`

## Global Constraints

- Working directory: the worktree at `.claude/worktrees/editable-entry-names` (branch `feature/editable-entry-names`). All paths below are relative to it.
- The input keeps the class `record-pane-title` (existing e2e locators and CSS scoping depend on that class; the tag distinguishes input vs h2).
- Commit rule: trimmed value; empty or unchanged → no save, revert input to current name. Enter blurs (which fires `change`); Escape resets value and blurs without saving.
- Editability rule: `canEdit && (inlineEditable || editing)` — exactly when the rest of the entry is editable.
- Reuse the existing i18n key `CAMPAIGNRECORD.Hub.RecordName` ("Name") for the input's aria-label. No new i18n keys.
- Unit tests: `npm test` (vitest). E2E: `npx playwright test <file>` — **before ANY e2e run, server restart, or symlink change, read and follow the `campaign-record:foundry-e2e` skill** (session locking against the shared Foundry install). Known env issue: the bbmm module's changelog modal must stay disabled in World B or ~16 specs fail suite-wide.
- Do not push to main. Commits on `feature/editable-entry-names` only.

---

### Task 1: `isNameEditable` decision function

**Files:**
- Modify: `scripts/logic/inline-edit.mjs` (append after `isInlineEditableView`, line 38)
- Test: `tests/inline-edit.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `isNameEditable({ canEdit, editing, inlineEditable }) => boolean`, exported from `scripts/logic/inline-edit.mjs`. Task 3 imports it in `hub-mixin.mjs`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/inline-edit.test.js` (add `isNameEditable` to the existing imports from `../scripts/logic/inline-edit.mjs`):

```js
describe("isNameEditable", () => {
  it("is editable in an inline-editable view (typed record, inline on)", () => {
    expect(isNameEditable({ canEdit: true, editing: false, inlineEditable: true })).toBe(true);
  });
  it("is editable in manual edit mode (text page / inline off)", () => {
    expect(isNameEditable({ canEdit: true, editing: true, inlineEditable: false })).toBe(true);
  });
  it("is read-only in plain view mode when the view is not inline-editable", () => {
    expect(isNameEditable({ canEdit: true, editing: false, inlineEditable: false })).toBe(false);
  });
  it("is never editable without update permission", () => {
    for (const editing of [true, false]) {
      for (const inlineEditable of [true, false]) {
        expect(isNameEditable({ canEdit: false, editing, inlineEditable })).toBe(false);
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/inline-edit.test.js`
Expected: FAIL — `isNameEditable` is not exported (SyntaxError or `undefined is not a function`).

- [ ] **Step 3: Implement**

Append to `scripts/logic/inline-edit.mjs` after `isInlineEditableView`:

```js
/**
 * Should the pane header render the record name as an always-open input?
 * True exactly when the rest of the entry is editable: the user can update the
 * page AND either the view is inline-editable or manual edit mode is active.
 */
export function isNameEditable({ canEdit, editing, inlineEditable }) {
  return Boolean(canEdit && (inlineEditable || editing));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/inline-edit.test.js`
Expected: PASS (all existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/inline-edit.mjs tests/inline-edit.test.js
git commit -m "feat: add isNameEditable decision for pane-title editing"
```

---

### Task 2: e2e pane-title helper + assertion migration

The title element becomes an `<input>` for editable viewers in Task 3, and Playwright's `toHaveText` fails on inputs. Migrate existing assertions to a tag-agnostic helper FIRST so the suite stays green before and after the feature lands.

**Files:**
- Modify: `tests/e2e/helpers/foundry.mjs` (append export)
- Modify: `tests/e2e/08-hub-timeline.spec.mjs:273`
- Modify: `tests/e2e/21-hub-record-pane.spec.mjs:20,75,99,155-…,250,273,296` (every `toHaveText` on `.record-pane-title`)
- Modify: `tests/e2e/22-group-hub-sheet.spec.mjs:38,60,86`
- Modify: `tests/e2e/27-auto-link-entry-names.spec.mjs:111,118`

**Interfaces:**
- Consumes: nothing new.
- Produces: `expectPaneTitle(scope, name)` exported from `tests/e2e/helpers/foundry.mjs`, where `scope` is a Playwright Locator that contains one `.record-pane-title`. Tasks 3–4 use it in new tests.

- [ ] **Step 1: Add the helper**

In `tests/e2e/helpers/foundry.mjs`, add to the imports at the top:

```js
import { expect } from "@playwright/test";
```

Append:

```js
/**
 * Assert the record pane title within `scope` shows `name`, whether it is
 * rendered as a static <h2> or (for editable viewers) an <input>.
 */
export async function expectPaneTitle(scope, name) {
  const title = scope.locator(".record-pane-title");
  await expect(title).toHaveCount(1);
  const tag = await title.evaluate((el) => el.tagName);
  if (tag === "INPUT") await expect(title).toHaveValue(name);
  else await expect(title).toHaveText(name);
}
```

- [ ] **Step 2: Migrate every `toHaveText` assertion on `.record-pane-title`**

Grep to enumerate (must end with zero hits after migration):

```bash
grep -rn 'record-pane-title.*toHaveText\|toHaveText' tests/e2e/*.spec.mjs | grep record-pane-title
```

Rewrite each, e.g. in `tests/e2e/21-hub-record-pane.spec.mjs`:

```js
// before
await expect(hub.locator(".record-pane-title")).toHaveText("E2E Pane Npc");
// after
await expectPaneTitle(hub, "E2E Pane Npc");
```

Where a spec caches `const title = hub.locator(".record-pane-title")` (21's back/forward test around line 155), replace each `await expect(title).toHaveText(X)` with `await expectPaneTitle(hub, X)` and drop the now-unused `title` const if nothing else uses it. Add `expectPaneTitle` to each spec's import from `./helpers/foundry.mjs`. Leave `toHaveCount(0)` assertions (e.g. 21:325) unchanged.

- [ ] **Step 3: Run the touched e2e specs to verify green**

Read and follow the `campaign-record:foundry-e2e` skill first (locking, server state). Then:

```bash
npx playwright test tests/e2e/21-hub-record-pane.spec.mjs tests/e2e/22-group-hub-sheet.spec.mjs tests/e2e/27-auto-link-entry-names.spec.mjs tests/e2e/08-hub-timeline.spec.mjs
```

Expected: PASS (behavior unchanged — titles are still `<h2>` at this point).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/helpers/foundry.mjs tests/e2e/08-hub-timeline.spec.mjs tests/e2e/21-hub-record-pane.spec.mjs tests/e2e/22-group-hub-sheet.spec.mjs tests/e2e/27-auto-link-entry-names.spec.mjs
git commit -m "test: tag-agnostic pane-title assertion helper"
```

---

### Task 3: Render the title input for editable viewers

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs:7` (import) and `:867-876` (context.view)
- Modify: `templates/hub/record.hbs:5`
- Modify: `styles/campaign-record.css` (after the `.record-pane-header h2.record-pane-title` block ending line ~700)
- Test: `tests/e2e/21-hub-record-pane.spec.mjs`

**Interfaces:**
- Consumes: `isNameEditable` from Task 1; `expectPaneTitle` from Task 2.
- Produces: `context.view.nameEditable` (boolean) consumed by `record.hbs`; the DOM contract `input.record-pane-title[name="name"]` that Task 4 binds handlers to.

- [ ] **Step 1: Write the failing e2e tests**

Append inside `test.describe("hub record pane", ...)` in `tests/e2e/21-hub-record-pane.spec.mjs`:

```js
test("editable record renders the title as an input", async ({ page }) => {
  await login(page, "Gamemaster");
  await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Rename", "campaign-record.npc");
  await page.evaluate(async () => {
    await game.settings.set("campaign-record", "inlineEditing", true);
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    CampaignHub.open();
  });
  const hub = page.locator("#campaign-hub");
  await hub.waitFor();
  await hub.locator(".record-row", { hasText: "E2E Pane Rename" }).click();

  const input = hub.locator("input.record-pane-title");
  await expect(input).toHaveValue("E2E Pane Rename");
  await expect(hub.locator("h2.record-pane-title")).toHaveCount(0);
});

test("observer without update permission still gets the static title", async ({ browser, page }) => {
  await login(page, "Gamemaster");
  const ids = await page.evaluate(async () => {
    const entry = await JournalEntry.create({
      name: "E2E Pane Observer Group",
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
      flags: {
        "campaign-record": { group: { timepoints: [] } },
        core: { sheetClass: "campaign-record.GroupHubSheet" }
      }
    });
    const [recordPage] = await entry.createEmbeddedDocuments("JournalEntryPage", [
      { name: "E2E Pane Observed", type: "campaign-record.npc" }
    ]);
    return { groupId: entry.id, pageId: recordPage.id };
  });
  const ctx = await browser.newContext();
  const playerPage = await ctx.newPage();
  await login(playerPage, "User 1");
  await playerPage.evaluate(async ({ groupId, pageId }) => {
    await game.settings.set("campaign-record", "inlineEditing", true);
    const sheet = game.journal.get(groupId).sheet;
    await sheet.render({ force: true });
    await sheet.goToPage(pageId);
  }, ids);
  const sheet = playerPage.locator(".group-hub");
  await expect(sheet.locator("h2.record-pane-title")).toHaveText("E2E Pane Observed");
  await expect(sheet.locator("input.record-pane-title")).toHaveCount(0);
  await ctx.close();
});
```

The `afterEach` cleanup already deletes groups prefixed `E2E Pane` (covers both new groups).

- [ ] **Step 2: Run them to verify they fail**

Follow the `campaign-record:foundry-e2e` skill, then:

```bash
npx playwright test tests/e2e/21-hub-record-pane.spec.mjs -g "editable record renders|observer without update"
```

Expected: FAIL — `input.record-pane-title` count is 0 in the first test (title is still an h2).

- [ ] **Step 3: Implement context + template + CSS**

`scripts/apps/hub/hub-mixin.mjs` line 7 — add the import:

```js
import { hasActiveEditorFocus, shouldShowEditToggle, isInlineEditableView, isNameEditable } from "../../logic/inline-edit.mjs";
```

Same file, the `context.view` block (currently lines 867-876) — add `nameEditable`:

```js
        context.view = {
          name: viewedPage.name,
          editing: this.state.view.mode === "edit",
          canEdit,
          nameEditable: isNameEditable({
            canEdit,
            editing: this.state.view.mode === "edit",
            inlineEditable: inlineEditableView
          }),
          showEditToggle: shouldShowEditToggle({
            canEdit,
            inViewMode: this.state.view.mode !== "edit",
            inlineEditableView
          })
        };
```

`templates/hub/record.hbs` line 5 — replace the single `<h2>` line with:

```hbs
    {{#if view.nameEditable}}
    <input type="text" class="record-pane-title" name="name" value="{{view.name}}"
           aria-label="{{localize "CAMPAIGNRECORD.Hub.RecordName"}}" />
    {{else}}
    <h2 class="record-pane-title">{{view.name}}</h2>
    {{/if}}
```

`styles/campaign-record.css` — directly after the `.record-pane-header h2.record-pane-title` rule (ends ~line 700):

```css
.record-pane-header input.record-pane-title {
  flex: 1;
  margin: 0;
  height: auto;
  padding: 0 0.125rem;
  font-family: inherit;
  font-size: var(--font-size-18, 1.125rem);
  font-weight: bold;
  color: inherit;
  background: transparent;
  border: none;
  border-radius: 3px;
}
.record-pane-header input.record-pane-title:hover,
.record-pane-header input.record-pane-title:focus {
  box-shadow: inset 0 0 0 1px var(--color-border, #7a7971);
  outline: none;
}
```

- [ ] **Step 4: Run the new tests to verify they pass, plus the migrated specs**

```bash
npx playwright test tests/e2e/21-hub-record-pane.spec.mjs tests/e2e/22-group-hub-sheet.spec.mjs
```

Expected: PASS — including all pre-existing pane-title assertions, now exercising the input path for GM viewers via `expectPaneTitle`.

- [ ] **Step 5: Commit**

```bash
git add scripts/apps/hub/hub-mixin.mjs templates/hub/record.hbs styles/campaign-record.css tests/e2e/21-hub-record-pane.spec.mjs
git commit -m "feat: render pane title as inline input for editable records"
```

---

### Task 4: Commit / cancel behavior and render guard

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs` — `render()` (lines 208-218) and `_onRender` (lines 883+)
- Test: `tests/e2e/21-hub-record-pane.spec.mjs`

**Interfaces:**
- Consumes: `input.record-pane-title` DOM contract from Task 3; `#resolveViewedPage()` (`hub-mixin.mjs:97-106`); `expectPaneTitle` helper from Task 2.
- Produces: user-facing rename behavior; no new exports.

- [ ] **Step 1: Write the failing e2e tests**

Append inside the describe block in `tests/e2e/21-hub-record-pane.spec.mjs`:

```js
async function openRenameFixture(page) {
  await login(page, "Gamemaster");
  await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Rename", "campaign-record.npc");
  await page.evaluate(async () => {
    await game.settings.set("campaign-record", "inlineEditing", true);
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    CampaignHub.open();
  });
  const hub = page.locator("#campaign-hub");
  await hub.waitFor();
  await hub.locator(".record-row", { hasText: "E2E Pane Rename" }).click();
  const input = hub.locator("input.record-pane-title");
  await expect(input).toHaveValue("E2E Pane Rename");
  return { hub, input };
}

test("typing a new name and pressing Enter renames the record", async ({ page }) => {
  const { hub, input } = await openRenameFixture(page);
  await input.fill("E2E Pane Renamed");
  await input.press("Enter");

  // The document saved and the index row picked up the new name.
  await expect(hub.locator(".hub-index .record-row", { hasText: "E2E Pane Renamed" })).toHaveCount(1);
  await expect(input).toHaveValue("E2E Pane Renamed");
  expect(await page.evaluate(() =>
    game.journal.getName("E2E Pane Group").pages.getName("E2E Pane Renamed")?.name
  )).toBe("E2E Pane Renamed");
});

test("Escape reverts the title without saving", async ({ page }) => {
  const { hub, input } = await openRenameFixture(page);
  await input.fill("E2E Pane Discarded");
  await input.press("Escape");

  await expect(input).toHaveValue("E2E Pane Rename");
  // The hub window itself must survive the Escape (not close).
  await expect(hub).toBeVisible();
  expect(await page.evaluate(() =>
    game.journal.getName("E2E Pane Group").pages.getName("E2E Pane Rename")?.name
  )).toBe("E2E Pane Rename");
});

test("committing an empty name reverts instead of saving", async ({ page }) => {
  const { input } = await openRenameFixture(page);
  await input.fill("   ");
  await input.press("Enter");

  await expect(input).toHaveValue("E2E Pane Rename");
  expect(await page.evaluate(() =>
    game.journal.getName("E2E Pane Group").pages.getName("E2E Pane Rename")?.name
  )).toBe("E2E Pane Rename");
});
```

- [ ] **Step 2: Run them to verify they fail**

Follow the `campaign-record:foundry-e2e` skill, then:

```bash
npx playwright test tests/e2e/21-hub-record-pane.spec.mjs -g "renames the record|Escape reverts|empty name reverts"
```

Expected: FAIL — no handlers yet: Enter does nothing (document name unchanged), Escape does not revert.

- [ ] **Step 3: Implement handlers and widen the render guard**

`scripts/apps/hub/hub-mixin.mjs` — in `render()` (lines 208-218), widen the defer condition so typing in the header title also defers re-renders (the existing element-level `focusout` flush at lines 885-892 already covers the header):

```js
    async render(options = {}, _options = {}) {
      if (typeof options === "boolean") options = { force: options, ..._options };
      const root = this.rendered ? this.element : null;
      const mount = root?.querySelector(".record-pane-mount");
      const header = root?.querySelector(".record-pane-header");
      if ((mount && hasActiveEditorFocus(mount)) || (header && hasActiveEditorFocus(header))) {
        this.#deferredRender = foundry.utils.mergeObject(this.#deferredRender ?? {}, options, {
          inplace: false
        });
        return this;
      }
      return super.render(options, _options);
    }
```

Same file, in `_onRender` — add after the `groupSelect` binding block (~line 900), following the same per-element `dataset.crBound` pattern (the record part re-renders on navigation, so each new input gets bound):

```js
      const titleInput = this.element.querySelector("input.record-pane-title");
      if (titleInput && !titleInput.dataset.crBound) {
        titleInput.dataset.crBound = "1";
        titleInput.addEventListener("change", async (event) => {
          // Keep the rename out of the group journal's own form handling.
          event.stopPropagation();
          const page = this.#resolveViewedPage();
          if (!page) return;
          const name = event.target.value.trim();
          if (!name || name === page.name) {
            event.target.value = page.name;
            return;
          }
          await page.update({ name });
        });
        titleInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.target.blur(); // commits via the change handler
          } else if (event.key === "Escape") {
            // Revert, and keep core's Escape handling from closing the app.
            event.preventDefault();
            event.stopPropagation();
            const page = this.#resolveViewedPage();
            if (page) event.target.value = page.name;
            event.target.blur();
          }
        });
      }
```

Note on the flush path: after a rename, `updateJournalEntryPage` fires `#debouncedRender`, which (view open, still valid) re-renders `header`/`index`/`timeline` but not the `record` part (`renderPartsForChange`), so the input keeps DOM identity and already shows the typed value — no snap-back, and the index row refreshes.

- [ ] **Step 4: Run the new tests to verify they pass, then the whole spec file**

```bash
npx playwright test tests/e2e/21-hub-record-pane.spec.mjs
```

Expected: PASS (all tests in the file, old and new).

- [ ] **Step 5: Commit**

```bash
git add scripts/apps/hub/hub-mixin.mjs tests/e2e/21-hub-record-pane.spec.mjs
git commit -m "feat: commit and cancel handling for inline pane-title rename"
```

---

### Task 5: Full verification and ship

**Files:**
- No new files; runs suites and opens the PR.

**Interfaces:**
- Consumes: everything above.
- Produces: pushed branch + draft PR.

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: PASS (all files, including untouched suites).

- [ ] **Step 2: Run the affected e2e specs together**

Follow the `campaign-record:foundry-e2e` skill, then:

```bash
npx playwright test tests/e2e/08-hub-timeline.spec.mjs tests/e2e/18-inline-edit.spec.mjs tests/e2e/21-hub-record-pane.spec.mjs tests/e2e/22-group-hub-sheet.spec.mjs tests/e2e/27-auto-link-entry-names.spec.mjs tests/e2e/29-journal-edit-guard.spec.mjs
```

Expected: PASS. (18 and 29 are included because they exercise inline-edit and permission guards adjacent to the changed render path.)

- [ ] **Step 3: Push and open a draft PR**

```bash
git push -u origin feature/editable-entry-names
gh pr create --draft --title "feat: editable entry names in the record pane" --body "$(cat <<'EOF'
When a viewed record is editable (inline-editable view or manual edit mode), the pane header title renders as an always-open input; commit on Enter/blur, Escape cancels, empty/unchanged input reverts. Spec: docs/superpowers/specs/2026-07-17-editable-entry-names-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
