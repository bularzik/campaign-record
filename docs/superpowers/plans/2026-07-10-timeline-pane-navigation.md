# Timeline & Hub In-Pane Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `JournalEntryPage` activated from inside a campaign hub (timeline record chips, timeline link chips, content links in record text, index/search entries, new-record landing) opens in **that hub's record pane**, regardless of which group or journal the page belongs to.

**Architecture:** The pane's view state and history switch from scope-resolved `pageId` to world-resolvable `uuid` (`fromUuidSync`). The link classifier collapses to one rule (any page → in-pane). A document-permission check joins the existing hidden-flag check when resolving the viewed page, since scope no longer implies permission.

**Tech Stack:** FoundryVTT v13 (13.351) module, AppV2/HandlebarsApplicationMixin, vitest unit tests (pure modules only, no jsdom), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-07-10-timeline-pane-navigation-design.md`

## Global Constraints

- FoundryVTT v13 APIs only; core client source for reference: `/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app/client`.
- The permission level constant is `"OBSERVER"` (`CONST.DOCUMENT_OWNERSHIP_LEVELS`); the spec's "OBSERVED" is a typo.
- E2E is governed by `.claude/skills/foundry-e2e/SKILL.md` — READ IT FIRST. Session lock (if held by another session, STOP and report; never delete `.claude-e2e-lock`, never repoint the module symlink, never start/stop the Foundry server outside the harness), foreground runs only, all e2e world data uses the `E2E ` name prefix. Iterate on single specs; run the full suite once at the end of the final task.
- Pure-logic modules (`scripts/apps/hub/pane-history.mjs`, `scripts/logic/record-links.mjs`, `scripts/logic/visibility.mjs`) must stay Foundry-free; Foundry API calls happen in the mixin/sheet layer.
- Never use bare `git stash`. Never push. End every commit message with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Uuid identity end-to-end + one routing rule

Everything flips atomically in this task: the pure modules AND all their consumers. A partial flip leaves back/forward navigation silently broken (uuid-less entries all compare equal), so pure-module changes and mixin rewiring must land in one commit.

**Files:**
- Modify: `scripts/apps/hub/pane-history.mjs` (entries carry `uuid`; `prunePage` → `pruneUuid`)
- Modify: `scripts/logic/record-links.mjs` (classifier: any page → in-pane)
- Modify: `scripts/apps/hub/hub-mixin.mjs` (all `pageId` view-state touchpoints)
- Modify: `scripts/apps/hub/group-hub-sheet.mjs:23-26` (`goToPage` converts pageId → uuid)
- Test: `tests/pane-history.test.js`, `tests/record-links.test.js`
- Test (flip stale assertion): `tests/e2e/22-group-hub-sheet.spec.mjs:42-61`

**Interfaces:**
- Consumes: nothing new.
- Produces: `pushEntry(history, { kind: "record", uuid })` / `pruneUuid(history, uuid)` (pane-history); `classifyLinkTarget(doc)` → `{ kind: "in-pane", uuid }` for any `JournalEntryPage`, `{ kind: "external" }` otherwise (record-links); `navigateToRecord(uuid, { mode, pushHistory })` and `state.view = { uuid, mode }` (hub-mixin). Task 2 relies on `#resolveViewedPage()` returning any world page or `null`.

- [ ] **Step 1: Rewrite `tests/pane-history.test.js` to uuid entries (failing first)**

Replace the file's entire contents (same scenarios, `pageId` → `uuid`, `prunePage` → `pruneUuid`):

```js
import { describe, it, expect } from "vitest";
import {
  createHistory, currentEntry, pushEntry, canGoBack, canGoForward,
  goBack, goForward, pruneUuid
} from "../scripts/apps/hub/pane-history.mjs";

describe("pane history", () => {
  it("starts at the index root with no back/forward", () => {
    const h = createHistory();
    expect(currentEntry(h)).toEqual({ kind: "index" });
    expect(canGoBack(h)).toBe(false);
    expect(canGoForward(h)).toBe(false);
  });

  it("push advances the cursor; back and forward walk entries", () => {
    const h = createHistory();
    pushEntry(h, { kind: "record", uuid: "a" });
    pushEntry(h, { kind: "record", uuid: "b" });
    expect(currentEntry(h)).toEqual({ kind: "record", uuid: "b" });
    expect(goBack(h)).toEqual({ kind: "record", uuid: "a" });
    expect(goBack(h)).toEqual({ kind: "index" });
    expect(goBack(h)).toBeNull();
    expect(goForward(h)).toEqual({ kind: "record", uuid: "a" });
    expect(canGoForward(h)).toBe(true);
  });

  it("pushing the current entry again is a no-op", () => {
    const h = createHistory();
    pushEntry(h, { kind: "record", uuid: "a" });
    pushEntry(h, { kind: "record", uuid: "a" });
    expect(h.entries).toHaveLength(2);
    pushEntry(h, { kind: "index" });
    pushEntry(h, { kind: "index" });
    expect(h.entries).toHaveLength(3);
  });

  it("pushing after going back truncates forward history", () => {
    const h = createHistory();
    pushEntry(h, { kind: "record", uuid: "a" });
    pushEntry(h, { kind: "record", uuid: "b" });
    goBack(h); // at a
    pushEntry(h, { kind: "record", uuid: "c" });
    expect(h.entries.map((e) => e.uuid ?? "index")).toEqual(["index", "a", "c"]);
    expect(canGoForward(h)).toBe(false);
  });

  it("supports loops without special handling", () => {
    const h = createHistory();
    for (const id of ["a", "b", "c", "a"]) pushEntry(h, { kind: "record", uuid: id });
    expect(h.entries).toHaveLength(5);
    expect(currentEntry(h)).toEqual({ kind: "record", uuid: "a" });
    expect(goBack(h)).toEqual({ kind: "record", uuid: "c" });
  });

  it("pruneUuid removes entries for a deleted page and repairs the cursor", () => {
    const h = createHistory();
    for (const id of ["a", "b", "a", "c"]) pushEntry(h, { kind: "record", uuid: id });
    // entries: index, a, b, a, c — cursor on c
    goBack(h); // cursor on second a
    pruneUuid(h, "a");
    // entries: index, b, c — cursor falls to nearest surviving earlier entry (b)
    expect(h.entries.map((e) => e.uuid ?? "index")).toEqual(["index", "b", "c"]);
    expect(currentEntry(h)).toEqual({ kind: "record", uuid: "b" });
  });

  it("pruneUuid collapses duplicates that become adjacent", () => {
    const h = createHistory();
    for (const id of ["a", "b", "a"]) pushEntry(h, { kind: "record", uuid: id });
    pruneUuid(h, "b"); // index, a, a -> index, a
    expect(h.entries.map((e) => e.uuid ?? "index")).toEqual(["index", "a"]);
    expect(currentEntry(h)).toEqual({ kind: "record", uuid: "a" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/pane-history.test.js`
Expected: FAIL — `pruneUuid` is not exported (and uuid comparisons fail).

- [ ] **Step 3: Update `scripts/apps/hub/pane-history.mjs`**

Three edits — `entriesEqual`, the `prunePage` rename, and its internals:

```js
function entriesEqual(a, b) {
  return a.kind === b.kind && a.uuid === b.uuid;
}
```

```js
/** Remove all entries for a deleted page; collapse resulting adjacent duplicates. */
export function pruneUuid(history, uuid) {
  const kept = [];
  let cursor = 0;
  history.entries.forEach((entry, i) => {
    const doomed = entry.kind === "record" && entry.uuid === uuid;
    const duplicate = kept.length && !doomed && entriesEqual(kept[kept.length - 1], entry);
    if (!doomed && !duplicate) kept.push(entry);
    // The cursor lands on the nearest surviving entry at-or-before its old position.
    if (i === history.cursor) cursor = kept.length ? kept.length - 1 : 0;
  });
  history.entries = kept.length ? kept : [{ kind: "index" }];
  history.cursor = Math.min(cursor, history.entries.length - 1);
}
```

Everything else in the file is unchanged.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/pane-history.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Rewrite `tests/record-links.test.js` (failing first)**

Replace the file's entire contents:

```js
import { describe, it, expect } from "vitest";
import { classifyLinkTarget } from "../scripts/logic/record-links.mjs";

describe("classifyLinkTarget", () => {
  it("classifies any journal page as in-pane, carrying its uuid", () => {
    const page = {
      documentName: "JournalEntryPage",
      uuid: "JournalEntry.g1.JournalEntryPage.p1"
    };
    expect(classifyLinkTarget(page)).toEqual({
      kind: "in-pane", uuid: "JournalEntry.g1.JournalEntryPage.p1"
    });
  });

  it("pages in ordinary journals are in-pane too — parent flags are irrelevant", () => {
    const page = {
      documentName: "JournalEntryPage",
      uuid: "JournalEntry.j1.JournalEntryPage.p2",
      parent: { id: "j1", flags: {} }
    };
    expect(classifyLinkTarget(page).kind).toBe("in-pane");
  });

  it("classifies non-page documents and null as external", () => {
    expect(classifyLinkTarget({ documentName: "Actor", uuid: "Actor.a1" }).kind).toBe("external");
    expect(classifyLinkTarget(null).kind).toBe("external");
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run tests/record-links.test.js`
Expected: FAIL — classifier still requires the group flag and returns `pageId`/`groupId`.

- [ ] **Step 7: Rewrite `scripts/logic/record-links.mjs`**

Replace the file's entire contents (the `hasGroupFlag` import and the `scopedGroupIds` parameter go away):

```js
/**
 * Decide how the hub should handle activating a link to a document.
 * - "in-pane": any journal page — every page opens in the current hub's pane
 * - "external": anything else (defer to Foundry's default handling)
 */
export function classifyLinkTarget(doc) {
  if (doc?.documentName !== "JournalEntryPage") return { kind: "external" };
  return { kind: "in-pane", uuid: doc.uuid };
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run tests/record-links.test.js`
Expected: PASS (3 tests).

- [ ] **Step 9: Rewire `scripts/apps/hub/hub-mixin.mjs`**

Nine exact edits. Line numbers are as of branch point `32a4431` — re-locate by content, not number.

**(a) Import (line 14):** `prunePage` → `pruneUuid`:

```js
import {
  createHistory, pushEntry, canGoBack, canGoForward, goBack, goForward, pruneUuid
} from "./pane-history.mjs";
```

**(b) `#resolveViewedPage` (lines 83-91) — resolve by uuid, world-wide:**

```js
    /** The viewed page resolved from its uuid, or null. */
    #resolveViewedPage() {
      if (!this.state.view) return null;
      let doc = null;
      try {
        doc = fromUuidSync(this.state.view.uuid);
      } catch {
        // Not synchronously resolvable (e.g. compendium): treat as gone.
      }
      return doc?.documentName === "JournalEntryPage" ? doc : null;
    }
```

**(c) Delete `#inScope` (lines 93-95) entirely.** After all edits below, `grep -n "#inScope" scripts/apps/hub/hub-mixin.mjs` must return nothing.

**(d) `navigateToRecord` (lines 97-101) — uuid parameter:**

```js
    async navigateToRecord(uuid, { mode = "view", pushHistory = true } = {}) {
      this.state.view = { uuid, mode };
      if (pushHistory) pushEntry(this.#history, { kind: "record", uuid });
      await this.render();
    }
```

**(e) `#applyHistoryEntry` (line 112):**

```js
      return this.navigateToRecord(entry.uuid, { pushHistory: false });
```

**(f) `_onDocumentChanged` deleted-page pruning (lines 238-241):**

```js
      if (hook === "deleteJournalEntryPage" && this.state.view?.uuid === doc.uuid) {
        pruneUuid(this.#history, doc.uuid);
        this.state.view = null;
      }
```

**(g) `_configureRenderOptions` (lines 265-269) — core still hands us a pageId; convert on consumption.** Only document-backed hubs (GroupHubSheet) receive this routing, hence the optional chain:

```js
      if (options.pageId) {
        const page = this.document?.pages?.get(options.pageId);
        if (page) {
          this.state.view = { uuid: page.uuid, mode: "view" };
          pushEntry(this.#history, { kind: "record", uuid: page.uuid });
        }
        delete options.pageId; // consumed; must not re-trigger on later renders
      }
```

**(h) `#onOpenRecord` (lines 321-327) and `#onNewRecord` tail (lines 364-365) — one rule, no second window:**

```js
    static async #onOpenRecord(event, target) {
      const page = await fromUuid(target.closest("[data-uuid]").dataset.uuid);
      if (!page) return;
      await this.navigateToRecord(page.uuid);
    }
```

```js
      await this.navigateToRecord(page.uuid, { mode: "edit" });
```

(The `#onNewRecord` edit replaces both lines of the old `if (this.#inScope(page)) ... else ...` tail.)

**(i) `#onOpenLink` page branch (lines 478-482):**

```js
      if (doc.documentName === "JournalEntryPage") {
        return this.navigateToRecord(doc.uuid);
      }
```

**(j) `_prepareContext` (lines 627-643) — uuid in fallback and rail:**

```js
      const viewedPage = this.#resolveViewedPage();
      if (this.state.view && (!viewedPage || !isRecordVisible(game.user, viewedPage))) {
        // Deleted or no longer visible: fall back to the index.
        pruneUuid(this.#history, this.state.view.uuid);
        this.state.view = null;
      }
      context.canGoBack = canGoBack(this.#history);
      context.canGoForward = canGoForward(this.#history);
      context.view = this.state.view && viewedPage
        ? {
            name: viewedPage.name,
            editing: this.state.view.mode === "edit",
            canEdit: viewedPage.canUserModify(game.user, "update"),
            railCollapsed: game.settings.get(MODULE_ID, RAIL_SETTING),
            railGroups: this.#railGroups(viewedPage.uuid)
          }
        : null;
```

And `#railGroups` (lines 302, 315) takes/compares a uuid:

```js
    /** Rail entries: the filtered index grouped by type, current record flagged. */
    #railGroups(currentUuid) {
```

```js
          current: record.uuid === currentUuid
```

**(k) Content-link click handler (lines 730-736) — drop the scope set:**

```js
            const target = classifyLinkTarget(doc);
            if (target.kind === "external") return; // Foundry's default handling
            event.preventDefault();
            event.stopPropagation();
            this.navigateToRecord(target.uuid);
```

(The `const scoped = new Set(...)` line above it is deleted. `getScopedGroups` stays imported — other methods still use it.)

- [ ] **Step 10: Update `scripts/apps/hub/group-hub-sheet.mjs` `goToPage`**

Core callers pass a pageId of this sheet's own journal; convert to uuid:

```js
  /** Core JournalEntrySheet API compat: content links and callers land in-pane. */
  goToPage(pageId) {
    const page = this.document.pages.get(pageId);
    return page ? this.navigateToRecord(page.uuid) : undefined;
  }
```

- [ ] **Step 11: Flip the stale cross-group assertion in `tests/e2e/22-group-hub-sheet.spec.mjs`**

Replace the whole `"cross-group record links open the other group's hub"` test (lines 42-61) with:

```js
  test("cross-group record links open in this hub's own pane", async ({ page }) => {
    await login(page, "Gamemaster");
    // Content links only render as clickable anchors in the read-only
    // (enriched) view — inline editing shows a live editor instead.
    await page.evaluate(() => game.settings.set("campaign-record", "inlineEditing", false));
    const a = await createGroupWithPage(page, "E2E Sheet Alpha", "E2E Sheet Source", "campaign-record.npc");
    const b = await createGroupWithPage(page, "E2E Sheet Beta", "E2E Sheet Remote", "campaign-record.place");
    await page.evaluate(async ({ a, b }) => {
      const source = game.journal.get(a.groupId).pages.get(a.pageId);
      const remote = game.journal.get(b.groupId).pages.get(b.pageId);
      await source.update({ "system.description": `<p>@UUID[${remote.uuid}]{far away}</p>` });
      await game.journal.get(a.groupId).sheet.render(true);
      await game.journal.get(a.groupId).sheet.goToPage(a.pageId);
    }, { a, b });

    const alpha = page.locator(".group-hub").first();
    await alpha.locator(".record-pane-mount a.content-link", { hasText: "far away" }).click();
    // The SAME hub window shows the remote page; Beta's own hub never opens.
    await expect(alpha.locator(".record-pane-title")).toHaveText("E2E Sheet Remote");
    const betaHubOpen = await page.evaluate(
      ({ b }) => game.journal.get(b.groupId).sheet.rendered, { b }
    );
    expect(betaHubOpen).toBe(false);
  });
```

- [ ] **Step 12: Full unit suite**

Run: `npm test`
Expected: all pass (same file count; pane-history 7, record-links 3).

- [ ] **Step 13: Affected e2e specs (foundry-e2e contract applies)**

Run each foreground, per the skill's runner instructions:
- `tests/e2e/22-group-hub-sheet.spec.mjs` — including the flipped test
- `tests/e2e/21-hub-record-pane.spec.mjs` — pane open/history/edit flows still green on uuid identity
- `tests/e2e/08-hub-timeline.spec.mjs` — record-chip clicks still land in-pane

Expected: all green. If 08 or 21 encodes `pageId`-shaped expectations anywhere (grep them for `state.view` or `navigateToRecord`), update those call sites to pass uuids.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat: uuid-based pane navigation — every page opens in the current hub's pane"
```

---

### Task 2: Permission gate for arbitrary pages

Scope no longer implies permission: a player can now navigate to any page's uuid, so the viewed-page fallback must check document permission, not just the module's hidden flag.

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs` (`_prepareContext` fallback condition from Task 1 step 9j)
- Test: `tests/e2e/21-hub-record-pane.spec.mjs` (new test, player session)

**Interfaces:**
- Consumes: `#resolveViewedPage()` returning any world page or `null` (Task 1).
- Produces: nothing new for later tasks; behavior only.

- [ ] **Step 1: Add the permission check to the fallback condition**

In `_prepareContext`, extend the Task 1 condition (`"OBSERVER"`, not the spec's "OBSERVED" typo):

```js
      const viewedPage = this.#resolveViewedPage();
      const viewable = !!viewedPage
        && viewedPage.testUserPermission(game.user, "OBSERVER")
        && isRecordVisible(game.user, viewedPage);
      if (this.state.view && !viewable) {
        // Deleted, unresolvable, or not viewable by this user: fall back to the index.
        pruneUuid(this.#history, this.state.view.uuid);
        this.state.view = null;
      }
```

(`context.view = this.state.view && viewedPage ? ... : null` below is unchanged.)

- [ ] **Step 2: Add the player-session e2e test to `tests/e2e/21-hub-record-pane.spec.mjs`**

Follow the spec file's existing setup conventions (look at how `tests/e2e/08-hub-timeline.spec.mjs` builds a player context with `login(playerPage, "User 1")`). The test:

```js
  test("a page the player cannot observe falls back to the index silently", async ({ browser }) => {
    const gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    const ids = await createGroupWithPage(
      gmPage, "E2E Pane Restricted Group", "E2E Pane Restricted Page", "campaign-record.npc"
    );
    await gmPage.evaluate(async ({ groupId, pageId }) => {
      const target = game.journal.get(groupId).pages.get(pageId);
      await target.update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE } });
    }, ids);

    const playerCtx = await browser.newContext();
    const playerPage = await playerCtx.newPage();
    await login(playerPage, "User 1");
    await playerPage.evaluate(async ({ pageUuid }) => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
      const hub = foundry.applications.instances.get("campaign-hub");
      await hub.navigateToRecord(pageUuid);
    }, ids);

    const hub = playerPage.locator("#campaign-hub");
    await expect(hub.locator('.hub-index[data-tab="index"]')).toBeVisible();
    await expect(hub.locator(".record-pane-title")).toHaveCount(0);

    await deleteGroupsByPrefix(gmPage, "E2E Pane Restricted");
    await playerCtx.close();
    await gmPage.close();
  });
```

Adjust mechanics to the file's actual conventions (fixture-provided `page` vs manual contexts, `CampaignHub.open()` return value, the hub's application id) — the assertions are the contract: player lands on the index, no pane title renders, no error dialog.

- [ ] **Step 3: Run the spec**

Run: `tests/e2e/21-hub-record-pane.spec.mjs` (foreground, per contract)
Expected: all tests green, including the new one.

- [ ] **Step 4: Run the unit suite (guard against accidental damage)**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: permission-gate the record pane for out-of-scope pages"
```

---

### Task 3: E2E coverage for the new routing + full suite

**Files:**
- Test: `tests/e2e/08-hub-timeline.spec.mjs` (new test: ordinary-journal link chip)
- Test: `tests/e2e/22-group-hub-sheet.spec.mjs` (new test: new-record-into-other-group)

**Interfaces:**
- Consumes: everything from Tasks 1-2. No production code changes in this task; if a test exposes a defect, fix it here and say so in the report.

- [ ] **Step 1: Timeline link chip to an ordinary journal's page opens in this pane**

Add to `tests/e2e/08-hub-timeline.spec.mjs`, following its `openTimeline`/`groupSection` helpers and dynamic-import pattern for `timepoints.mjs`. Create the timepoint inside the test (don't depend on earlier tests' timepoints), and delete the plain journal at the end (`deleteGroupsByPrefix` only removes groups):

```js
  test("a link chip to an ordinary journal's page opens in this hub's pane", async () => {
    const pageName = "E2E Timeline Plain Page";
    await gmPage.evaluate(async ({ groupId }) => {
      const [journal] = await JournalEntry.createDocuments([{ name: "E2E Timeline Plain Journal" }]);
      const [plain] = await journal.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Timeline Plain Page", type: "text", text: { content: "<p>plain</p>" } }
      ]);
      const { getTimepoints, addTimepoint, addLink } =
        await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = game.journal.get(groupId);
      await addTimepoint(group, "Plain Link Timepoint", null);
      const tp = getTimepoints(group).find((t) => t.label === "Plain Link Timepoint");
      await addLink(group, tp.id, { uuid: plain.uuid, name: plain.name, type: "JournalEntryPage" });
    }, ids);

    const hub = await openTimeline(gmPage);
    await groupSection(gmPage).locator(".link-chip", { hasText: pageName }).click();
    await expect(hub.locator(".record-pane-title")).toHaveText(pageName);
    // The core journal sheet did NOT open.
    const coreSheetOpen = await gmPage.evaluate(
      () => game.journal.getName("E2E Timeline Plain Journal").sheet.rendered
    );
    expect(coreSheetOpen).toBe(false);

    await gmPage.evaluate(() => game.journal.getName("E2E Timeline Plain Journal").delete());
  });
```

Verify `addTimepoint`/`addLink` signatures against `scripts/data/timepoints.mjs` before running — adjust the call shapes if they differ.

- [ ] **Step 2: A record created into another group opens in this pane in edit mode**

Add to `tests/e2e/22-group-hub-sheet.spec.mjs`. The 21 spec already has a new-record dialog test (commit `ec0bd4b`) — copy its dialog-driving selectors rather than inventing new ones:

```js
  test("a record created into another group opens in this hub's pane in edit mode", async ({ page }) => {
    await login(page, "Gamemaster");
    const a = await createGroupWithPage(page, "E2E Sheet Alpha", "E2E Sheet Src", "campaign-record.npc");
    const b = await createGroupWithPage(page, "E2E Sheet Beta", "E2E Sheet Other", "campaign-record.place");
    await page.evaluate(({ a }) => game.journal.get(a.groupId).sheet.render(true), { a });
    const sheet = page.locator(".group-hub");
    await sheet.locator('[data-action="newRecord"]').click();
    const nameInput = page.locator('dialog input[name="name"], .application.dialog input[name="name"]');
    await nameInput.waitFor({ timeout: 10_000 });
    await nameInput.fill("E2E Sheet Created Elsewhere");
    await page.locator('dialog select[name="type"], .application.dialog select[name="type"]')
      .selectOption("campaign-record.npc");
    await page.locator('dialog select[name="group"], .application.dialog select[name="group"]')
      .selectOption(b.groupId);
    await page.locator('dialog button[data-action="ok"], .application.dialog button[data-action="ok"]').click();

    // Lands in ALPHA's pane, in edit mode, even though the page lives in Beta.
    await expect(sheet.locator(".record-pane-title")).toHaveText("E2E Sheet Created Elsewhere");
    await expect(sheet.locator(".record-pane-mount form")).toBeVisible();
    const inBeta = await page.evaluate(
      ({ b }) => !!game.journal.get(b.groupId).pages.getName("E2E Sheet Created Elsewhere"), { b }
    );
    expect(inBeta).toBe(true);
  });
```

(`deleteGroupsByPrefix(page, "E2E Sheet")` in the existing afterEach cleans both groups up.)

- [ ] **Step 3: Run both specs**

Run: `tests/e2e/08-hub-timeline.spec.mjs`, then `tests/e2e/22-group-hub-sheet.spec.mjs` (foreground, per contract)
Expected: green, including the two new tests.

- [ ] **Step 4: Full e2e suite + unit suite**

Run: full e2e suite once (per contract), then `npm test`.
Expected: everything green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: e2e coverage for unified in-pane navigation"
```
