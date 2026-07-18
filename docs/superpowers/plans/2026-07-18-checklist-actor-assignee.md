# Checklist Actor Assignee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Checklist items become assignable to character-type actors (player characters) instead of Foundry users, with a world migration and a clickable assignee that opens the actor sheet.

**Architecture:** The existing `assignee` StringField keeps its shape but now stores an Actor ID. Pure migration mapping lives in `scripts/logic/migrations.mjs` (unit-testable, no Foundry globals); the world migration (schema v5) in `scripts/data/migration-runner.mjs` rewrites stored user IDs to that user's character ID. The sheet swaps its user dropdown for a character-actor dropdown and gains an `openAssignee` action.

**Tech Stack:** Foundry VTT v13 module (AppV2 Handlebars sheets), vitest unit tests, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-07-18-checklist-actor-assignee-design.md`

## Global Constraints

- Assignable set: ALL world actors with `type === "character"`, sorted by name. No player-ownership filter, no user fallback.
- `assignee` stays a plain `StringField` (Actor ID or `""`). No UUIDs, no schema shape change (`scripts/data/checklist.mjs` untouched).
- Migration: stored user IDs map to `user.character?.id ?? ""`; values that are not known user IDs are untouched (idempotent).
- View mode: assignee name is clickable (opens actor sheet) only when the viewer has at least LIMITED permission on the actor; plain text otherwise.
- Unknown/deleted actor IDs render as unassigned; `openAssignee` on a missing actor is a silent no-op.
- No new i18n keys needed; do not break `tests/i18n-coverage.test.js`.
- Working directory is the worktree: `/Users/danbularzik/Claude/Projects/campaign-record/campaign-record/.claude/worktrees/checklist-actor-assignee` (branch `feature/checklist-actor-assignee`). Run all commands from there.
- E2E runs must follow the project skill `foundry-e2e` (session locking, symlink ownership). Read it before any e2e run.

---

### Task 1: Pure migration mapping (`migratedAssignee`, `checklistAssigneeUpdates`)

**Files:**
- Modify: `scripts/logic/migrations.mjs`
- Test: `tests/migrations.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `migratedAssignee(assignee: string, userCharacters: Map<string, string|null>): string` — the value to store under schema 5. If `assignee` is empty or not a key of `userCharacters`, returns `assignee` unchanged; otherwise returns the mapped character ID, or `""` when the user has no character.
  - `checklistAssigneeUpdates(pages: Array<{id: string, items: Array<{id,text,done,assignee}>}>, userCharacters: Map<string, string|null>): Array<{_id: string, "system.items": Array}>` — one update object per page whose items actually change; pages with nothing to rewrite are omitted.

- [ ] **Step 1: Write the failing tests**

Append to `tests/migrations.test.js`:

```js
import { migratedAssignee, checklistAssigneeUpdates } from "../scripts/logic/migrations.mjs";

describe("assignee migration mapping", () => {
  const users = new Map([
    ["userA", "actor1"], // user with an assigned character
    ["userB", null] // user without a character
  ]);

  it("maps a user ID to that user's character ID", () => {
    expect(migratedAssignee("userA", users)).toBe("actor1");
  });

  it("clears a user ID when the user has no character", () => {
    expect(migratedAssignee("userB", users)).toBe("");
  });

  it("leaves empty and non-user values untouched", () => {
    expect(migratedAssignee("", users)).toBe("");
    expect(migratedAssignee("actor9", users)).toBe("actor9"); // already migrated
  });

  it("builds page updates only for pages that change", () => {
    const pages = [
      {
        id: "p1",
        items: [
          { id: "i1", text: "a", done: false, assignee: "userA" },
          { id: "i2", text: "b", done: true, assignee: "" }
        ]
      },
      { id: "p2", items: [{ id: "i3", text: "c", done: false, assignee: "actor9" }] }
    ];
    const updates = checklistAssigneeUpdates(pages, users);
    expect(updates).toEqual([
      {
        _id: "p1",
        "system.items": [
          { id: "i1", text: "a", done: false, assignee: "actor1" },
          { id: "i2", text: "b", done: true, assignee: "" }
        ]
      }
    ]);
  });

  it("is idempotent: re-running the updates produces no further updates", () => {
    const pages = [
      { id: "p1", items: [{ id: "i1", text: "a", done: false, assignee: "userA" }] }
    ];
    const first = checklistAssigneeUpdates(pages, users);
    const migrated = [{ id: "p1", items: first[0]["system.items"] }];
    expect(checklistAssigneeUpdates(migrated, users)).toEqual([]);
  });
});
```

Note: `tests/migrations.test.js` already imports from `../scripts/logic/migrations.mjs` — merge the new import into the existing import line:

```js
import { pendingMigrations, isDowngrade, migratedAssignee, checklistAssigneeUpdates } from "../scripts/logic/migrations.mjs";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/migrations.test.js`
Expected: FAIL — `migratedAssignee` is not exported.

- [ ] **Step 3: Implement the helpers**

Append to `scripts/logic/migrations.mjs`:

```js
/**
 * Schema 5 assignee value: user IDs become that user's character ID (or ""
 * when the user has no character). Anything else — empty, already an actor
 * ID, unknown — passes through, so re-running is a no-op.
 */
export function migratedAssignee(assignee, userCharacters) {
  if (!assignee || !userCharacters.has(assignee)) return assignee;
  return userCharacters.get(assignee) ?? "";
}

/** Embedded-page updates rewriting user-ID assignees; empty when nothing changes. */
export function checklistAssigneeUpdates(pages, userCharacters) {
  const updates = [];
  for (const page of pages) {
    const items = page.items.map((item) => ({
      ...item,
      assignee: migratedAssignee(item.assignee, userCharacters)
    }));
    const changed = items.some((item, i) => item.assignee !== page.items[i].assignee);
    if (changed) updates.push({ _id: page.id, "system.items": items });
  }
  return updates;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/migrations.test.js`
Expected: PASS (all existing + 5 new tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/migrations.mjs tests/migrations.test.js
git commit -m "feat: pure assignee migration mapping for checklist schema v5"
```

---

### Task 2: World migration v5 and schema bump

**Files:**
- Modify: `scripts/constants.mjs:45` (`SCHEMA_VERSION`)
- Modify: `scripts/data/migration-runner.mjs`

**Interfaces:**
- Consumes: `migratedAssignee` is not used directly; `checklistAssigneeUpdates(pages, userCharacters)` from Task 1.
- Produces: migration registry entry `{version: 5, run}`; `SCHEMA_VERSION === 5`. Nothing later depends on these symbols.

- [ ] **Step 1: Bump the schema version**

In `scripts/constants.mjs`, change:

```js
export const SCHEMA_VERSION = 4;
```

to:

```js
export const SCHEMA_VERSION = 5;
```

- [ ] **Step 2: Add the migration entry**

In `scripts/data/migration-runner.mjs`:

Extend the imports (line 1 already imports from `../constants.mjs`; line 2 from `../logic/migrations.mjs`):

```js
import { MODULE_ID, GROUP_FLAG, SCHEMA_VERSION, SCHEMA_SETTING, GROUP_SHEET_CLASS, typeId } from "../constants.mjs";
import { pendingMigrations, isDowngrade, checklistAssigneeUpdates } from "../logic/migrations.mjs";
```

Append to the `MIGRATIONS` array (after the `version: 4` entry, matching the existing `,{` style):

```js
  ,{
    version: 5,
    // Checklist assignees moved from user IDs to character actor IDs. Map
    // each stored user ID to that user's assigned character; users without
    // a character are cleared. Values that are not known user IDs (empty,
    // already actor IDs) pass through, so re-running is a no-op.
    async run() {
      const userCharacters = new Map(
        game.users.map((u) => [u.id, u.character?.id ?? null])
      );
      for (const group of getGroups()) {
        const pages = group.pages
          .filter((p) => p.type === typeId("checklist"))
          .map((p) => ({ id: p.id, items: p.system.toObject().items }));
        const updates = checklistAssigneeUpdates(pages, userCharacters);
        if (updates.length) await group.updateEmbeddedDocuments("JournalEntryPage", updates);
      }
    }
  }
```

- [ ] **Step 3: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS — no unit test reads `SCHEMA_VERSION`'s value, and the runner itself has no unit tests (needs Foundry globals; e2e covers module boot).

- [ ] **Step 4: Commit**

```bash
git add scripts/constants.mjs scripts/data/migration-runner.mjs
git commit -m "feat: schema v5 migration rewriting checklist assignees to actor IDs"
```

---

### Task 3: Sheet and templates — actor dropdown, clickable assignee

**Files:**
- Modify: `scripts/sheets/checklist-sheet.mjs`
- Modify: `templates/partials/checklist-items.hbs:10`
- Modify: `templates/checklist/view.hbs`

**Interfaces:**
- Consumes: nothing from earlier tasks (runtime data only).
- Produces: template context keys `actorOptions` (object `{actorId: name}`), per-item `assigneeName` (string) and `assigneeVisible` (boolean); sheet action `openAssignee`. The e2e task selects actor IDs from the same `[data-row-field="assignee"]` select and clicks `[data-action="openAssignee"]`.

- [ ] **Step 1: Update `_prepareContext` and add the action**

Replace the full contents of `scripts/sheets/checklist-sheet.mjs` with:

```js
import { BaseRecordSheet } from "./base-record-sheet.mjs";

export class ChecklistSheet extends BaseRecordSheet {
  static DEFAULT_OPTIONS = {
    actions: {
      addItem: ChecklistSheet.#onAddItem,
      deleteItem: ChecklistSheet.#onDeleteItem,
      toggleItem: ChecklistSheet.#onToggleItem,
      openAssignee: ChecklistSheet.#onOpenAssignee
    }
  };

  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/checklist/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/checklist/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const characters = game.actors
      .filter((a) => a.type === "character")
      .sort((a, b) => a.name.localeCompare(b.name));
    context.actorOptions = Object.fromEntries(characters.map((a) => [a.id, a.name]));
    context.items = this.document.system.items.map((item) => {
      const actor = item.assignee ? game.actors.get(item.assignee) : null;
      return {
        ...item,
        assigneeName: actor?.name ?? "",
        assigneeVisible: actor?.testUserPermission(game.user, "LIMITED") ?? false
      };
    });
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.bindRowInputs("items");
  }

  static async #onAddItem() {
    await this.updateRows("items", (rows) =>
      rows.push({ id: foundry.utils.randomID(), text: "", done: false, assignee: "" })
    );
  }

  static async #onDeleteItem(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("items", (rows) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    });
  }

  static async #onToggleItem(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("items", (rows) => {
      const r = rows.find((x) => x.id === id);
      if (r) r.done = !r.done;
    });
  }

  /** Open the assigned character's sheet. Missing actor: silent no-op. */
  static async #onOpenAssignee(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    const item = this.document.system.items.find((i) => i.id === id);
    const actor = item?.assignee ? game.actors.get(item.assignee) : null;
    actor?.sheet.render(true);
  }
}
```

- [ ] **Step 2: Point the edit dropdown at actors**

In `templates/partials/checklist-items.hbs`, change line 10:

```hbs
        {{selectOptions @root.userOptions selected=this.assignee}}
```

to:

```hbs
        {{selectOptions @root.actorOptions selected=this.assignee}}
```

- [ ] **Step 3: Make the view-mode assignee clickable**

In `templates/checklist/view.hbs`, change:

```hbs
      {{#if this.assigneeName}}<span class="assignee">{{this.assigneeName}}</span>{{/if}}
```

to:

```hbs
      {{#if this.assigneeName}}{{#if this.assigneeVisible}}<a class="assignee" data-action="openAssignee">{{this.assigneeName}}</a>{{else}}<span class="assignee">{{this.assigneeName}}</span>{{/if}}{{/if}}
```

- [ ] **Step 4: Run the unit suite (template/i18n guards)**

Run: `npx vitest run`
Expected: PASS — `tests/i18n-coverage.test.js` scans templates for `localize` keys; this change adds none.

- [ ] **Step 5: Commit**

```bash
git add scripts/sheets/checklist-sheet.mjs templates/partials/checklist-items.hbs templates/checklist/view.hbs
git commit -m "feat: assign checklist items to character actors with clickable assignee"
```

---

### Task 4: E2E coverage

**Files:**
- Modify: `tests/e2e/11-checklist.spec.mjs`

**Interfaces:**
- Consumes: `actorOptions`-backed `[data-row-field="assignee"]` select and `[data-action="openAssignee"]` link from Task 3; helpers `login`, `deleteGroupsByPrefix`, `createGroupWithPage`, `deleteActorsByPrefix` from `tests/e2e/helpers/foundry.mjs`.
- Produces: nothing downstream.

**Before running anything:** read and follow the project skill `foundry-e2e` (session lock, symlink ownership, World B). Note from memory: bbmm must be disabled in World B or ~16 specs fail on a changelog modal.

- [ ] **Step 1: Rewrite the spec to assign a character actor**

Replace the full contents of `tests/e2e/11-checklist.spec.mjs` with:

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage, deleteActorsByPrefix } from "./helpers/foundry.mjs";

test.describe("checklist", () => {
  let gmPage, ids, actorId;

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    ids = await createGroupWithPage(gmPage, "E2E Checklist Group", "E2E Checklist", "campaign-record.checklist");
    // LIMITED default ownership: players see the assignee as a clickable link.
    actorId = await gmPage.evaluate(async () => {
      const actor = await Actor.create({
        name: "E2E Checklist PC",
        type: "character",
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED }
      });
      return actor.id;
    });
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(gmPage, "E2E Checklist");
    await deleteActorsByPrefix(gmPage, "E2E Checklist PC");
    await gmPage.close();
  });

  const items = () =>
    gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.toObject().items,
      { groupId: ids.groupId, pageId: ids.pageId }
    );

  test("GM adds items, edits text, assigns a character, toggles done", async () => {
    await gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = gmPage.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[data-action="addItem"]').waitFor({ timeout: 15_000 });
    await sheet.locator('[data-action="addItem"]').click();
    await expect.poll(async () => (await items()).length).toBe(1);

    const text = sheet.locator('[data-rows="items"] [data-row-field="text"]').first();
    await text.fill("Buy rations");
    await text.dispatchEvent("change");
    await expect.poll(async () => (await items())[0].text).toBe("Buy rations");

    const assignee = sheet.locator('[data-rows="items"] [data-row-field="assignee"]').first();
    await assignee.selectOption(actorId);
    await assignee.dispatchEvent("change");
    await expect.poll(async () => (await items())[0].assignee).toBe(actorId);

    await sheet.locator('[data-action="toggleItem"]').first().click();
    await expect.poll(async () => (await items())[0].done).toBe(true);
    await gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.close(),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
  });

  test("player sees the assignee, opens the actor sheet, toggles an item", async ({ browser }) => {
    const ctx = await browser.newContext();
    const playerPage = await ctx.newPage();
    await login(playerPage, "User 1");
    // Inline editing (client-scoped, default on) renders items as inputs;
    // that branch is covered by 18-inline-edit. This test asserts the
    // read-only view, so switch the toggle off for this client.
    await playerPage.evaluate(() =>
      game.settings.set("campaign-record", "inlineEditing", false)
    );
    await playerPage.evaluate(
      async ({ groupId, pageId }) => {
        const g = game.journal.get(groupId);
        await g.sheet.render(true);
        await g.sheet.goToPage(pageId);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const view = playerPage.locator(".journal-entry-page .checklist-items");
    await view.waitFor({ timeout: 15_000 });
    await expect(view).toContainText("Buy rations");
    await expect(view.locator('[data-action="openAssignee"]').first()).toHaveText("E2E Checklist PC");
    await view.locator('[data-action="openAssignee"]').first().click();
    await expect
      .poll(async () =>
        playerPage.evaluate((id) => game.actors.get(id)?.sheet?.rendered ?? false, actorId)
      )
      .toBe(true);
    await view.locator('[data-action="toggleItem"]').first().click();
    await expect.poll(async () => (await items())[0].done).toBe(false); // GM toggled it true earlier
    await ctx.close();
  });
});
```

- [ ] **Step 2: Run the checklist spec**

Follow `foundry-e2e` to acquire the session/server, then:

Run: `npx playwright test tests/e2e/11-checklist.spec.mjs`
Expected: PASS (2 tests). If the actor-sheet poll flakes because the dnd5e sheet renders slowly, the poll (default interval) absorbs it — do not add fixed sleeps.

- [ ] **Step 3: Run neighboring specs that share the checklist fixtures**

Run: `npx playwright test tests/e2e/15-hub-types.spec.mjs tests/e2e/18-inline-edit.spec.mjs`
Expected: PASS — 15 uses empty assignees; 18 covers the inline-edit branch of the same partial (the select now lists actors, but that spec does not select an assignee).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/11-checklist.spec.mjs
git commit -m "test: e2e checklist assignment targets character actors"
```

---

### Task 5: Full-suite verification

**Files:** none new.

**Interfaces:** none.

- [ ] **Step 1: Full unit suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 2: Full e2e suite (per foundry-e2e skill)**

Run: `npx playwright test`
Expected: PASS, modulo the pre-existing unrelated failures noted in recent sessions (3 known timeout issues as of 2026-07-18). Any *new* failure in checklist/migration-adjacent specs must be fixed before proceeding.

- [ ] **Step 3: Commit any stragglers, verify clean tree**

Run: `git status --short`
Expected: empty output.
