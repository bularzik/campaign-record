# Group Sheet-Class Flag + Single Name Editor Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate stale pre-v1.1.0 group `core.sheetClass` flags to `GroupHubSheet` (schema v6) and make the pane title-bar input the only name editor in pane edit mode.

**Architecture:** Two independent fixes. (1) A new schema-v6 migration entry in the existing `MIGRATIONS` registry rewrites the legacy sheet-class flag; the decision predicate is a pure function in `scripts/logic/migrations.mjs`. (2) `BaseRecordSheet` overrides core's `_configureRenderParts` to drop the inherited `header` part (core's name input + heading-level select) when the sheet is pane-embedded (`window.frame === false`, which `RecordPane` already sets).

**Tech Stack:** Foundry VTT v13 AppV2/Handlebars sheets, vitest (pure logic), Playwright e2e via the module harness.

**Spec:** `docs/superpowers/specs/2026-07-19-group-flag-name-editor-design.md`

## Global Constraints

- The legacy string `"campaign-record.CampaignGroupSheet"` may appear ONLY in the migration logic (`scripts/logic/migrations.mjs`) and in tests — nowhere else in `scripts/`.
- `SCHEMA_VERSION` becomes exactly `6`.
- Migration 6 must be idempotent: groups with the current class, a foreign class, or no flag are untouched.
- Framed (standalone) page sheets keep core's name field — only pane-embedded (`window.frame === false`) sheets drop the header part.
- All e2e-created world data uses the `E2E ` name prefix (foundry-e2e contract).
- Test tiers (2026-07-18 policy): run only the named affected specs + `npm run e2e:smoke`; never the full suite.
- E2E runs only via the harness (`npx playwright test <spec>`), waited on in the foreground.

---

### Task 1: Schema v6 — rewrite stale group sheet-class flags

**Files:**
- Modify: `scripts/logic/migrations.mjs` (append at end of file)
- Modify: `scripts/constants.mjs:45` (`SCHEMA_VERSION`)
- Modify: `scripts/data/migration-runner.mjs` (import line 2 + new entry after the `version: 5` entry)
- Test: `tests/migrations.test.js`, `tests/e2e/18-migrations.spec.mjs`

**Interfaces:**
- Consumes: existing `getGroups()` (already imported in `migration-runner.mjs`), `GROUP_SHEET_CLASS` (`"campaign-record.GroupHubSheet"`, already imported).
- Produces: `needsSheetClassRewrite(flag: string|undefined): boolean` and `LEGACY_GROUP_SHEET_CLASS` exported from `scripts/logic/migrations.mjs`.

- [ ] **Step 1: Write the failing unit tests**

Append to `tests/migrations.test.js` (add `needsSheetClassRewrite, LEGACY_GROUP_SHEET_CLASS` to the existing import from `../scripts/logic/migrations.mjs`):

```js
describe("group sheet-class rewrite (schema 6)", () => {
  it("rewrites exactly the legacy pre-v1.1.0 class", () => {
    expect(LEGACY_GROUP_SHEET_CLASS).toBe("campaign-record.CampaignGroupSheet");
    expect(needsSheetClassRewrite(LEGACY_GROUP_SHEET_CLASS)).toBe(true);
  });

  it("leaves current, foreign, and missing values untouched", () => {
    expect(needsSheetClassRewrite("campaign-record.GroupHubSheet")).toBe(false);
    expect(needsSheetClassRewrite("monks-enhanced-journal.MEJSheet")).toBe(false);
    expect(needsSheetClassRewrite(undefined)).toBe(false);
    expect(needsSheetClassRewrite("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/migrations.test.js`
Expected: FAIL — `needsSheetClassRewrite` is not exported.

- [ ] **Step 3: Implement the pure predicate**

Append to `scripts/logic/migrations.mjs`:

```js
/** Sheet class pinned to groups created before the v1.1.0 GroupHubSheet rename. */
export const LEGACY_GROUP_SHEET_CLASS = "campaign-record.CampaignGroupSheet";

/**
 * Schema 6: should this group's core sheetClass flag be rewritten to the
 * current GroupHubSheet class? Only the exact legacy value qualifies —
 * missing flags (migration 2 fills those) and user-chosen foreign sheets
 * pass through, so re-running is a no-op.
 */
export function needsSheetClassRewrite(flag) {
  return flag === LEGACY_GROUP_SHEET_CLASS;
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npx vitest run tests/migrations.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Bump the schema version**

In `scripts/constants.mjs`, change:

```js
export const SCHEMA_VERSION = 5;
```

to:

```js
export const SCHEMA_VERSION = 6;
```

- [ ] **Step 6: Add the migration entry**

In `scripts/data/migration-runner.mjs`:

Line 2, extend the existing import:

```js
import { pendingMigrations, isDowngrade, checklistAssigneeUpdates, needsSheetClassRewrite } from "../logic/migrations.mjs";
```

Inside the `MIGRATIONS` array, immediately after the closing `}` of the `version: 5` entry (before the final `];`), add:

```js
  ,{
    version: 6,
    // v1.1.0 renamed the pinned group sheet CampaignGroupSheet → GroupHubSheet,
    // but migration 2 skips groups whose flag is already set, so pre-v1.1.0
    // groups kept the stale class: they open in the system journal sheet and
    // fail every inGroup check (no inline editing). Rewrite exactly the
    // legacy value; current or user-chosen foreign sheets pass through.
    async run() {
      for (const group of getGroups()) {
        if (!needsSheetClassRewrite(group.flags?.core?.sheetClass)) continue;
        await group.update({ "flags.core.sheetClass": GROUP_SHEET_CLASS });
      }
    }
  }
```

- [ ] **Step 7: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS. (An i18n-coverage or constants test may reference `SCHEMA_VERSION`; if one fails on the bump, update its expected value to 6 — that is the only acceptable test edit.)

- [ ] **Step 8: Add the e2e migration test**

In `tests/e2e/18-migrations.spec.mjs`, insert this test immediately AFTER the `"legacy group flags are normalized on reload"` test and BEFORE the `"a newer stored schema puts the module in read-only"` test (that later test poisons `schemaVersion` to 999, so order matters):

```js
  test("stale pre-v1.1.0 sheetClass flag is rewritten to GroupHubSheet", async () => {
    await page.evaluate(async () => {
      await JournalEntry.create({
        name: "E2E Migration Stale Sheet",
        flags: {
          "campaign-record": { group: { timepoints: [] } },
          core: { sheetClass: "campaign-record.CampaignGroupSheet" }
        }
      });
      await game.settings.set("campaign-record", "schemaVersion", 5);
    });
    await page.reload();
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
    await expect
      .poll(() =>
        page.evaluate(() =>
          game.journal.getName("E2E Migration Stale Sheet")?.flags?.core?.sheetClass
        )
      )
      .toBe("campaign-record.GroupHubSheet");
    const current = await page.evaluate(async () => {
      const { SCHEMA_VERSION } = await import("/modules/campaign-record/scripts/constants.mjs");
      return SCHEMA_VERSION;
    });
    await expect
      .poll(() => page.evaluate(() => game.settings.get("campaign-record", "schemaVersion")))
      .toBe(current);
    // The migrated group now honors inline editing: a record in it opens with
    // always-open editors and no manual edit toggle.
    await page.evaluate(async () => {
      await game.settings.set("campaign-record", "inlineEditing", true);
      const entry = game.journal.getName("E2E Migration Stale Sheet");
      const [p] = await entry.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Migration Stale NPC", type: "campaign-record.npc" }
      ]);
      const sheet = entry.sheet;
      await sheet.render({ force: true });
      await sheet.goToPage(p.id);
    });
    await page
      .locator(".group-hub .record-pane-mount .campaign-record-content.inline-edit")
      .first()
      .waitFor({ timeout: 15_000 });
    await expect(
      page.locator('.group-hub .record-pane-header [data-action="toggleEditMode"]')
    ).toHaveCount(0);
  });
```

The existing `afterAll` (schema restore + `deleteGroupsByPrefix(page, "E2E Migration")`) already cleans this group up.

- [ ] **Step 9: Run the migration spec**

Run: `npx playwright test tests/e2e/18-migrations.spec.mjs`
Expected: PASS (all tests in the spec; report may include 2 extra auth-setup project tests).

- [ ] **Step 10: Commit**

```bash
git add scripts/logic/migrations.mjs scripts/constants.mjs scripts/data/migration-runner.mjs tests/migrations.test.js tests/e2e/18-migrations.spec.mjs
git commit -m "fix: schema v6 rewrites stale pre-v1.1.0 group sheet-class flags"
```

---

### Task 2: Pane edit mode — drop core's header part (single name editor)

**Files:**
- Modify: `scripts/sheets/base-record-sheet.mjs` (add method after `_prepareContext`)
- Modify: `docs/manual-test-checklist.md` (one line)
- Test: `tests/e2e/18-inline-edit.spec.mjs`

**Interfaces:**
- Consumes: core `JournalEntryPageHandlebarsSheet._configureRenderParts(options)` (returns a deep-cloned parts record; `EDIT_PARTS` carries `header` + `footer`), `RecordPane`'s existing sheet options (`window: { frame: false, positioned: false }`).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Write the failing e2e test**

Append inside the `test.describe` block of `tests/e2e/18-inline-edit.spec.mjs` (after the last existing test):

```js
  test("manual edit mode has exactly one name editor (the pane title input)", async () => {
    await gmPage.evaluate(() => game.settings.set("campaign-record", "inlineEditing", false));
    await gmPage.evaluate(
      async ({ groupId, pageId }) => {
        const sheet = game.journal.get(groupId).sheet;
        await sheet.render({ force: true });
        await sheet.goToPage(pageId);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const header = gmPage.locator(".group-hub .record-pane-header");
    await header.locator('[data-action="toggleEditMode"]').click();
    // The record's own edit form mounts…
    await expect(gmPage.locator(".group-hub .record-pane-mount .record-edit")).toHaveCount(1);
    // …with the pane title input as the single name editor: core's
    // page-header name field must not render inside the mount.
    await expect(header.locator("input.record-pane-title")).toHaveCount(1);
    await expect(gmPage.locator('.group-hub .record-pane-mount input[name="name"]')).toHaveCount(0);
    // Renaming through the title input still persists (saves on change).
    const title = header.locator("input.record-pane-title");
    await title.fill("E2E Inline Quest Renamed");
    await title.dispatchEvent("change");
    await expect
      .poll(() =>
        gmPage.evaluate(
          ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).name,
          { groupId: ids.groupId, pageId: ids.pageId }
        )
      )
      .toBe("E2E Inline Quest Renamed");
    // Restore the setting for any later specs sharing the storage state.
    await gmPage.evaluate(() => game.settings.set("campaign-record", "inlineEditing", true));
  });
```

- [ ] **Step 2: Run the spec to verify the new test fails**

Run: `npx playwright test tests/e2e/18-inline-edit.spec.mjs`
Expected: the new test FAILS on `toHaveCount(0)` — core's header currently renders a `input[name="name"]` inside the mount. All pre-existing tests in the spec must still pass.

- [ ] **Step 3: Implement the parts override**

In `scripts/sheets/base-record-sheet.mjs`, add this method to `BaseRecordSheet` directly after `_prepareContext`:

```js
  /**
   * Pane-embedded sheets (RecordPane mounts with `window.frame: false`) drop
   * core's `header` edit part — its name input duplicates the pane title-bar
   * input, which is the single name editor in the pane. Framed sheets (a
   * record page in an ordinary journal) keep core's field: no title bar there.
   * Core's heading-level select lives in the same part and goes with it.
   */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    if (this.options.window.frame === false) delete parts.header;
    return parts;
  }
```

Known limit (accepted in the spec): markdown-format text pages mount core's own sheet class in the pane, not `BaseRecordSheet`, so they keep core's name field.

- [ ] **Step 4: Run the spec to verify it passes**

Run: `npx playwright test tests/e2e/18-inline-edit.spec.mjs`
Expected: PASS (all tests; report may include 2 extra auth-setup project tests).

- [ ] **Step 5: Run the remaining affected specs + unit suite**

Run: `npx vitest run && npx playwright test tests/e2e/21-hub-record-pane.spec.mjs tests/e2e/29-journal-edit-guard.spec.mjs tests/e2e/31-record-header.spec.mjs`
Expected: PASS. These cover the pane mount, the edit-guard around the always-open editor, and the #32/#36 header behaviors the override sits next to.

- [ ] **Step 6: Add the manual checklist line**

In `docs/manual-test-checklist.md`, add under the most relevant existing section (hub/record pane):

```markdown
- [ ] A group created before v1.1.0 (legacy `CampaignGroupSheet` flag) opens as the hub after migration, and its records inline-edit with the setting on; in manual edit mode the pane shows exactly one name editor (the title-bar input).
```

- [ ] **Step 7: Commit**

```bash
git add scripts/sheets/base-record-sheet.mjs tests/e2e/18-inline-edit.spec.mjs docs/manual-test-checklist.md
git commit -m "fix: pane edit mode keeps a single name editor (drop core header part)"
```

---

### Final verification (branch level)

- [ ] `npx vitest run` — all unit tests pass.
- [ ] `npm run e2e:smoke` — smoke tier green.
- [ ] Affected specs already run per task (18-migrations, 18-inline-edit, 21, 29, 31); do NOT run the full e2e suite (publish-gate only).
