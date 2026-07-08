# Campaign Record Phase 5 — Release Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make v1.0.0 releasable: schema-version migration runner with downgrade read-only guard, presenter hardening from the Phase 4 backlog, an i18n coverage gate, Quench suite completion, and Foundry package-listing assets.

**Architecture:** A pure migration planner (`scripts/logic/migrations.mjs`) drives a GM-side startup runner keyed on a `schemaVersion` world setting; a downgrade flips a module-wide read-only latch consulted by the existing preUpdate guards. Presenter hardening extends the payload contract (presenterId on goto/end, a sync-request action) inside the existing validator/socket/overlay layering. Release assets (README, LICENSE, release workflow, manifest URLs) ship in the final task with the 1.0.0 bump.

**Tech Stack:** Foundry VTT v13 (13.351), plain JS ES modules, Vitest, Playwright (live world-b), GitHub Actions (release zip).

## Global Constraints

- Plain JavaScript ES modules, **no build step**, no dependencies; all UI strings via `game.i18n` keys in `lang/en.json`.
- `scripts/logic/` stays free of Foundry globals (pure, Vitest-testable).
- Spec (Migrations): "A `schemaVersion` world setting plus a startup migration runner for structural changes... Present from the first release." Spec (Error Handling): "If the world's stored schema version is newer than the installed module, the module warns and goes read-only rather than risk corrupting data."
- Presenting stays GM-only; socket handlers keep no-op-on-invalid; the documented residual (raw module sockets carry no authenticated sender) remains — hardening raises the bar, it cannot authenticate.
- module.json edits require a test-server restart before e2e: `lsof -ti :30000 | xargs kill; sleep 2` (global-setup boots world-b).
- Test commands: `npm test` and `npx playwright test` (workers=1). Baselines entering this phase: **31 unit / 49 e2e green** — full suites stay green after every task. `trace: "retain-on-failure"` is already configured; if the known 13-loot flake recurs, keep the trace for diagnosis instead of just retrying.
- Commit after each green test cycle with a conventional message.

---

### Task 1: Presenter hardening (Phase 4 backlog)

presenterId-matched goto/end, late-joiner resync, timer restart on manual steps, presenter-dismiss-ends-for-all, and the prev-at-index-0 wrap assertion.

**Files:**
- Modify: `scripts/logic/presenter-payload.mjs`, `scripts/presenter/socket.mjs`, `scripts/presenter/overlay.mjs`, `scripts/sheets/media-sheet.mjs`, `scripts/campaign-record.mjs`
- Test: `tests/presenter-payload.test.js`, `tests/e2e/16-presenter.spec.mjs`

**Interfaces:**
- Produces: payload shapes become `{action:"goto", index, presenterId}`, `{action:"end", presenterId}`, `{action:"sync-request"}` (show unchanged); `MediaOverlay.activePresenterId()` → string|null; `MediaOverlay.answerSyncRequest()`; `requestPresentationSync()` exported from socket.mjs (player-emittable — bypasses the GM broadcast guard because it carries no presentation content).
- Behavior decision (document in code): **the presenter dismissing their own overlay ends the presentation for everyone** (they are the driver); viewers' dismiss stays local.

- [ ] **Step 1: Update the validator unit tests (failing first)**

In `tests/presenter-payload.test.js`, replace the goto/end cases and add sync-request:

```js
  it("goto and end require a presenterId; sync-request has no payload", () => {
    expect(validatePresenterPayload({ action: "goto", index: 3, presenterId: "u1" }))
      .toEqual({ action: "goto", index: 3, presenterId: "u1" });
    expect(validatePresenterPayload({ action: "goto", index: 3 })).toBeNull();
    expect(validatePresenterPayload({ action: "goto", index: -1, presenterId: "u1" })).toBeNull();
    expect(validatePresenterPayload({ action: "end", presenterId: "u1" }))
      .toEqual({ action: "end", presenterId: "u1" });
    expect(validatePresenterPayload({ action: "end" })).toBeNull();
    expect(validatePresenterPayload({ action: "sync-request" })).toEqual({ action: "sync-request" });
    expect(validatePresenterPayload({ action: "self-destruct" })).toBeNull();
  });
```

Run: `npm test` → FAIL (old shapes accepted, sync-request rejected).

- [ ] **Step 2: Implement in `scripts/logic/presenter-payload.mjs`**

Replace the `goto`/`end` cases and add `sync-request`:

```js
    case "goto":
      return Number.isInteger(raw.index) && raw.index >= 0 &&
        typeof raw.presenterId === "string" && raw.presenterId
        ? { action: "goto", index: raw.index, presenterId: raw.presenterId }
        : null;
    case "end":
      return typeof raw.presenterId === "string" && raw.presenterId
        ? { action: "end", presenterId: raw.presenterId }
        : null;
    case "sync-request":
      return { action: "sync-request" };
```

Run: `npm test` → PASS.

- [ ] **Step 3: Socket routing in `scripts/presenter/socket.mjs`**

Replace the routing body of `applyPresenterMessage` (keep the doc comment, extend its last paragraph with one line: "goto/end additionally must match the active presentation's presenterId — this narrows, but cannot eliminate, the spoofing window."):

```js
  const p = validatePresenterPayload(raw);
  if (!p) return;
  if (p.action === "show") {
    if (!game.users.get(p.presenterId)?.isGM) return;
    MediaOverlay.show(p);
  } else if (p.action === "sync-request") {
    MediaOverlay.answerSyncRequest();
  } else {
    // goto/end only steer the presentation they belong to
    if (p.presenterId !== MediaOverlay.activePresenterId()) return;
    if (p.action === "goto") MediaOverlay.goTo(p.index);
    else MediaOverlay.endForAll();
  }
```

And add (players must be able to emit this, so it does not go through the GM-guarded broadcast):

```js
/** Ask an active presenter, if any, to re-broadcast the current show. */
export function requestPresentationSync() {
  game.socket.emit(SOCKET_NAME, { action: "sync-request" });
}
```

- [ ] **Step 4: Overlay changes in `scripts/presenter/overlay.mjs`**

Add the two statics, restart the timer on manual/goto steps, make presenter dismissal end for all, and carry presenterId on emits:

```js
  static activePresenterId() {
    return this.#instance?.#state?.presenterId ?? null;
  }

  /** A late joiner asked for state: the active presenter re-broadcasts it. */
  static answerSyncRequest() {
    const app = this.#instance;
    if (!app?.#state || !app.isPresenter) return;
    broadcastPresenterMessage({ ...app.#state, action: "show" });
  }
```

In `goTo`, after the render line:

```js
    // manual steps and resyncs restart the auto-advance countdown
    if (app.isPresenter && app.#state.interval) app.#restartTimer();
```

Replace `#onDismiss`:

```js
  /** The presenter dismissing their own overlay ends for everyone (they are
   *  the driver); a viewer's dismiss closes only their own overlay. */
  static async #onDismiss() {
    if (this.isPresenter && this.#state) {
      return void broadcastPresenterMessage({ action: "end", presenterId: this.#state.presenterId });
    }
    this.#stopTimer();
    await this.close();
  }
```

In `#restartTimer`'s tick and in `#onStepImage`, the goto payload gains presenterId:

```js
      broadcastPresenterMessage({ action: "goto", index: next, presenterId: this.#state.presenterId });
```

(both call sites). In `#onEndPresentation`:

```js
    broadcastPresenterMessage({ action: "end", presenterId: this.#state.presenterId });
```

- [ ] **Step 5: Sheet + ready-hook emitters**

`scripts/sheets/media-sheet.mjs` `#onEndPresentation`:

```js
  static #onEndPresentation() {
    if (!game.user.isGM) return;
    broadcastPresenterMessage({ action: "end", presenterId: game.user.id });
  }
```

`scripts/campaign-record.mjs` — extend the socket import and the ready hook:

```js
import { registerPresenterSocket, requestPresentationSync } from "./presenter/socket.mjs";
```

```js
Hooks.once("ready", () => {
  registerPresenterSocket();
  // a reloading/late-joining client re-acquires any presentation in progress
  requestPresentationSync();
  if (game.user.isGM) ensureRecordsFolder();
});
```

- [ ] **Step 6: Rework `tests/e2e/16-presenter.spec.mjs`**

(a) In the relay test, add presenterId to the goto/end broadcasts (`{ action: "goto", index: 1, presenterId: gmId }`, malformed cases keep failing shapes, `{ action: "end", presenterId: gmId }`).

(b) In the flow test: after the existing prev assertion (player back on book.svg), add the zero-boundary wrap:

```js
    // prev at index 0 wraps to the last image
    await gmPage.locator('#campaign-record-overlay [data-action="stepImage"][data-dir="-1"]').click();
    await expect.poll(() => playerOverlay().locator("img").getAttribute("src")).toContain("chest.svg");
```

(c) Presenter-dismiss semantics changed: the segment that asserted "player dismiss is local: GM keeps presenting" stays (viewer path unchanged), but the later segment where the GM locally dismissed and then used the sheet End button must be reworked — GM dismiss now ends for all. Replace that segment with:

```js
    // presenter dismiss ends the presentation for everyone
    await sheet.locator('[data-action="showImage"]').first().click();
    await playerOverlay().locator("img").waitFor({ timeout: 15_000 });
    await gmPage.locator('#campaign-record-overlay [data-action="dismissOverlay"]').click();
    await expect(playerOverlay()).toHaveCount(0, { timeout: 15_000 });
    await expect(gmPage.locator("#campaign-record-overlay")).toHaveCount(0, { timeout: 15_000 });

    // sheet-level End works directly (no overlay interaction needed)
    await sheet.locator('[data-action="showImage"]').first().click();
    await playerOverlay().locator("img").waitFor({ timeout: 15_000 });
    await sheet.locator('[data-action="endPresentation"]').click();
    await expect(playerOverlay()).toHaveCount(0, { timeout: 15_000 });
```

(d) New test — spoofed goto with the wrong presenterId is ignored:

```js
  test("goto with a mismatched presenterId is ignored", async () => {
    await gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = gmPage.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[data-action="showImage"]').first().click();
    await playerOverlay().locator("img").waitFor({ timeout: 15_000 });
    const srcBefore = await playerOverlay().locator("img").getAttribute("src");
    await playerPage.evaluate(async () => {
      const { SOCKET_NAME } = await import("/modules/campaign-record/scripts/presenter/socket.mjs");
      game.socket.emit(SOCKET_NAME, { action: "goto", index: 1, presenterId: game.user.id });
    });
    await settle(playerPage);
    expect(await playerOverlay().locator("img").getAttribute("src")).toBe(srcBefore);
    await sheet.locator('[data-action="endPresentation"]').click();
    await expect(playerOverlay()).toHaveCount(0, { timeout: 15_000 });
  });
```

(e) New test — late joiner resync:

```js
  test("a reloading player re-acquires the running presentation", async () => {
    await gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = gmPage.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[data-action="showImage"]').first().click();
    await playerOverlay().locator("img").waitFor({ timeout: 15_000 });

    await playerPage.reload();
    await playerPage.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
    await playerOverlay().locator("img").waitFor({ timeout: 15_000 });

    await sheet.locator('[data-action="endPresentation"]').click();
    await expect(playerOverlay()).toHaveCount(0, { timeout: 15_000 });
  });
```

(Adapt fixture/local names to the file; the hidden-media test comes after these — make sure it still runs on an un-hidden record or re-orders cleanly.)

- [ ] **Step 7: Run gates**

```bash
npx playwright test tests/e2e/16-presenter.spec.mjs
npx playwright test
npm test
```

Expected: 16-presenter 6 passed; full e2e 51 (49 + 2); unit 31 (same count, updated cases).

- [ ] **Step 8: Commit**

```bash
git add scripts/logic/presenter-payload.mjs scripts/presenter scripts/sheets/media-sheet.mjs scripts/campaign-record.mjs tests/presenter-payload.test.js tests/e2e/16-presenter.spec.mjs
git commit -m "feat: presenter hardening — presenterId-matched goto/end, resync, dismiss semantics"
```

---

### Task 2: Minor polish bundle (Phase 4 backlog)

**Files:**
- Modify: `scripts/sheets/media-sheet.mjs`, `templates/partials/actor-info.hbs`, `tests/e2e/16-presenter.spec.mjs` (notification scoping), `tests/e2e/17-dnd5e.spec.mjs` (PC coverage)

**Interfaces:**
- Consumes: existing `#presentPayload` and `#onShowImage`; `actorSummary` (sets `ac` only when non-null, including 0).

- [ ] **Step 1: Single snapshot per present click in `scripts/sheets/media-sheet.mjs`**

Add a private helper and refactor the two callers so `toObject()` runs once per click:

```js
  /** Gallery rows that can actually present (blank-src rows would invalidate the payload). */
  #presentableImages() {
    return this.document.system.toObject().images.filter((i) => i.src);
  }

  /** Build a show payload from the given rows, or null (guards + warnings). */
  #presentPayload(images, index, interval) {
    if (!game.user.isGM) return null;
    if (this.document.system.hidden) {
      ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Media.CannotPresentHidden"));
      return null;
    }
    if (!images.length) {
      ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Presenter.NoImages"));
      return null;
    }
    return {
      action: "show",
      images: images.map((i) => ({ src: i.src, caption: i.caption })),
      index: Math.max(0, Math.min(index, images.length - 1)),
      presenterId: game.user.id,
      interval
    };
  }

  static #onShowImage(event, target) {
    const images = this.#presentableImages();
    const rowId = target.closest("[data-row-id]")?.dataset.rowId;
    const index = Math.max(0, images.findIndex((r) => r.id === rowId));
    const payload = this.#presentPayload(images, index, 0);
    if (payload) broadcastPresenterMessage(payload);
  }

  static #onStartSlideshow() {
    const payload = this.#presentPayload(this.#presentableImages(), 0, this.document.system.slideshowInterval);
    if (payload) broadcastPresenterMessage(payload);
  }
```

- [ ] **Step 2: AC zero renders in `templates/partials/actor-info.hbs`**

```hbs
    {{#if actorInfo.ac includeZero=true}}<span>{{localize "CAMPAIGNRECORD.ActorInfo.AC"}} {{actorInfo.ac}}</span>{{/if}}
```

- [ ] **Step 3: Scope the hidden-guard notification poll in `tests/e2e/16-presenter.spec.mjs`**

Replace the unscoped `.notification.warning` count poll with a text-scoped one:

```js
    await expect.poll(() =>
      gmPage.evaluate(() =>
        [...document.querySelectorAll(".notification.warning")].filter((n) =>
          n.textContent.includes("Hidden media")
        ).length
      )
    ).toBeGreaterThan(0);
```

- [ ] **Step 4: PC actorInfo e2e in `tests/e2e/17-dnd5e.spec.mjs`**

Extend the linked-actor test (reuse its created actor) — after the NPC assertions:

```js
    // same summary path on the PC sheet
    await page.evaluate(
      async ({ groupId, actorUuid }) => {
        const g = game.journal.get(groupId);
        const [p] = await g.createEmbeddedDocuments("JournalEntryPage", [
          { name: "E2E 5e PC", type: "campaign-record.pc" }
        ]);
        await p.sheet.render(true);
        await p.sheet._onDropDocument({ type: "Actor", uuid: actorUuid });
      },
      { groupId: ids.groupId, actorUuid }
    );
    const pcInfo = page.locator(".campaign-record.record-sheet .actor-info").last();
    await pcInfo.waitFor({ timeout: 15_000 });
    await expect(pcInfo).toContainText("E2E 5e Guard");
```

(Adapt locals: `actorUuid` must be in scope — hoist it from the existing test body if needed.)

- [ ] **Step 5: Run gates**

```bash
npx playwright test tests/e2e/16-presenter.spec.mjs tests/e2e/17-dnd5e.spec.mjs
npx playwright test
npm test
```

Expected: full e2e 51 (counts unchanged — extensions live inside existing tests); unit 31.

- [ ] **Step 6: Commit**

```bash
git add scripts/sheets/media-sheet.mjs templates/partials/actor-info.hbs tests/e2e/16-presenter.spec.mjs tests/e2e/17-dnd5e.spec.mjs
git commit -m "fix: minor polish — single gallery snapshot, AC zero display, scoped warn poll, PC summary e2e"
```

---

### Task 3: Schema versioning, migration runner, and downgrade read-only guard

**Files:**
- Modify: `scripts/constants.mjs`, `scripts/campaign-record.mjs`, `scripts/hooks/guards.mjs`, `lang/en.json`
- Create: `scripts/logic/migrations.mjs`, `scripts/data/migration-runner.mjs`
- Test: `tests/migrations.test.js`, `tests/e2e/18-migrations.spec.mjs`

**Interfaces:**
- Produces: `SCHEMA_VERSION = 1`, `SCHEMA_SETTING = "schemaVersion"` (constants); pure `pendingMigrations(registry, stored, current)` → ascending applicable migrations, `isDowngrade(stored, current)` → boolean; `registerSchemaSetting()`, `runMigrations()`, `isModuleReadOnly()` from migration-runner.

- [ ] **Step 1: Failing unit tests `tests/migrations.test.js`**

```js
import { describe, it, expect } from "vitest";
import { pendingMigrations, isDowngrade } from "../scripts/logic/migrations.mjs";

const reg = [
  { version: 2, run: () => {} },
  { version: 1, run: () => {} },
  { version: 3, run: () => {} }
];

describe("migration planning", () => {
  it("returns applicable migrations in ascending order", () => {
    expect(pendingMigrations(reg, 0, 3).map((m) => m.version)).toEqual([1, 2, 3]);
    expect(pendingMigrations(reg, 1, 3).map((m) => m.version)).toEqual([2, 3]);
    expect(pendingMigrations(reg, 1, 2).map((m) => m.version)).toEqual([2]);
  });

  it("returns nothing when current or downgraded", () => {
    expect(pendingMigrations(reg, 3, 3)).toEqual([]);
    expect(pendingMigrations(reg, 5, 3)).toEqual([]);
  });

  it("detects downgrades", () => {
    expect(isDowngrade(2, 1)).toBe(true);
    expect(isDowngrade(1, 1)).toBe(false);
    expect(isDowngrade(0, 1)).toBe(false);
  });
});
```

Run: `npm test` → FAIL (module not found).

- [ ] **Step 2: Implement `scripts/logic/migrations.mjs`**

```js
/** Pure planning for the schema-version migration runner. */

/** Applicable migrations, ascending; empty when up to date or downgraded. */
export function pendingMigrations(registry, stored, current) {
  if (stored >= current) return [];
  return registry
    .filter((m) => m.version > stored && m.version <= current)
    .sort((a, b) => a.version - b.version);
}

/** The world was last saved by a NEWER module version than the one installed. */
export function isDowngrade(stored, current) {
  return stored > current;
}
```

Run: `npm test` → PASS (34).

- [ ] **Step 3: Constants + runner**

`scripts/constants.mjs` — append:

```js
/** Structural schema version of world data written by this module. */
export const SCHEMA_VERSION = 1;
export const SCHEMA_SETTING = "schemaVersion";
```

Create `scripts/data/migration-runner.mjs`:

```js
import { MODULE_ID, GROUP_FLAG, SCHEMA_VERSION, SCHEMA_SETTING } from "../constants.mjs";
import { pendingMigrations, isDowngrade } from "../logic/migrations.mjs";
import { getGroups } from "./groups.mjs";

let readOnly = false;

/** True when the world's schema is newer than this module: block module writes. */
export function isModuleReadOnly() {
  return readOnly;
}

/** Ascending structural migrations. Each moves the world TO `version`. */
export const MIGRATIONS = [
  {
    version: 1,
    // Dev-era worlds may carry a truthy-but-malformed group flag; normalize to
    // the {timepoints: []} shape the timeline relies on.
    async run() {
      for (const group of getGroups()) {
        const flag = group.getFlag(MODULE_ID, GROUP_FLAG);
        if (!Array.isArray(flag?.timepoints)) {
          await group.setFlag(MODULE_ID, GROUP_FLAG, { timepoints: [] });
        }
      }
    }
  }
];

export function registerSchemaSetting() {
  game.settings.register(MODULE_ID, SCHEMA_SETTING, {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
}

/** Run at ready: every client checks for downgrade; only the GM migrates. */
export async function runMigrations() {
  const stored = game.settings.get(MODULE_ID, SCHEMA_SETTING);
  if (isDowngrade(stored, SCHEMA_VERSION)) {
    readOnly = true;
    ui.notifications.warn(
      game.i18n.format("CAMPAIGNRECORD.Warning.SchemaNewer", {
        stored,
        current: SCHEMA_VERSION
      }),
      { permanent: true }
    );
    return;
  }
  if (!game.user.isGM || stored >= SCHEMA_VERSION) return;
  for (const migration of pendingMigrations(MIGRATIONS, stored, SCHEMA_VERSION)) {
    console.log(`campaign-record | migrating world data to schema ${migration.version}`);
    await migration.run();
    await game.settings.set(MODULE_ID, SCHEMA_SETTING, migration.version);
  }
}
```

- [ ] **Step 4: Wire into `scripts/campaign-record.mjs` and `scripts/hooks/guards.mjs`**

`campaign-record.mjs`:

```js
import { registerSchemaSetting, runMigrations } from "./data/migration-runner.mjs";
```

In `init` (after `registerDataModels()`): `registerSchemaSetting();`
Ready hook becomes:

```js
Hooks.once("ready", async () => {
  await runMigrations();
  registerPresenterSocket();
  requestPresentationSync();
  if (game.user.isGM) ensureRecordsFolder();
});
```

`guards.mjs` — import and enforce read-only ahead of the existing checks, plus a group-flag guard:

```js
import { MODULE_ID } from "../constants.mjs";
import { isModuleReadOnly } from "../data/migration-runner.mjs";
```

At the top of the `preUpdateJournalEntryPage` handler:

```js
    if (isModuleReadOnly() && page.type.startsWith(`${MODULE_ID}.`)) {
      ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Warning.ReadOnly"));
      return false;
    }
```

New hook in the same register function:

```js
  Hooks.on("preUpdateJournalEntry", (entry, changes) => {
    if (isModuleReadOnly() && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) {
      ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Warning.ReadOnly"));
      return false;
    }
  });
```

`lang/en.json` — under `Warning`:

```json
      "SchemaNewer": "Campaign Record: this world's data (schema {stored}) was written by a newer module version than the one installed (schema {current}). Records are read-only until you update the module.",
      "ReadOnly": "Campaign Record is read-only: the world's data schema is newer than the installed module."
```

- [ ] **Step 5: E2E spec `tests/e2e/18-migrations.spec.mjs`**

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

test.describe("schema migrations", () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
  });

  test.afterAll(async () => {
    // always restore the real schema version, even on failure
    await page.evaluate(async () => {
      await game.settings.set("campaign-record", "schemaVersion", 1);
    });
    await deleteGroupsByPrefix(page, "E2E Migration");
    await page.close();
  });

  test("legacy group flags are normalized on reload", async () => {
    await page.evaluate(async () => {
      await JournalEntry.create({
        name: "E2E Migration Legacy",
        flags: { "campaign-record": { group: true } } // dev-era malformed flag
      });
      await game.settings.set("campaign-record", "schemaVersion", 0);
    });
    await page.reload();
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
    await expect
      .poll(() =>
        page.evaluate(() =>
          game.journal.getName("E2E Migration Legacy")?.getFlag("campaign-record", "group")
        )
      )
      .toEqual({ timepoints: [] });
    expect(await page.evaluate(() => game.settings.get("campaign-record", "schemaVersion"))).toBe(1);
  });

  test("a newer stored schema puts the module in read-only", async () => {
    const pageId = await page.evaluate(async () => {
      const entry = game.journal.getName("E2E Migration Legacy");
      const [p] = await entry.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Migration NPC", type: "campaign-record.npc" }
      ]);
      await game.settings.set("campaign-record", "schemaVersion", 999);
      return p.id;
    });
    await page.reload();
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });

    // warned...
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.querySelectorAll(".notification.warning")].filter((n) =>
            n.textContent.includes("read-only")
          ).length
        )
      )
      .toBeGreaterThan(0);

    // ...and module-page updates are blocked
    const role = await page.evaluate(async (pageId) => {
      const p = game.journal.getName("E2E Migration Legacy").pages.get(pageId);
      await p.update({ "system.role": "Should Not Persist" }).catch(() => {});
      return p.system.role;
    }, pageId);
    expect(role).toBe("");

    // restore and confirm normal operation returns
    await page.evaluate(async () => {
      await game.settings.set("campaign-record", "schemaVersion", 1);
    });
    await page.reload();
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
    const roleAfter = await page.evaluate(async (pageId) => {
      const p = game.journal.getName("E2E Migration Legacy").pages.get(pageId);
      await p.update({ "system.role": "Writable Again" });
      return p.system.role;
    }, pageId);
    expect(roleAfter).toBe("Writable Again");
  });
});
```

(Note: setting `schemaVersion` while read-only must not be blocked — the guards only cover module documents, not settings, so the restore path works.)

- [ ] **Step 6: Run gates**

```bash
npx playwright test tests/e2e/18-migrations.spec.mjs
npx playwright test
npm test
```

Expected: 18-migrations 2 passed; full e2e 53 (51 + 2); unit 34.

- [ ] **Step 7: Commit**

```bash
git add scripts/constants.mjs scripts/logic/migrations.mjs scripts/data/migration-runner.mjs scripts/campaign-record.mjs scripts/hooks/guards.mjs lang/en.json tests/migrations.test.js tests/e2e/18-migrations.spec.mjs
git commit -m "feat: schemaVersion setting, startup migration runner, downgrade read-only guard"
```

---

### Task 4: i18n coverage gate + localization sweep

A unit test that extracts every i18n key referenced in templates and scripts and asserts it resolves in `lang/en.json` — then fix whatever it finds, plus a manual grep for hardcoded user-facing English.

**Files:**
- Create: `tests/i18n-coverage.test.js`
- Modify: `lang/en.json` and/or any template/script the test flags

**Interfaces:**
- Consumes: repo layout (`templates/**/*.hbs`, `scripts/**/*.mjs`, `lang/en.json`); `RECORD_TYPES` list in `scripts/constants.mjs` (the test re-parses it textually to avoid importing Foundry-coupled modules).

- [ ] **Step 1: Write the coverage test**

```js
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const lang = JSON.parse(fs.readFileSync(path.join(ROOT, "lang/en.json"), "utf8"));

function resolve(key) {
  return key.split(".").reduce((node, part) => node?.[part], lang);
}

function filesUnder(dir, ext) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => path.join(e.parentPath ?? e.path, e.name));
}

function extractKeys() {
  const keys = new Set();
  const patterns = [
    /\{\{\s*localize\s+"([^"]+)"/g, // {{localize "KEY"}}
    /data-tooltip="((?:CAMPAIGNRECORD|TYPES)[^"{]+)"/g, // static tooltip keys
    /game\.i18n\.(?:localize|format)\(\s*"([^"]+)"/g, // JS lookups
    /labelPrefix:\s*"([^"]+)"/g, // hub tab labels (suffixed below)
    /(?:title|label):\s*"((?:CAMPAIGNRECORD|TYPES)[^"]+)"/g // AppV2 window titles, sheet labels
  ];
  const files = [...filesUnder(path.join(ROOT, "templates"), ".hbs"), ...filesUnder(path.join(ROOT, "scripts"), ".mjs")];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const re of patterns) {
      for (const m of text.matchAll(re)) keys.add(m[1]);
    }
  }
  return keys;
}

describe("i18n coverage", () => {
  it("every referenced key resolves in lang/en.json", () => {
    const missing = [];
    for (const key of extractKeys()) {
      if (key === "CAMPAIGNRECORD.Hub.Tabs") {
        for (const tab of ["index", "timeline", "search"]) {
          if (typeof resolve(`${key}.${tab}`) !== "string") missing.push(`${key}.${tab}`);
        }
        continue;
      }
      if (typeof resolve(key) !== "string") missing.push(key);
    }
    expect(missing).toEqual([]);
  });

  it("every record type has a TYPES label", () => {
    const constants = fs.readFileSync(path.join(ROOT, "scripts/constants.mjs"), "utf8");
    const types = [...constants.matchAll(/"(\w+)"/g)].map((m) => m[1]);
    const recordTypes = types.filter((t) =>
      ["npc", "place", "quest", "pc", "item", "encounter", "checklist", "shop", "loot", "media"].includes(t)
    );
    expect(recordTypes.length).toBe(10);
    for (const t of recordTypes) {
      expect(typeof lang.TYPES.JournalEntryPage[`campaign-record.${t}`]).toBe("string");
    }
  });
});
```

- [ ] **Step 2: Run it; fix every finding**

Run: `npm test`. Any missing key is a real gap: add the key to `lang/en.json` (or fix a typoed reference). If a pattern over-matches something that is not an i18n key (e.g. a `label:` that is intentionally plain), prefer converting that string to a real key over weakening the regex — the sweep's purpose is to eliminate hardcoded user-facing text. Also manually skim templates for hardcoded English text nodes (`grep -rn ">[A-Z][a-z]" templates/` is a decent first net) and convert any real finding to a key.

- [ ] **Step 3: Gates + commit**

Run: `npm test` (expect 36 = 34 + 2) and `npx playwright test` (53).

```bash
git add tests/i18n-coverage.test.js lang/en.json templates scripts
git commit -m "test: i18n coverage gate; localization sweep fixes"
```

---

### Task 5: Quench suite completion

Extend the in-world Quench batches to the Phase 3/4 surface: all ten types register and construct with defaults, list-row round-trips, and visibility filtering. Quench isn't installed in world-b, so live verification is that the module (with the extended file) still loads cleanly and all suites stay green; actually running the batches remains on the manual checklist.

**Files:**
- Modify: `scripts/testing/quench.mjs`
- Test: existing suites as regression gate (`tests/e2e/01-module.spec.mjs` proves clean load)

**Interfaces:**
- Consumes: `RECORD_TYPES`, `typeId` from constants; `isRecordVisible` from `scripts/logic/visibility.mjs`.

- [ ] **Step 1: Add a types batch to `scripts/testing/quench.mjs`**

Add imports:

```js
import { RECORD_TYPES } from "../constants.mjs";
import { isRecordVisible } from "../logic/visibility.mjs";
```

Register after the existing batches:

```js
  quench.registerBatch(
    "campaign-record.types",
    (context) => {
      const { describe, it, assert, before, after } = context;
      let group;

      describe("Record types", () => {
        before(async () => {
          group = await createGroup("Quench Types Group");
        });
        after(async () => {
          await group.delete();
        });

        it("registers a data model for every record type", () => {
          for (const t of RECORD_TYPES) {
            assert.ok(CONFIG.JournalEntryPage.dataModels[typeId(t)], `missing model for ${t}`);
          }
        });

        it("creates every type with schema defaults", async () => {
          for (const t of RECORD_TYPES) {
            const [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
              { name: `Quench ${t}`, type: typeId(t) }
            ]);
            assert.equal(page.system.hidden, false, `${t} hidden default`);
            assert.ok(page.system.schema.fields.timepoints, `${t} timepoints field`);
          }
        });

        it("list rows round-trip through targeted updates", async () => {
          const rows = {
            encounter: ["combatants", { id: foundry.utils.randomID(), name: "Goblin", count: 3, actor: null }],
            checklist: ["items", { id: foundry.utils.randomID(), text: "Pack rations", done: false, assignee: "" }],
            shop: ["inventory", { id: foundry.utils.randomID(), name: "Rope", price: "1 gp", quantity: 2, item: null }],
            loot: ["items", { id: foundry.utils.randomID(), name: "Gem", quantity: 1, item: null }],
            media: ["images", { id: foundry.utils.randomID(), src: "icons/svg/book.svg", caption: "Cover" }]
          };
          for (const [t, [field, row]] of Object.entries(rows)) {
            const [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
              { name: `Quench rows ${t}`, type: typeId(t) }
            ]);
            await page.update({ [`system.${field}`]: [row] });
            const stored = page.system.toObject()[field];
            assert.equal(stored.length, 1, `${t}.${field} length`);
            assert.equal(stored[0].id, row.id, `${t}.${field} id survives`);
          }
        });

        it("loot currency stores integer denominations", async () => {
          const [loot] = await group.createEmbeddedDocuments("JournalEntryPage", [
            { name: "Quench Currency", type: typeId("loot") }
          ]);
          await loot.update({ "system.currency.gp": 250 });
          assert.equal(loot.system.currency.gp, 250);
          assert.equal(loot.system.currency.cp, 0);
        });

        it("hidden records are invisible to a non-GM perspective", async () => {
          const [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
            { name: "Quench Hidden", type: typeId("npc") }
          ]);
          await setRecordHidden(page, true);
          const player = game.users.find((u) => !u.isGM);
          assert.equal(isRecordVisible(player, page), false);
          assert.equal(isRecordVisible(game.user, page), true); // GM runs Quench
        });
      });
    },
    { displayName: "Campaign Record: Types" }
  );
```

- [ ] **Step 2: Gates + commit**

Run: `npm test` (36) and `npx playwright test` (53 — 01-module proves the extended file loads).

```bash
git add scripts/testing/quench.mjs
git commit -m "test: quench batch covering all record types, rows, currency, visibility"
```

---

### Task 6: Package-listing assets and v1.0.0

**Files:**
- Create: `README.md`, `LICENSE`, `.github/workflows/release.yml`
- Modify: `module.json` (url/manifest/download/version), `docs/manual-test-checklist.md`

**Interfaces:**
- Consumes: repo remote `https://github.com/bularzik/campaign-record`.

- [ ] **Step 1: `module.json` release fields**

```json
  "version": "1.0.0",
  "url": "https://github.com/bularzik/campaign-record",
  "manifest": "https://github.com/bularzik/campaign-record/releases/latest/download/module.json",
  "download": "https://github.com/bularzik/campaign-record/releases/latest/download/module.zip",
```

(Replace the existing empty `url`/`manifest`/`download` values and the version line; nothing else.)

- [ ] **Step 2: `LICENSE`** — MIT, copyright `2026 Dan Bularzik` (standard MIT text verbatim).

- [ ] **Step 3: `README.md`**

Write it from the spec's Summary/feature set — sections: what it is (collaborative campaign journaling for Foundry v13+, dnd5e-focused, system-agnostic core); Features (ten record types, groups, Campaign Hub index/timeline/search, GM-only media presenter with synced slideshow, hidden records & GM notes, dnd5e price/rarity/actor integration); Installation (manifest URL paste + package listing once published); Usage quick-start (create a group from the Journal sidebar, open the Hub via button/tool/Ctrl+Shift+H, presenting from a Media record); Permissions model summary (everyone edits by default, GM-only hidden/gmNotes, render-time secrecy caveat verbatim from the spec's Permissions section); Development (npm test, npm run test:e2e, environment contract pointer to tests/e2e/README.md); License (MIT).

- [ ] **Step 4: `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags: ["v*"]

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build module archive
        run: zip -r module.zip module.json scripts templates styles lang
      - name: Attach release assets
        uses: softprops/action-gh-release@v2
        with:
          files: |
            module.json
            module.zip
```

- [ ] **Step 5: Manual checklist release gate**

Add to `docs/manual-test-checklist.md` manual section: run the Quench batches in a world with Quench installed (now three batches: Core, Hub, Types); verify a fresh world initializes `schemaVersion` to 1 with no console errors; after tagging a release, install via the manifest URL into a clean Foundry and smoke-test module load.

- [ ] **Step 6: Full gates** (module.json changed → restart)

```bash
npm test
lsof -ti :30000 | xargs kill; sleep 2
npx playwright test
```

Expected: 36 unit; 53 e2e, all green.

- [ ] **Step 7: Commit**

```bash
git add module.json LICENSE README.md .github/workflows/release.yml docs/manual-test-checklist.md
git commit -m "chore: release assets and v1.0.0 — README, MIT license, release workflow, manifest URLs"
```

---

## Self-Review Notes

- **Spec coverage:** Migrations section → Task 3 (schemaVersion world setting, startup runner, present from first release; Error Handling's newer-schema read-only → downgrade latch + guards, e2e-proven both directions). Build Phasing item 5 → migration e2e (seed old-schema flag, reload, assert migrated) + full-suite green gates every task; localization sweep → Task 4 (with a durable unit gate, satisfying "All UI strings through game.i18n... scaffolding only" for non-English); Quench completion → Task 5; package listing → Task 6. Phase 4/5 carry-forwards → Tasks 1–2 (presenter hardening set, prev-wrap, AC-0, PC e2e, scoped poll, single snapshot); 13-loot flake tracing is already satisfied (`trace: "retain-on-failure"` shipped in Phase 4) — nothing to do beyond using traces if it recurs.
- **Deliberate choices:** presenter-dismiss now ends for all (documented in code; replaces the ambiguous frozen-slideshow state); `sync-request` bypasses the GM-only broadcast wrapper because players must request state and the reply path re-validates as a normal GM show; migration #1 is a genuinely useful defensive normalization (dev-era malformed group flags) rather than a fake test-only migration; LICENSE is MIT — **flag to the user at phase end in case they prefer another license**; the read-only guard is client-side advisory, consistent with the module's existing guard philosophy (render-time secrecy, spec-accepted).
- **Type consistency:** payload shapes updated identically in validator, socket router, overlay emitters, media-sheet emitter, and both e2e specs; `pendingMigrations(registry, stored, current)` signature matches runner usage; `isModuleReadOnly` import path in guards matches the new module; expected suite counts trace: unit 31→31 (T1) →34 (T3) →36 (T4); e2e 49→51 (T1) →51 (T2) →53 (T3) →53 (T5/T6).
