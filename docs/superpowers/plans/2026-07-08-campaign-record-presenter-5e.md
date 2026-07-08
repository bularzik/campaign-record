# Campaign Record Phase 4 — Media Presenter + dnd5e Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GM-only push-to-players media presenting with socket-synced slideshow, the dnd5e integration layer (item price/rarity autofill, linked-actor portrait/stats), and the Phase 3 carry-forward polish (CSS pass for the new sheets, test-hygiene minors).

**Architecture:** A pure payload-validation module (`scripts/logic/`) feeds a socket wrapper (`scripts/presenter/socket.mjs`) that both broadcasts and applies presenter messages; a singleton frameless `MediaOverlay` ApplicationV2 renders the fullscreen image on every client. The Media sheet gains GM-only present controls that build payloads from document state (hidden-media guard on the GM side). The dnd5e layer is one `scripts/integrations/dnd5e.mjs` module of feature-detected helpers consumed by the Shop/Item/NPC/PC sheets, degrading to no-ops off-5e.

**Tech Stack:** Foundry VTT v13 (13.351) — `game.socket` module channel, ApplicationV2 + HandlebarsApplicationMixin; plain JS ES modules; Vitest (pure logic), Playwright multi-client e2e (world-b is dnd5e 5.3.3, so the 5e layer is live-testable).

## Global Constraints

- Foundry v13+; plain JavaScript ES modules, **no build step**, no dependencies.
- All user-facing strings via `game.i18n` with keys in `lang/en.json`.
- ApplicationV2 part templates render **exactly one root element**.
- `scripts/logic/` stays free of Foundry globals (pure, Vitest-testable).
- Presenting is **GM-only in v1**; hidden Media records must never be presentable; socket handlers validate payloads and **no-op on unknown/invalid messages** (spec Error Handling).
- Sockets require `"socket": true` in `module.json`; module.json edits require a test-server restart before e2e: `lsof -ti :30000 | xargs kill; sleep 2` (playwright global-setup boots world-b).
- dnd5e helpers activate only when `game.system.id === "dnd5e"`; on other systems every feature degrades to the existing plain-field behavior (spec §4).
- List-row inputs keep the `data-row-field`/no-`name=` contract; scalar fields keep `{{formGroup}}`/submitOnChange.
- Test commands: `npm test` (Vitest) and `npx playwright test` (workers=1, live Foundry). Baselines entering this phase: **27 unit / 42 e2e, all green** — full suites must stay green after every task.
- Commit after each green test cycle with a conventional message.

---

### Task 1: Carry-forward test hygiene & code nits (Phase 3 backlog)

Clears the ledgered minors: loot source-drop e2e gap, media reorder boundary assertion, search-spec cleanup hygiene, silent catch in `bindRowInputs`, a comment in `toSearchRecord`, and cold-boot login resilience.

**Files:**
- Modify: `scripts/sheets/base-record-sheet.mjs` (catch logs a warn)
- Modify: `scripts/apps/hub/hub-data.mjs` (comment only)
- Modify: `tests/e2e/helpers/foundry.mjs` (login retry)
- Modify: `tests/e2e/07-hub-search.spec.mjs`, `tests/e2e/13-loot.spec.mjs`, `tests/e2e/14-media.spec.mjs`

**Interfaces:**
- Consumes: `LootSheet._onDropDocument(data)` (accepts `{type:"JournalEntryPage", uuid}` and links only encounter pages); `MediaSheet` `moveImage` action with boundary no-op.
- Produces: nothing new — behavior-preserving except the added `console.warn`.

- [ ] **Step 1: `bindRowInputs` catch logs before resync**

In `scripts/sheets/base-record-sheet.mjs`, the row-update rejection handler currently re-renders silently. Match the house style (cf. `timepoints.mjs`):

```js
      this.updateRows(field, (rows) => {
        const row = rows.find((r) => r.id === id);
        if (row) row[key] = value;
      }).catch((error) => {
        console.warn("campaign-record | row update rejected; resyncing sheet", error);
        this.render();
      });
```

(Keep the existing empty/non-finite number guard exactly as it is.)

- [ ] **Step 2: primitive-array comment in `toSearchRecord`**

In `scripts/apps/hub/hub-data.mjs`, above the array-of-rows extraction loop, add:

```js
    // Rows are expected to be objects; an ArrayField of primitive strings
    // would yield no text here and be silently unsearchable — add a mapper
    // if such a field ever ships.
```

- [ ] **Step 3: cold-boot login retry in `tests/e2e/helpers/foundry.mjs`**

Wrap the join-page navigation + `waitForURL` in one retry (an 11-checklist run flaked when a player login raced a cold server boot). Replace the body of `login` with:

```js
export async function login(page, userName) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(`${BASE_URL}/join`);
    const select = page.locator('select[name="userid"]');
    await select.waitFor({ timeout: 15_000 });
    const disabled = await select
      .locator("option", { hasText: userName })
      .first()
      .isDisabled()
      .catch(() => false);
    if (disabled) {
      throw new Error(
        `User "${userName}" is already connected to the test world — close other sessions (browsers, stray test runners) and retry.`
      );
    }
    await select.selectOption({ label: userName });
    await page.locator('button[name="join"], form#join-game-form button[type="submit"]').first().click();
    try {
      await page.waitForURL("**/game", { timeout: 30_000 });
      break;
    } catch (error) {
      // Cold server boots occasionally swallow the first join; retry once.
      if (attempt === 1) throw error;
    }
  }
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
}
```

- [ ] **Step 4: 07-hub-search cleanup in try/finally**

In the "UUID link values are not searchable..." test, wrap the assertions so the plain journal is deleted even on failure:

```js
    try {
      expect(await search("abcdef0123456789")).toBe(0);
      expect(await search("zanzibar")).toBe(0);
    } finally {
      await gmPage.evaluate(() => game.journal.getName("E2E Search Plain Journal")?.delete());
    }
```

(Match the actual helper/assertion names in the file; only the try/finally structure is the change.)

- [ ] **Step 5: 13-loot source-drop gate test**

Append to the describe block in `tests/e2e/13-loot.spec.mjs` (reuse its `page`/`ids` fixtures):

```js
  test("source link accepts only encounter pages via drop", async () => {
    const uuids = await page.evaluate(async ({ groupId }) => {
      const g = game.journal.get(groupId);
      const [enc, npc] = await g.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Loot Source Enc", type: "campaign-record.encounter" },
        { name: "E2E Loot Source Npc", type: "campaign-record.npc" }
      ]);
      return { enc: enc.uuid, npc: npc.uuid };
    }, { groupId: ids.groupId });
    const drop = (uuid) =>
      page.evaluate(
        async ({ groupId, pageId, uuid }) => {
          const sheet = game.journal.get(groupId).pages.get(pageId).sheet;
          await sheet.render(true);
          await sheet._onDropDocument({ type: "JournalEntryPage", uuid });
        },
        { groupId: ids.groupId, pageId: ids.pageId, uuid }
      );
    await drop(uuids.npc); // wrong type: silent no-op
    await expect.poll(async () => (await system()).source).toBeFalsy();
    await drop(uuids.enc);
    await expect.poll(async () => (await system()).source).toBe(uuids.enc);
  });
```

- [ ] **Step 6: 14-media boundary no-op assertion**

Inside the existing "caption edit, reorder, and delete persist in order" test, right after the move-up assertion, add:

```js
    // moveImage at the list boundary is a no-op
    await sheet.locator('[data-action="moveImage"][data-dir="-1"]').first().click();
    await expect.poll(async () => (await images()).map((i) => i.caption)).toEqual(["Second", "Cover"]);
```

- [ ] **Step 7: Run the gates**

Run: `npm test` → 27 passed. `npx playwright test` → 43 passed (42 baseline + the new loot test).

- [ ] **Step 8: Commit**

```bash
git add scripts/sheets/base-record-sheet.mjs scripts/apps/hub/hub-data.mjs tests/e2e/helpers/foundry.mjs tests/e2e/07-hub-search.spec.mjs tests/e2e/13-loot.spec.mjs tests/e2e/14-media.spec.mjs
git commit -m "test: phase-3 carry-forward hygiene — loot source-drop gate, media boundary, login retry"
```

---

### Task 2: CSS pass for record sheets

The seven Phase 3 sheets ship with no type-specific styling. Add generic row-list rules (keyed on the `data-rows` contract so all list types share them), fact-list layout, the shop table, the media gallery/rows, and the loot currency grid.

**Files:**
- Modify: `styles/campaign-record.css` (append; do not restructure existing rules)

**Interfaces:**
- Consumes: existing markup classes — `[data-rows]` lists, `dl.record-facts`, `table.shop-inventory`, `.media-gallery`, `.media-image-row`, `.checklist-items`, `.loot-currency .form-fields-grid`.
- Produces: nothing consumed by later tasks (Task 3 adds its own overlay CSS separately).

- [ ] **Step 1: Append the rules**

```css
/* --- record sheet lists (shared data-rows contract) --- */
.campaign-record [data-rows] {
  list-style: none;
  margin: 0.25rem 0;
  padding: 0;
}

.campaign-record [data-rows] > li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.campaign-record [data-rows] input[type="text"] {
  flex: 1;
}

.campaign-record [data-rows] input[type="number"] {
  flex: 0 0 auto;
  width: 4.5rem;
  text-align: center;
}

.campaign-record [data-rows] select {
  flex: 0 0 auto;
  width: auto;
  max-width: 10rem;
}

.campaign-record [data-rows] button {
  flex: 0 0 auto;
  width: auto;
  line-height: 1;
  padding: 0.15rem 0.4rem;
}

.campaign-record fieldset {
  margin: 0.5rem 0;
  border-radius: 4px;
}

/* --- fact lists (view mode) --- */
.campaign-record .record-facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.15rem 0.75rem;
  margin: 0.25rem 0 0.75rem;
}

.campaign-record .record-facts dt {
  font-weight: bold;
}

.campaign-record .record-facts dd {
  margin: 0;
}

/* --- checklist --- */
.campaign-record .checklist-items .done {
  text-decoration: line-through;
  opacity: 0.7;
}

.campaign-record .checklist-items .assignee {
  font-size: var(--font-size-12, 12px);
  opacity: 0.8;
  border: 1px solid var(--color-border-light-primary, #7a7971);
  border-radius: 1rem;
  padding: 0 0.5rem;
}

/* --- shop inventory table --- */
.campaign-record table.shop-inventory {
  width: 100%;
  border-collapse: collapse;
  margin: 0.5rem 0;
}

.campaign-record table.shop-inventory th,
.campaign-record table.shop-inventory td {
  text-align: left;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid var(--color-border-light-primary, #7a7971);
}

/* --- loot currency: five denominations in one row --- */
.campaign-record .loot-currency .form-fields-grid {
  grid-template-columns: repeat(5, 1fr);
}

/* --- media sheet rows and view gallery --- */
.campaign-record .media-image-row img {
  width: 3rem;
  height: 3rem;
  object-fit: cover;
  flex: 0 0 auto;
}

.campaign-record .media-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.5rem;
}

.campaign-record .media-gallery figure {
  margin: 0;
}

.campaign-record .media-gallery img {
  max-width: 100%;
  height: auto;
}

.campaign-record .media-gallery figcaption {
  font-size: var(--font-size-12, 12px);
  opacity: 0.8;
  text-align: center;
}
```

- [ ] **Step 2: Visual spot-check + suites stay green**

Open one row-list sheet live to confirm nothing is broken (e.g. run `npx playwright test tests/e2e/12-shop.spec.mjs tests/e2e/14-media.spec.mjs` — CSS cannot fail assertions but layout crashes would surface as click-target misses). Then full `npx playwright test` → 43 passed; `npm test` → 27 passed.

- [ ] **Step 3: Commit**

```bash
git add styles/campaign-record.css
git commit -m "style: layout pass for phase-3 record sheets (rows, facts, shop table, media gallery)"
```

---

### Task 3: Presenter payload validation, socket channel, and overlay app

The transport + display layer: a pure validator (Vitest, TDD), a socket wrapper that broadcasts-and-applies, and the fullscreen `MediaOverlay`. One e2e test proves live cross-client relay at the API level (sheet controls come in Task 4).

**Files:**
- Create: `scripts/logic/presenter-payload.mjs`
- Create: `scripts/presenter/socket.mjs`, `scripts/presenter/overlay.mjs`
- Create: `templates/presenter/overlay.hbs`
- Modify: `module.json` (add `"socket": true`), `scripts/campaign-record.mjs` (ready hook), `lang/en.json`, `styles/campaign-record.css`
- Test: `tests/unit → tests/presenter-payload.test.js`, `tests/e2e/16-presenter.spec.mjs`

**Interfaces:**
- Produces (consumed by Task 4):
  - `validatePresenterPayload(raw)` → normalized payload or `null`. Shapes: `{action:"show", images:[{src,caption}], index, presenterId, interval}` (interval seconds, 0 = manual), `{action:"goto", index}`, `{action:"end"}`.
  - `broadcastPresenterMessage(payload)` — emits on `module.campaign-record` AND applies locally (Foundry sockets do not echo to the sender).
  - `applyPresenterMessage(raw)` — validate + route to `MediaOverlay.show/goTo/endForAll`; invalid → no-op.
  - `MediaOverlay.show(state)` / `MediaOverlay.goTo(index)` / `MediaOverlay.endForAll()`; overlay DOM id `#campaign-record-overlay`; dismiss button action `dismissOverlay` (local close only); presenter-only controls `stepImage` (data-dir ±1) and `endPresentation`.

- [ ] **Step 1: Write failing unit tests `tests/presenter-payload.test.js`**

```js
import { describe, it, expect } from "vitest";
import { validatePresenterPayload } from "../scripts/logic/presenter-payload.mjs";

const show = {
  action: "show",
  images: [{ src: "a.webp", caption: "A" }, { src: "b.webp" }],
  index: 1,
  presenterId: "user1",
  interval: 0
};

describe("validatePresenterPayload", () => {
  it("accepts and normalizes a valid show payload", () => {
    const p = validatePresenterPayload(show);
    expect(p).toMatchObject({ action: "show", index: 1, presenterId: "user1", interval: 0 });
    expect(p.images).toEqual([{ src: "a.webp", caption: "A" }, { src: "b.webp", caption: "" }]);
  });

  it("rejects show payloads with bad images or out-of-range index", () => {
    expect(validatePresenterPayload({ ...show, images: [] })).toBeNull();
    expect(validatePresenterPayload({ ...show, images: [{ src: "" }] })).toBeNull();
    expect(validatePresenterPayload({ ...show, index: 2 })).toBeNull();
    expect(validatePresenterPayload({ ...show, index: -1 })).toBeNull();
    expect(validatePresenterPayload({ ...show, presenterId: "" })).toBeNull();
  });

  it("coerces invalid intervals to 0", () => {
    expect(validatePresenterPayload({ ...show, interval: -5 }).interval).toBe(0);
    expect(validatePresenterPayload({ ...show, interval: "7" }).interval).toBe(0);
    expect(validatePresenterPayload({ ...show, interval: 7 }).interval).toBe(7);
  });

  it("validates goto and end; unknown actions and junk are null", () => {
    expect(validatePresenterPayload({ action: "goto", index: 3 })).toEqual({ action: "goto", index: 3 });
    expect(validatePresenterPayload({ action: "goto", index: -1 })).toBeNull();
    expect(validatePresenterPayload({ action: "end" })).toEqual({ action: "end" });
    expect(validatePresenterPayload({ action: "self-destruct" })).toBeNull();
    expect(validatePresenterPayload(null)).toBeNull();
    expect(validatePresenterPayload("show")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test` — FAIL (module not found).

- [ ] **Step 3: Implement `scripts/logic/presenter-payload.mjs`**

```js
/**
 * Socket payload shapes for the media presenter. Unknown or malformed
 * messages return null so handlers no-op (version-mismatched clients).
 */
export function validatePresenterPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  switch (raw.action) {
    case "show": {
      const { images, index, presenterId, interval } = raw;
      if (!Array.isArray(images) || !images.length) return null;
      if (!images.every((i) => i && typeof i.src === "string" && i.src)) return null;
      if (!Number.isInteger(index) || index < 0 || index >= images.length) return null;
      if (typeof presenterId !== "string" || !presenterId) return null;
      return {
        action: "show",
        images: images.map((i) => ({
          src: i.src,
          caption: typeof i.caption === "string" ? i.caption : ""
        })),
        index,
        presenterId,
        interval: Number.isInteger(interval) && interval > 0 ? interval : 0
      };
    }
    case "goto":
      return Number.isInteger(raw.index) && raw.index >= 0
        ? { action: "goto", index: raw.index }
        : null;
    case "end":
      return { action: "end" };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run unit tests to verify pass**

Run: `npm test` → 31 passed (27 + 4).

- [ ] **Step 5: Socket wrapper `scripts/presenter/socket.mjs`**

```js
import { MODULE_ID } from "../constants.mjs";
import { validatePresenterPayload } from "../logic/presenter-payload.mjs";
import { MediaOverlay } from "./overlay.mjs";

export const SOCKET_NAME = `module.${MODULE_ID}`;

export function registerPresenterSocket() {
  game.socket.on(SOCKET_NAME, (payload) => applyPresenterMessage(payload));
}

/** Validate and apply a presenter message on this client; invalid → no-op. */
export function applyPresenterMessage(raw) {
  const p = validatePresenterPayload(raw);
  if (!p) return;
  if (p.action === "show") MediaOverlay.show(p);
  else if (p.action === "goto") MediaOverlay.goTo(p.index);
  else MediaOverlay.endForAll();
}

/** Sockets never echo back to the sender: emit to others AND apply locally. */
export function broadcastPresenterMessage(payload) {
  game.socket.emit(SOCKET_NAME, payload);
  applyPresenterMessage(payload);
}
```

- [ ] **Step 6: Overlay app `scripts/presenter/overlay.mjs`**

The socket↔overlay import cycle is safe: both modules only reference each other's bindings inside function bodies, never at module-evaluation time.

```js
import { broadcastPresenterMessage } from "./socket.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Fullscreen borderless image overlay, one singleton per client. */
export class MediaOverlay extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance = null;

  #state = null;
  #timer = null;

  static DEFAULT_OPTIONS = {
    id: "campaign-record-overlay",
    classes: ["campaign-record", "media-overlay"],
    window: { frame: false, positioned: false },
    actions: {
      dismissOverlay: MediaOverlay.#onDismiss,
      stepImage: MediaOverlay.#onStepImage,
      endPresentation: MediaOverlay.#onEndPresentation
    }
  };

  static PARTS = {
    overlay: { template: "modules/campaign-record/templates/presenter/overlay.hbs" }
  };

  static show(state) {
    this.#instance ??= new MediaOverlay();
    const app = this.#instance;
    app.#state = state;
    app.render({ force: true });
    app.#restartTimer();
  }

  /** Update the current index; renders only if this client still shows the overlay. */
  static goTo(index) {
    const app = this.#instance;
    if (!app?.#state || index >= app.#state.images.length) return;
    app.#state.index = index;
    if (app.rendered) app.render();
  }

  static endForAll() {
    const app = this.#instance;
    if (!app) return;
    app.#stopTimer();
    app.#state = null;
    if (app.rendered) app.close();
  }

  get isPresenter() {
    return this.#state?.presenterId === game.user.id;
  }

  #restartTimer() {
    this.#stopTimer();
    if (!this.#state?.interval || !this.isPresenter) return;
    this.#timer = setInterval(() => {
      const next = (this.#state.index + 1) % this.#state.images.length;
      broadcastPresenterMessage({ action: "goto", index: next });
    }, this.#state.interval * 1000);
  }

  #stopTimer() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = this.#state ?? { images: [], index: 0 };
    context.image = state.images[state.index] ?? null;
    context.isPresenter = this.isPresenter;
    context.position = `${state.index + 1} / ${state.images.length}`;
    return context;
  }

  /** Viewers close their own overlay; the presentation keeps running elsewhere. */
  static async #onDismiss() {
    this.#stopTimer();
    await this.close();
  }

  static #onStepImage(event, target) {
    if (!this.isPresenter || !this.#state) return;
    const count = this.#state.images.length;
    const next = (this.#state.index + Number(target.dataset.dir) + count) % count;
    broadcastPresenterMessage({ action: "goto", index: next });
  }

  static #onEndPresentation() {
    if (!this.isPresenter) return;
    broadcastPresenterMessage({ action: "end" });
  }

  _onClose(options) {
    this.#stopTimer();
    super._onClose(options);
  }
}
```

- [ ] **Step 7: Overlay template `templates/presenter/overlay.hbs`** (single root)

```hbs
<div class="overlay-backdrop">
  {{#if image}}
  <figure>
    <img src="{{image.src}}" alt="{{image.caption}}">
    {{#if image.caption}}<figcaption>{{image.caption}}</figcaption>{{/if}}
  </figure>
  {{/if}}
  <div class="overlay-controls">
    {{#if isPresenter}}
    <button type="button" data-action="stepImage" data-dir="-1"
            aria-label="{{localize "CAMPAIGNRECORD.Presenter.Prev"}}"><i class="fa-solid fa-chevron-left"></i></button>
    <span class="overlay-count">{{position}}</span>
    <button type="button" data-action="stepImage" data-dir="1"
            aria-label="{{localize "CAMPAIGNRECORD.Presenter.Next"}}"><i class="fa-solid fa-chevron-right"></i></button>
    <button type="button" data-action="endPresentation">
      <i class="fa-solid fa-stop"></i> {{localize "CAMPAIGNRECORD.Presenter.End"}}
    </button>
    {{/if}}
    <button type="button" data-action="dismissOverlay"
            aria-label="{{localize "CAMPAIGNRECORD.Presenter.Dismiss"}}"><i class="fa-solid fa-xmark"></i></button>
  </div>
</div>
```

- [ ] **Step 8: Wiring, socket flag, lang, CSS**

`scripts/campaign-record.mjs` — add:

```js
import { registerPresenterSocket } from "./presenter/socket.mjs";
```

and inside the existing `Hooks.once("ready", ...)` callback (before the GM folder line is fine):

```js
  registerPresenterSocket();
```

`module.json` — add `"socket": true,` (top level, after `"styles"`).

`lang/en.json` — under `CAMPAIGNRECORD` add:

```json
    "Presenter": {
      "ShowToPlayers": "Show to players",
      "StartSlideshow": "Start Slideshow",
      "End": "End Presentation",
      "Prev": "Previous image",
      "Next": "Next image",
      "Dismiss": "Dismiss",
      "NoImages": "This media record has no images to present."
    },
```

and under `Media`: `"CannotPresentHidden": "Hidden media cannot be presented to players.",`

`styles/campaign-record.css` — append:

```css
/* --- media presenter overlay --- */
#campaign-record-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

#campaign-record-overlay .overlay-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
}

#campaign-record-overlay figure {
  margin: 0;
  max-width: 96vw;
  max-height: 92vh;
  text-align: center;
}

#campaign-record-overlay img {
  max-width: 96vw;
  max-height: 86vh;
  object-fit: contain;
  border: none;
}

#campaign-record-overlay figcaption {
  color: #eee;
  margin-top: 0.5rem;
}

#campaign-record-overlay .overlay-controls {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #eee;
}

#campaign-record-overlay .overlay-controls button {
  width: auto;
  line-height: 1.4;
  padding: 0.25rem 0.6rem;
}
```

- [ ] **Step 9: E2E relay test `tests/e2e/16-presenter.spec.mjs`** (API-level; sheet controls arrive in Task 4)

```js
import { test, expect } from "@playwright/test";
import { login } from "./helpers/foundry.mjs";

test.describe("presenter socket relay", () => {
  let gmPage, playerCtx, playerPage;

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    playerCtx = await browser.newContext();
    playerPage = await playerCtx.newPage();
    await login(playerPage, "User 1");
  });

  test.afterAll(async () => {
    await playerCtx.close();
    await gmPage.close();
  });

  test("broadcast show/goto/end reaches the player client; junk payloads no-op", async () => {
    const broadcast = (payload) =>
      gmPage.evaluate(async (payload) => {
        const { broadcastPresenterMessage } =
          await import("/modules/campaign-record/scripts/presenter/socket.mjs");
        broadcastPresenterMessage(payload);
      }, payload);

    const gmId = await gmPage.evaluate(() => game.user.id);
    await broadcast({
      action: "show",
      images: [{ src: "icons/svg/book.svg", caption: "One" }, { src: "icons/svg/chest.svg", caption: "Two" }],
      index: 0,
      presenterId: gmId,
      interval: 0
    });

    const playerImg = playerPage.locator("#campaign-record-overlay img");
    await playerImg.waitFor({ timeout: 15_000 });
    expect(await playerImg.getAttribute("src")).toContain("book.svg");
    // GM (sender) applies locally too
    await gmPage.locator("#campaign-record-overlay img").waitFor({ timeout: 15_000 });
    // player is not the presenter: no step controls
    await expect(playerPage.locator('#campaign-record-overlay [data-action="stepImage"]')).toHaveCount(0);

    await broadcast({ action: "goto", index: 1 });
    await expect.poll(() => playerImg.getAttribute("src")).toContain("chest.svg");

    // malformed payloads are ignored
    await broadcast({ action: "goto", index: 99 });
    await broadcast({ action: "self-destruct" });
    await expect.poll(() => playerImg.getAttribute("src")).toContain("chest.svg");

    await broadcast({ action: "end" });
    await expect(playerPage.locator("#campaign-record-overlay")).toHaveCount(0, { timeout: 15_000 });
    await expect(gmPage.locator("#campaign-record-overlay")).toHaveCount(0, { timeout: 15_000 });
  });
});
```

- [ ] **Step 10: Restart server (module.json changed), run gates**

```bash
lsof -ti :30000 | xargs kill; sleep 2
npx playwright test tests/e2e/16-presenter.spec.mjs
npx playwright test
npm test
```

Expected: 31 unit; 44 e2e (43 + 1).

- [ ] **Step 11: Commit**

```bash
git add scripts/logic/presenter-payload.mjs scripts/presenter tests/presenter-payload.test.js templates/presenter module.json scripts/campaign-record.mjs lang/en.json styles/campaign-record.css tests/e2e/16-presenter.spec.mjs
git commit -m "feat: presenter socket channel and fullscreen media overlay"
```

---

### Task 4: Presenter controls on the Media sheet

GM-only "Show to players" per image, "Start Slideshow"/"End Presentation" buttons, hidden-media guard, auto-advance from `slideshowInterval`. Full user-flow e2e.

**Files:**
- Modify: `scripts/sheets/media-sheet.mjs`, `templates/media/edit.hbs`, `templates/media/view.hbs`
- Test: `tests/e2e/16-presenter.spec.mjs` (extend)

**Interfaces:**
- Consumes: `broadcastPresenterMessage(payload)` from `scripts/presenter/socket.mjs`; payload shapes from Task 3; `CAMPAIGNRECORD.Presenter.*` and `CAMPAIGNRECORD.Media.CannotPresentHidden` lang keys.
- Produces: sheet actions `showImage` (per row/figure), `startSlideshow`, `endPresentation` — all GM-only.

- [ ] **Step 1: Sheet actions in `scripts/sheets/media-sheet.mjs`**

Add the import and three actions:

```js
import { broadcastPresenterMessage } from "../presenter/socket.mjs";
```

```js
  static DEFAULT_OPTIONS = {
    actions: {
      addImage: MediaSheet.#onAddImage,
      deleteImage: MediaSheet.#onDeleteImage,
      moveImage: MediaSheet.#onMoveImage,
      showImage: MediaSheet.#onShowImage,
      startSlideshow: MediaSheet.#onStartSlideshow,
      endPresentation: MediaSheet.#onEndPresentation
    }
  };
```

```js
  /** Build a show payload from document state, or null (guards + warnings). */
  #presentPayload(index, interval) {
    if (!game.user.isGM) return null;
    if (this.document.system.hidden) {
      ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Media.CannotPresentHidden"));
      return null;
    }
    const images = this.document.system.toObject().images;
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
    const images = this.document.system.toObject().images;
    const rowId = target.closest("[data-row-id]")?.dataset.rowId;
    const index = Math.max(0, images.findIndex((r) => r.id === rowId));
    const payload = this.#presentPayload(index, 0);
    if (payload) broadcastPresenterMessage(payload);
  }

  static #onStartSlideshow() {
    const payload = this.#presentPayload(0, this.document.system.slideshowInterval);
    if (payload) broadcastPresenterMessage(payload);
  }

  static #onEndPresentation() {
    if (!game.user.isGM) return;
    broadcastPresenterMessage({ action: "end" });
  }
```

- [ ] **Step 2: Edit template controls (`templates/media/edit.hbs`)**

Add a per-row present button inside the row (before the move-up button):

```hbs
      {{#if @root.isGM}}
      <button type="button" data-action="showImage"
              data-tooltip="CAMPAIGNRECORD.Presenter.ShowToPlayers"><i class="fa-solid fa-display"></i></button>
      {{/if}}
```

And after the Add Image button, still inside the fieldset:

```hbs
  {{#if isGM}}
  <button type="button" data-action="startSlideshow">
    <i class="fa-solid fa-play"></i> {{localize "CAMPAIGNRECORD.Presenter.StartSlideshow"}}
  </button>
  <button type="button" data-action="endPresentation">
    <i class="fa-solid fa-stop"></i> {{localize "CAMPAIGNRECORD.Presenter.End"}}
  </button>
  {{/if}}
```

- [ ] **Step 3: View template controls (`templates/media/view.hbs`)**

Give figures the row id and a GM present button:

```hbs
<div class="media-gallery">
  {{#each system.images}}
  <figure data-row-id="{{this.id}}">
    <img src="{{this.src}}" alt="{{this.caption}}">
    {{#if this.caption}}<figcaption>{{this.caption}}</figcaption>{{/if}}
    {{#if @root.isGM}}
    <button type="button" data-action="showImage">
      <i class="fa-solid fa-display"></i> {{localize "CAMPAIGNRECORD.Presenter.ShowToPlayers"}}
    </button>
    {{/if}}
  </figure>
  {{/each}}
</div>
```

- [ ] **Step 4: Extend `tests/e2e/16-presenter.spec.mjs`** with a second describe block

```js
import { deleteGroupsByPrefix, createGroupWithPage, settle } from "./helpers/foundry.mjs";

test.describe("media sheet presenting", () => {
  let gmPage, playerCtx, playerPage, ids;

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    ids = await createGroupWithPage(gmPage, "E2E Present Group", "E2E Present Media", "campaign-record.media");
    await gmPage.evaluate(
      async ({ groupId, pageId }) => {
        await game.journal.get(groupId).pages.get(pageId).update({
          "system.images": [
            { id: foundry.utils.randomID(), src: "icons/svg/book.svg", caption: "One" },
            { id: foundry.utils.randomID(), src: "icons/svg/chest.svg", caption: "Two" }
          ]
        });
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    playerCtx = await browser.newContext();
    playerPage = await playerCtx.newPage();
    await login(playerPage, "User 1");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(gmPage, "E2E Present");
    await playerCtx.close();
    await gmPage.close();
  });

  const playerOverlay = () => playerPage.locator("#campaign-record-overlay");

  test("present, sync, local dismiss, re-present, end for all", async () => {
    await gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = gmPage.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[data-action="showImage"]').first().waitFor({ timeout: 15_000 });
    await sheet.locator('[data-action="showImage"]').first().click();

    await playerOverlay().locator("img").waitFor({ timeout: 15_000 });
    expect(await playerOverlay().locator("img").getAttribute("src")).toContain("book.svg");

    // presenter steps forward from the GM overlay controls
    await gmPage.locator('#campaign-record-overlay [data-action="stepImage"][data-dir="1"]').click();
    await expect.poll(() => playerOverlay().locator("img").getAttribute("src")).toContain("chest.svg");

    // player dismiss is local: GM keeps presenting
    await playerOverlay().locator('[data-action="dismissOverlay"]').click();
    await expect(playerOverlay()).toHaveCount(0);
    await expect(gmPage.locator("#campaign-record-overlay img")).toBeVisible();

    // GM ends for all, then re-presents: player gets the overlay again
    await gmPage.locator('#campaign-record-overlay [data-action="endPresentation"]').click();
    await expect(gmPage.locator("#campaign-record-overlay")).toHaveCount(0, { timeout: 15_000 });
    await sheet.locator('[data-action="showImage"]').first().click();
    await playerOverlay().locator("img").waitFor({ timeout: 15_000 });

    // sheet-level End works when the GM overlay was dismissed locally
    await gmPage.locator('#campaign-record-overlay [data-action="dismissOverlay"]').click();
    await sheet.locator('[data-action="endPresentation"]').click();
    await expect(playerOverlay()).toHaveCount(0, { timeout: 15_000 });
  });

  test("hidden media cannot be presented", async () => {
    await gmPage.evaluate(
      async ({ groupId, pageId }) => {
        const { setRecordHidden } = await import("/modules/campaign-record/scripts/data/groups.mjs");
        await setRecordHidden(game.journal.get(groupId).pages.get(pageId), true);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = gmPage.locator(".campaign-record.record-sheet").last();
    const warns = await gmPage.evaluate(() => {
      let count = 0;
      const original = ui.notifications.warn;
      ui.notifications.warn = (...args) => { count++; return original.apply(ui.notifications, args); };
      setTimeout(() => (ui.notifications.warn = original), 2000);
      return new Promise((resolve) => setTimeout(() => resolve(count), 0));
    });
    await sheet.locator('[data-action="showImage"]').first().click();
    await expect.poll(() =>
      gmPage.evaluate(() => document.querySelectorAll(".notification.warning").length)
    ).toBeGreaterThan(0);
    await settle(playerPage);
    await expect(playerOverlay()).toHaveCount(0);
  });
});
```

(The warn assertion may be simplified to polling `.notification.warning` DOM count as shown — drop the unused `warns` instrumentation if so.)

- [ ] **Step 5: Run gates**

```bash
npx playwright test tests/e2e/16-presenter.spec.mjs
npx playwright test
npm test
```

Expected: 16-presenter 3 passed; full e2e 46 (44 + 2); unit 31.

- [ ] **Step 6: Commit**

```bash
git add scripts/sheets/media-sheet.mjs templates/media tests/e2e/16-presenter.spec.mjs
git commit -m "feat: GM present controls on the media sheet with hidden-media guard"
```

---

### Task 5: dnd5e integration layer

`scripts/integrations/dnd5e.mjs` with feature-detected helpers; Shop drops autofill price, Item-record drops autofill rarity/type (only when empty), PC/NPC sheets show linked-actor portrait + AC/HP. World-b runs dnd5e, so this is live-testable.

**Files:**
- Create: `scripts/integrations/dnd5e.mjs`, `templates/partials/actor-info.hbs`
- Modify: `scripts/sheets/shop-sheet.mjs`, `scripts/sheets/item-record-sheet.mjs`, `scripts/sheets/npc-sheet.mjs`, `scripts/sheets/pc-sheet.mjs`, `scripts/sheets/registration.mjs` (register partial), `templates/npc/edit.hbs`, `templates/npc/view.hbs`, `templates/pc/edit.hbs`, `templates/pc/view.hbs`, `lang/en.json`, `styles/campaign-record.css`
- Test: `tests/e2e/17-dnd5e.spec.mjs`

**Interfaces:**
- Produces:
  - `isDnd5e()` → boolean (`game.system.id === "dnd5e"`).
  - `itemDropDetails(item)` → `{ priceText, rarity, itemTypeLabel }` or `null` off-5e/for null items. `priceText` e.g. `"15 gp"`.
  - `actorSummary(actor)` → `{ name, img, ac?, hp? }` or `null`; `ac`/`hp` only on 5e.

- [ ] **Step 1: `scripts/integrations/dnd5e.mjs`**

```js
/** dnd5e-only enrichment; every helper degrades to null / plain fields elsewhere. */
export function isDnd5e() {
  return game.system?.id === "dnd5e";
}

/** Price/rarity/type for an Item dropped onto Shop/Item records. */
export function itemDropDetails(item) {
  if (!isDnd5e() || !item?.system) return null;
  const price = item.system.price;
  const priceText = price?.value ? `${price.value} ${price.denomination ?? "gp"}` : "";
  const rarityKey = item.system.rarity ?? "";
  const rarity = rarityKey ? (CONFIG.DND5E?.itemRarity?.[rarityKey] ?? rarityKey) : "";
  const itemTypeLabel = game.i18n.localize(`TYPES.Item.${item.type}`);
  return { priceText, rarity, itemTypeLabel };
}

/** Portrait + basic stats for a linked actor; name/img only off-5e. */
export function actorSummary(actor) {
  if (!actor) return null;
  const info = { name: actor.name, img: actor.img };
  if (isDnd5e()) {
    const attrs = actor.system?.attributes;
    if (attrs?.ac?.value != null) info.ac = attrs.ac.value;
    if (attrs?.hp) info.hp = `${attrs.hp.value ?? 0}/${attrs.hp.max ?? 0}`;
  }
  return info;
}
```

- [ ] **Step 2: Shop drop autofills price (`scripts/sheets/shop-sheet.mjs`)**

```js
import { itemDropDetails } from "../integrations/dnd5e.mjs";
```

```js
  async _onDropDocument(data) {
    if (data.type !== "Item") return;
    const item = await fromUuid(data.uuid);
    const details = itemDropDetails(item);
    await this.updateRows("inventory", (rows) =>
      rows.push({
        id: foundry.utils.randomID(),
        name: item?.name ?? "",
        price: details?.priceText ?? "",
        quantity: 1,
        item: data.uuid
      })
    );
  }
```

- [ ] **Step 3: Item record drop autofills rarity/type when empty (`scripts/sheets/item-record-sheet.mjs`)**

```js
import { itemDropDetails } from "../integrations/dnd5e.mjs";
```

```js
  async _onDropDocument(data) {
    if (data.type !== "Item") return;
    const update = { "system.item": data.uuid };
    const details = itemDropDetails(await fromUuid(data.uuid));
    if (details?.rarity && !this.document.system.rarity) update["system.rarity"] = details.rarity;
    if (details?.itemTypeLabel && !this.document.system.itemType) {
      update["system.itemType"] = details.itemTypeLabel;
    }
    await this.document.update(update);
  }
```

- [ ] **Step 4: Actor info on NPC/PC sheets**

`templates/partials/actor-info.hbs`:

```hbs
{{#if actorInfo}}
<figure class="actor-info">
  <img src="{{actorInfo.img}}" alt="{{actorInfo.name}}">
  <figcaption>
    <span class="actor-name">{{actorInfo.name}}</span>
    {{#if actorInfo.ac}}<span>{{localize "CAMPAIGNRECORD.ActorInfo.AC"}} {{actorInfo.ac}}</span>{{/if}}
    {{#if actorInfo.hp}}<span>{{localize "CAMPAIGNRECORD.ActorInfo.HP"}} {{actorInfo.hp}}</span>{{/if}}
  </figcaption>
</figure>
{{/if}}
```

Register it in `scripts/sheets/registration.mjs` `registerPartials`:

```js
    "campaign-record.actor-info": "modules/campaign-record/templates/partials/actor-info.hbs"
```

In `scripts/sheets/npc-sheet.mjs` and `scripts/sheets/pc-sheet.mjs`, extend `_prepareContext` (both files):

```js
import { actorSummary } from "../integrations/dnd5e.mjs";
```

```js
    context.actorInfo = this.document.system.actor
      ? actorSummary(await fromUuid(this.document.system.actor))
      : null;
```

In `templates/npc/edit.hbs` and `templates/pc/edit.hbs`, inside the actor drop `form-group` after the link/hint:

```hbs
  {{> campaign-record.actor-info}}
```

In `templates/npc/view.hbs` and `templates/pc/view.hbs`, immediately after `</dl>`:

```hbs
{{> campaign-record.actor-info}}
```

`lang/en.json` — under `CAMPAIGNRECORD`:

```json
    "ActorInfo": { "AC": "AC", "HP": "HP" },
```

`styles/campaign-record.css` — append:

```css
/* --- linked-actor summary --- */
.campaign-record .actor-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.25rem 0;
}

.campaign-record .actor-info img {
  width: 3rem;
  height: 3rem;
  object-fit: cover;
}

.campaign-record .actor-info figcaption {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
}

.campaign-record .actor-info .actor-name {
  font-weight: bold;
}
```

- [ ] **Step 5: E2E spec `tests/e2e/17-dnd5e.spec.mjs`**

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("dnd5e integration (world-b is dnd5e)", () => {
  let page, ids;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
    ids = await createGroupWithPage(page, "E2E 5e Group", "E2E 5e Shop", "campaign-record.shop");
  });

  test.afterAll(async () => {
    await page.evaluate(async () => {
      for (const name of ["E2E 5e Sword", "E2E 5e Guard"]) {
        await game.items.getName(name)?.delete();
        await game.actors.getName(name)?.delete();
      }
    });
    await deleteGroupsByPrefix(page, "E2E 5e");
    await page.close();
  });

  test("item drop fills shop price and item-record rarity/type", async () => {
    const itemUuid = await page.evaluate(async () => {
      const item = await Item.create({
        name: "E2E 5e Sword",
        type: "weapon",
        system: { price: { value: 15, denomination: "gp" }, rarity: "rare" }
      });
      return item.uuid;
    });

    // shop inventory autofill
    await page.evaluate(
      async ({ groupId, pageId, itemUuid }) => {
        const sheet = game.journal.get(groupId).pages.get(pageId).sheet;
        await sheet.render(true);
        await sheet._onDropDocument({ type: "Item", uuid: itemUuid });
      },
      { groupId: ids.groupId, pageId: ids.pageId, itemUuid }
    );
    await expect
      .poll(() =>
        page.evaluate(
          ({ groupId, pageId }) =>
            game.journal.get(groupId).pages.get(pageId).system.toObject().inventory[0],
          { groupId: ids.groupId, pageId: ids.pageId }
        )
      )
      .toMatchObject({ name: "E2E 5e Sword", price: "15 gp", quantity: 1 });

    // item record autofill (empty fields only)
    const rec = await page.evaluate(
      async ({ groupId, itemUuid }) => {
        const g = game.journal.get(groupId);
        const [p] = await g.createEmbeddedDocuments("JournalEntryPage", [
          { name: "E2E 5e Item Record", type: "campaign-record.item" }
        ]);
        await p.sheet.render(true);
        await p.sheet._onDropDocument({ type: "Item", uuid: itemUuid });
        return p.system.toObject();
      },
      { groupId: ids.groupId, itemUuid }
    );
    expect(rec.item).toBe(itemUuid);
    expect(rec.rarity.toLowerCase()).toContain("rare");
    expect(rec.itemType.length).toBeGreaterThan(0);
  });

  test("linked actor shows portrait and stats on the NPC sheet", async () => {
    const actorUuid = await page.evaluate(async () => {
      const actor = await Actor.create({ name: "E2E 5e Guard", type: "npc" });
      return actor.uuid;
    });
    await page.evaluate(
      async ({ groupId, actorUuid }) => {
        const g = game.journal.get(groupId);
        const [p] = await g.createEmbeddedDocuments("JournalEntryPage", [
          { name: "E2E 5e NPC", type: "campaign-record.npc" }
        ]);
        await p.sheet.render(true);
        await p.sheet._onDropDocument({ type: "Actor", uuid: actorUuid });
      },
      { groupId: ids.groupId, actorUuid }
    );
    const info = page.locator(".campaign-record.record-sheet .actor-info").last();
    await info.waitFor({ timeout: 15_000 });
    await expect(info).toContainText("E2E 5e Guard");
    await expect(info).toContainText("HP");
  });
});
```

- [ ] **Step 6: Run gates** (no module.json change — no restart needed)

```bash
npx playwright test tests/e2e/17-dnd5e.spec.mjs
npx playwright test
npm test
```

Expected: 17-dnd5e 2 passed; full e2e 48 (46 + 2); unit 31.

- [ ] **Step 7: Commit**

```bash
git add scripts/integrations/dnd5e.mjs templates/partials/actor-info.hbs scripts/sheets/shop-sheet.mjs scripts/sheets/item-record-sheet.mjs scripts/sheets/npc-sheet.mjs scripts/sheets/pc-sheet.mjs scripts/sheets/registration.mjs templates/npc templates/pc lang/en.json styles/campaign-record.css tests/e2e/17-dnd5e.spec.mjs
git commit -m "feat: dnd5e layer — item price/rarity autofill and linked-actor summary"
```

---

### Task 6: Wrap-up — docs and version 0.4.0

**Files:**
- Modify: `docs/manual-test-checklist.md`, `module.json` (version only)

**Interfaces:**
- Consumes: everything from Tasks 1–5.

- [ ] **Step 1: Update `docs/manual-test-checklist.md`**

Automated section: add entries for `16-presenter.spec.mjs` (socket relay; present/sync/dismiss/end; hidden-media guard) and `17-dnd5e.spec.mjs` (price/rarity autofill; actor summary), and note the additions to 13-loot (source-drop gate) and 14-media (reorder boundary). Manual section: add
- Run a slideshow with a non-zero auto-advance interval and confirm images advance on both clients without interaction (timer behavior is not automated).
- Present an image and confirm the overlay looks correct on a real second display (fullscreen fit, caption legibility).
- On a non-dnd5e world, confirm Shop/Item drops still link items with blank price/rarity and NPC/PC linked actors show name/portrait without AC/HP.

- [ ] **Step 2: Version bump**

`module.json`: `"version": "0.4.0"`.

- [ ] **Step 3: Full gates** (module.json changed → restart)

```bash
npm test
lsof -ti :30000 | xargs kill; sleep 2
npx playwright test
```

Expected: 31 unit; 48 e2e, all green.

- [ ] **Step 4: Commit**

```bash
git add docs/manual-test-checklist.md module.json
git commit -m "docs: phase 4 checklist updates; v0.4.0"
```

---

## Self-Review Notes

- **Spec coverage:** Media Presenter section → Tasks 3–4 (GM-only presenting, per-image "Show to players", "Start slideshow", socket message, fullscreen borderless overlay, prev/next sync, optional auto-advance, viewer dismiss, presenter end-for-all, hidden-media guard). Error Handling → payload validation no-ops on unknown/invalid messages (Task 3, unit-tested). dnd5e layer §4 → Task 5 (price/rarity pull, linked-actor portrait/stats; the "currency denominations" item was already satisfied structurally by the Phase 3 Loot schema — no further work needed; degradation off-5e is by `isDnd5e()` feature detection). Build Phasing item 4 e2e list → 16-presenter (present→overlay, next/prev sync, player dismiss, hidden guard) + 17-dnd5e (item drop populates price/rarity). Carry-forward minors → Tasks 1–2.
- **Deliberate choices:** presenter identity is carried in the payload (`presenterId`) rather than derived from socket sender metadata — payload validation is the spec's stated defense, and presenting is gated GM-side at the sheet. The socket↔overlay ESM import cycle is runtime-safe (bindings used only inside function bodies) and noted in code. Auto-advance runs a timer only on the presenter client, emitting `goto` ticks — one source of truth, and the timer is cleared on dismiss/end/close. Loot rows have no price/rarity fields, so 5e enrichment applies to Shop rows and Item records (spec intent: dropped 5e items are linked and their price/rarity pulled where such fields exist).
- **Type consistency:** payload shapes in `presenter-payload.mjs` = what `media-sheet.mjs` builds = what `socket.mjs` routes = what the 16-presenter tests emit; `itemDropDetails`/`actorSummary` names and return shapes match across `dnd5e.mjs`, both drop handlers, both `_prepareContext` extensions, and the partial's context keys.
