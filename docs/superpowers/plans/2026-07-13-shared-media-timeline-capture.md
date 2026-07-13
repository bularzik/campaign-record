# Shared-Media Timeline Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a GM shows players an image or video via Foundry's native "Show Players" control, automatically file it into a rolling "Shared media" gallery Media entry linked to the newest timepoint of the auto-capture target Campaign Record.

**Architecture:** Extend the existing `auto-capture` subsystem with a third capture source. Pure decision logic lives in `scripts/logic/auto-capture.mjs` (vitest-unit-tested, no Foundry globals). The Foundry-bound wiring — a GM-side wrap of `foundry.applications.apps.ImagePopout.shareImage` plus an ensure-gallery-for-timepoint routine — lives in `scripts/hooks/auto-capture.mjs`. The Media data model's gallery field is widened to accept video, and the gallery templates render `<video>` for video sources via a small Handlebars helper.

**Tech Stack:** Foundry VTT v13 module (ES modules, `.mjs`), ApplicationV2/Handlebars, vitest for unit tests, Playwright for e2e.

## Global Constraints

- Module id is `campaign-record`; namespaced page type ids are `campaign-record.<type>` (use `typeId("media")`, never a raw string).
- Foundry v13 APIs live under the `foundry.*` namespaces (e.g. `foundry.applications.apps.ImagePopout`, `foundry.utils.randomID`), not the deprecated globals.
- Pure logic in `scripts/logic/*.mjs` must not reference any Foundry global (`game`, `Hooks`, `foundry`, `ui`) — that is what makes it vitest-testable.
- All user-facing strings go through `game.i18n` with keys defined in `lang/en.json`; the `tests/i18n-coverage.test.js` guard fails the build if a `game.i18n.localize/format("KEY")` reference has no matching entry.
- Auto-capture writes are performed by the GM who initiated the action (single-writer); do not add a socket relay for this feature.
- Follow existing file conventions: JSDoc one-liners on exported functions, 2-space indent, double-quoted strings.

---

### Task 1: Pure decision helpers

**Files:**
- Modify: `scripts/logic/auto-capture.mjs` (append three exports)
- Test: `tests/auto-capture.test.js` (append three `describe` blocks)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `pickNewestTimepoint(timepoints)` → the timepoint object with the greatest `sort`, or `null` when the list is empty. (Distinct from the existing `pickLatestTimepoint(attachedIds, timepoints)`, which filters to *attached* ids; this one is the newest overall.)
  - `isVideoSrc(src)` → `true` when `src` is a string whose extension (ignoring `?query`/`#hash`) is a known video type, else `false`.
  - `appendGalleryImage(images, entry)` → `{ images, added }`. When `entry.src` already exists in `images`, returns the original array and `added: false`; otherwise returns a new array with `entry` appended and `added: true`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/auto-capture.test.js`. First extend the import on line 2 to include the new names:

```js
import { resolveTargetGroup, collapseParticipants, mergeParticipants, matchPlaceForScene, pickLatestTimepoint, summarizeOutcome, pickNewestTimepoint, isVideoSrc, appendGalleryImage } from "../scripts/logic/auto-capture.mjs";
```

Then append these blocks at the end of the file:

```js
describe("pickNewestTimepoint", () => {
  it("returns the timepoint with the greatest sort", () => {
    const tps = [{ id: "a", sort: 100 }, { id: "c", sort: 300 }, { id: "b", sort: 200 }];
    expect(pickNewestTimepoint(tps)).toEqual({ id: "c", sort: 300 });
  });
  it("returns null for an empty list", () => {
    expect(pickNewestTimepoint([])).toBe(null);
  });
});

describe("isVideoSrc", () => {
  it("recognizes common video extensions case-insensitively", () => {
    expect(isVideoSrc("path/to/clip.webm")).toBe(true);
    expect(isVideoSrc("HANDOUT.MP4")).toBe(true);
    expect(isVideoSrc("worlds/x/scene.m4v?123")).toBe(true);
  });
  it("returns false for images and non-strings", () => {
    expect(isVideoSrc("art/map.webp")).toBe(false);
    expect(isVideoSrc("no-extension")).toBe(false);
    expect(isVideoSrc(null)).toBe(false);
  });
});

describe("appendGalleryImage", () => {
  it("appends a new entry and reports added", () => {
    const { images, added } = appendGalleryImage([{ id: "1", src: "a.webp" }], { id: "2", src: "b.mp4" });
    expect(added).toBe(true);
    expect(images).toEqual([{ id: "1", src: "a.webp" }, { id: "2", src: "b.mp4" }]);
  });
  it("dedups by src and reports not added", () => {
    const existing = [{ id: "1", src: "a.webp" }];
    const { images, added } = appendGalleryImage(existing, { id: "9", src: "a.webp" });
    expect(added).toBe(false);
    expect(images).toBe(existing);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/auto-capture.test.js`
Expected: FAIL — `pickNewestTimepoint is not a function` (and the other two new names undefined).

- [ ] **Step 3: Implement the helpers**

Append to `scripts/logic/auto-capture.mjs`:

```js
/** The timepoint with the greatest sort, or null when there are none. */
export function pickNewestTimepoint(timepoints) {
  let best = null;
  for (const tp of timepoints) if (best === null || tp.sort > best.sort) best = tp;
  return best;
}

const VIDEO_EXTENSIONS = ["webm", "mp4", "m4v", "ogv", "mov"];

/** True when a source path is a video by file extension (case-insensitive). */
export function isVideoSrc(src) {
  if (typeof src !== "string") return false;
  const clean = src.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  if (dot < 0) return false;
  return VIDEO_EXTENSIONS.includes(clean.slice(dot + 1).toLowerCase());
}

/**
 * Append an image to a gallery, deduped by src. Returns { images, added };
 * added is false (and images unchanged) when src is already present.
 */
export function appendGalleryImage(images, entry) {
  if (images.some((i) => i.src === entry.src)) return { images, added: false };
  return { images: [...images, entry], added: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/auto-capture.test.js`
Expected: PASS (all existing plus the three new blocks).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/auto-capture.mjs tests/auto-capture.test.js
git commit -m "feat: pure helpers for shared-media capture (newest timepoint, video detection, gallery dedup)"
```

---

### Task 2: Constants and the capture toggle setting

**Files:**
- Modify: `scripts/constants.mjs` (add two exports)
- Modify: `scripts/settings/auto-target.mjs` (register the world setting inside `registerAutoTargetSetting`)
- Modify: `lang/en.json` (add the `Settings.AutoCaptureSharedMedia` node)

**Interfaces:**
- Consumes: `MODULE_ID` (constants).
- Produces:
  - `MEDIA_CAPTURE_SETTING` (string `"autoCaptureSharedMedia"`) — world boolean, default `true`.
  - `AUTO_MEDIA_FLAG` (string `"autoMediaTimepoint"`) — Media-page flag key holding the timepoint id its gallery belongs to.

- [ ] **Step 1: Add constants**

Append to `scripts/constants.mjs` (after the existing `DEPARTED_FLAG` export):

```js
/** World setting: auto-file media the GM shows players onto the newest timepoint. */
export const MEDIA_CAPTURE_SETTING = "autoCaptureSharedMedia";

/** Media page flag: the timepoint id whose auto-created gallery this page is. */
export const AUTO_MEDIA_FLAG = "autoMediaTimepoint";
```

- [ ] **Step 2: Register the setting**

In `scripts/settings/auto-target.mjs`, update the import on line 1 to add `MEDIA_CAPTURE_SETTING`:

```js
import { MODULE_ID, AUTO_TARGET_SETTING, AUTO_TARGET_ACTION, MEDIA_CAPTURE_SETTING } from "../constants.mjs";
```

Then inside `registerAutoTargetSetting()`, after the existing `game.settings.register(MODULE_ID, AUTO_TARGET_SETTING, {...})` call, add:

```js
  game.settings.register(MODULE_ID, MEDIA_CAPTURE_SETTING, {
    name: "CAMPAIGNRECORD.Settings.AutoCaptureSharedMedia.Name",
    hint: "CAMPAIGNRECORD.Settings.AutoCaptureSharedMedia.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
```

- [ ] **Step 3: Add the i18n strings**

In `lang/en.json`, under `CAMPAIGNRECORD.Settings` (which currently holds `InlineEditing`), add a sibling node:

```json
"AutoCaptureSharedMedia": {
  "Name": "Auto-capture shared media",
  "Hint": "When a GM shows players an image or video (via Foundry's Show Players control), file it into a Shared media entry on the newest timeline point of the auto-capture target Campaign Record."
}
```

- [ ] **Step 4: Verify the build stays green**

Run: `npx vitest run tests/i18n-coverage.test.js`
Expected: PASS (referenced keys still all resolve; the new keys are valid JSON).

Also confirm the JSON parses:

Run: `node -e "JSON.parse(require('fs').readFileSync('lang/en.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add scripts/constants.mjs scripts/settings/auto-target.mjs lang/en.json
git commit -m "feat: add auto-capture-shared-media world setting and capture constants"
```

---

### Task 3: Accept video in the gallery (schema + templates)

**Files:**
- Modify: `scripts/data/media.mjs:14` (widen the `src` FilePathField categories)
- Modify: `scripts/sheets/registration.mjs` (register a `crIsVideo` Handlebars helper)
- Modify: `templates/partials/media-images.hbs` (edit-mode thumbnail)
- Modify: `templates/media/view.hbs` (read-only gallery)

**Interfaces:**
- Consumes: `isVideoSrc` from `scripts/logic/auto-capture.mjs` (Task 1).
- Produces: a Handlebars helper `crIsVideo` usable in templates as `{{#if (crIsVideo this.src)}}`.

- [ ] **Step 1: Widen the Media gallery field to accept video**

In `scripts/data/media.mjs`, change the gallery `src` field (line 14):

```js
          src: new FilePathField({ categories: ["IMAGE", "VIDEO"] }),
```

This is backward-compatible: existing image paths remain valid, so no migration is needed.

- [ ] **Step 2: Register the `crIsVideo` Handlebars helper**

In `scripts/sheets/registration.mjs`, add an import at the top (after the existing imports):

```js
import { isVideoSrc } from "../logic/auto-capture.mjs";
```

Then, inside `registerPartials()`, before the `return foundry.applications.handlebars.loadTemplates({...})` line, register the helper:

```js
  Handlebars.registerHelper("crIsVideo", (src) => isVideoSrc(src));
```

(`registerPartials` is called during `init` from `scripts/campaign-record.mjs`, so the helper is available before any sheet renders.)

- [ ] **Step 3: Render video in the edit-mode thumbnail**

In `templates/partials/media-images.hbs`, replace the single `<img>` line inside the `{{#each system.images}}` loop:

```hbs
      <img src="{{this.src}}" alt="{{this.caption}}">
```

with:

```hbs
      {{#if (crIsVideo this.src)}}
      <video src="{{this.src}}" muted></video>
      {{else}}
      <img src="{{this.src}}" alt="{{this.caption}}">
      {{/if}}
```

- [ ] **Step 4: Render video in the read-only gallery**

In `templates/media/view.hbs`, replace the `<img>` line inside the `.media-gallery` `{{#each system.images}}` loop:

```hbs
    <img src="{{this.src}}" alt="{{this.caption}}">
```

with:

```hbs
    {{#if (crIsVideo this.src)}}
    <video src="{{this.src}}" controls muted></video>
    {{else}}
    <img src="{{this.src}}" alt="{{this.caption}}">
    {{/if}}
```

- [ ] **Step 5: Verify the unit suite still passes**

Run: `npx vitest run`
Expected: PASS (no logic regressions; `isVideoSrc` already covered in Task 1).

- [ ] **Step 6: Commit**

```bash
git add scripts/data/media.mjs scripts/sheets/registration.mjs templates/partials/media-images.hbs templates/media/view.hbs
git commit -m "feat: accept and render video in the Media gallery"
```

---

### Task 4: Capture routine and the shareImage wrap

**Files:**
- Modify: `scripts/hooks/auto-capture.mjs` (imports, `captureSharedMedia`, `findAutoGallery`, and the wrap registration inside `registerAutoCapture`)
- Modify: `lang/en.json` (add `CAMPAIGNRECORD.AutoCapture.SharedMediaName`)

**Interfaces:**
- Consumes (from Task 1): `pickNewestTimepoint`, `appendGalleryImage`. From existing modules: `getTargetGroup` (settings/auto-target), `getTimepoints`, `addTimepoint`, `addLink` (data/timepoints), `typeId`, `MODULE_ID` (constants), plus new constants `AUTO_MEDIA_FLAG`, `MEDIA_CAPTURE_SETTING` (Task 2).
- Produces: `captureSharedMedia(src, caption)` — async; no-op when the setting is off, there is no target group, or `src` is falsy; otherwise files the media into the newest timepoint's gallery (creating the timepoint and/or gallery as needed).

- [ ] **Step 1: Add the i18n string for the gallery entry name**

In `lang/en.json`, under `CAMPAIGNRECORD.AutoCapture` (which holds `EncounterName`, etc.), add:

```json
"SharedMediaName": "Shared media — {label}"
```

- [ ] **Step 2: Extend the imports in the hook module**

In `scripts/hooks/auto-capture.mjs`, update the two relevant imports. Change the constants import line to add the new keys:

```js
import { MODULE_ID, typeId, ENCOUNTER_FLAG, DEPARTED_FLAG, AUTO_MEDIA_FLAG, MEDIA_CAPTURE_SETTING } from "../constants.mjs";
```

And change the logic import line to add `pickNewestTimepoint` and `appendGalleryImage`:

```js
import { matchPlaceForScene, pickLatestTimepoint, pickNewestTimepoint, collapseParticipants, mergeParticipants, summarizeOutcome, appendGalleryImage } from "../logic/auto-capture.mjs";
```

No other import changes are needed: `getTargetGroup`, `addTimepoint`, `addLink`, `getTimepoints`, and `typeId` are already imported at the top of this file (verified — line 2 imports `{ setTargetGroup, getTargetGroup }`, line 4 imports the timepoint helpers).

- [ ] **Step 3: Add the capture routine and gallery lookup**

Add near the top-level helpers of `scripts/hooks/auto-capture.mjs` (e.g. after `const PLACE_TYPE = typeId("place");`), a media-type constant and the routine:

```js
const MEDIA_TYPE = typeId("media");

/** The auto-created gallery page for a timepoint in this group, or null. */
function findAutoGallery(group, timepointId) {
  return group.pages.find(
    (p) => p.type === MEDIA_TYPE && p.getFlag(MODULE_ID, AUTO_MEDIA_FLAG) === timepointId
  ) ?? null;
}

/**
 * File a GM-shared image/video into the target group's newest-timepoint
 * gallery. Creates a first timepoint on an empty timeline, and creates the
 * gallery (with a single timeline link) the first time media lands on a
 * timepoint; later shares append to that gallery, deduped by src.
 */
export async function captureSharedMedia(src, caption) {
  if (!src) return;
  if (!game.settings.get(MODULE_ID, MEDIA_CAPTURE_SETTING)) return;
  const group = getTargetGroup();
  if (!group) return;

  let tp = pickNewestTimepoint(getTimepoints(group));
  if (!tp) tp = await addTimepoint(group, new Date().toLocaleDateString());

  const entry = { id: foundry.utils.randomID(), src, caption: caption ?? "" };
  const gallery = findAutoGallery(group, tp.id);
  if (gallery) {
    const { images, added } = appendGalleryImage(gallery.system.toObject().images, entry);
    if (added) await gallery.update({ "system.images": images });
    return;
  }

  const name = game.i18n.format("CAMPAIGNRECORD.AutoCapture.SharedMediaName", { label: tp.label });
  const [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
    {
      name,
      type: MEDIA_TYPE,
      system: { images: [entry] },
      flags: { [MODULE_ID]: { [AUTO_MEDIA_FLAG]: tp.id } }
    }
  ]);
  await addLink(group, tp.id, { uuid: page.uuid, name: page.name, type: "JournalEntryPage" });
}
```

- [ ] **Step 4: Register the shareImage wrap**

Inside `registerAutoCapture()` in `scripts/hooks/auto-capture.mjs`, add at the end of the function body (after the `deleteCombat` hook):

```js
  // GM shows players an image/video via Foundry's native "Show Players" →
  // file it onto the newest timepoint. shareImage fires no hook and the
  // socket emit doesn't echo to the sender, so wrap the static method; the
  // sharing GM captures on their own client (single-writer, no relay).
  const ImagePopout = foundry.applications.apps.ImagePopout;
  const originalShareImage = ImagePopout.shareImage;
  ImagePopout.shareImage = function (options = {}) {
    const result = originalShareImage.call(this, options);
    if (game.user.isGM) {
      const src = options.image ?? options.src;
      const caption = options.title ?? options.caption ?? "";
      captureSharedMedia(src, caption).catch((err) =>
        console.error("campaign-record | shared-media capture failed", err)
      );
    }
    return result;
  };
```

- [ ] **Step 5: Verify the API assumption against live Foundry**

`registerAutoCapture` runs during `ready`. Before relying on the option keys, confirm the v13 signature: in the Foundry console run `foundry.applications.apps.ImagePopout.shareImage.toString()` and check the option property names. The code above reads `options.image`/`options.src` and `options.title`/`options.caption` defensively, but if v13 uses a different key (e.g. a positional argument), adjust the `src`/`caption` extraction accordingly. This is a read-only confirmation — no code change unless the keys differ.

- [ ] **Step 6: Run the unit + i18n suites**

Run: `npx vitest run`
Expected: PASS (the new `game.i18n.format("CAMPAIGNRECORD.AutoCapture.SharedMediaName")` reference now resolves in `lang/en.json`, keeping `i18n-coverage` green).

- [ ] **Step 7: Commit**

```bash
git add scripts/hooks/auto-capture.mjs lang/en.json
git commit -m "feat: capture GM-shared media onto the newest timepoint via ImagePopout.shareImage wrap"
```

---

### Task 5: End-to-end coverage

**Files:**
- Create: `tests/e2e/26-shared-media-capture.spec.mjs`

**Interfaces:**
- Consumes: the e2e helpers `login`, `deleteGroupsByPrefix` from `tests/e2e/helpers/foundry.mjs`; the module scripts `data/groups.mjs` (`createGroup`), `data/timepoints.mjs` (`addTimepoint`, `getTimepoints`, `timepointsForRecord`) via dynamic import inside `page.evaluate`.
- Produces: a Playwright spec asserting the capture routine's world-side effects.

> **Before running any e2e:** read and follow the `foundry-e2e` skill/contract (session locking, module symlink ownership, unlock). Do not start the Foundry server or run Playwright without it.

- [ ] **Step 1: Write the e2e spec**

Create `tests/e2e/26-shared-media-capture.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

// Drives Foundry's native image share (ImagePopout.shareImage) as GM and
// asserts the shared media lands in a "Shared media" gallery linked to the
// newest timepoint of the auto-capture target group.
const P = "E2E ShareMedia";

test.describe("shared-media capture", () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
  });

  test.afterAll(async () => {
    await page.evaluate(async () => {
      await game.settings.set("campaign-record", "autoCaptureTargetGroup", "");
    });
    await deleteGroupsByPrefix(page, P);
    await page.close();
  });

  test("shares roll into one gallery per newest timepoint; a new timepoint starts a fresh gallery", async () => {
    // --- setup: target group with one timepoint ---
    const ids = await page.evaluate(async (P) => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const { addTimepoint } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = await createGroup(`${P} Target`);
      await game.settings.set("campaign-record", "autoCaptureTargetGroup", group.id);
      const tp1 = await addTimepoint(group, `${P} TP1`);
      return { groupId: group.id, tp1: tp1.id };
    }, P);

    // --- share two images -> one gallery, two deduped-distinct images ---
    await page.evaluate(async () => {
      await foundry.applications.apps.ImagePopout.shareImage({ image: "icons/svg/mystery-man.svg", title: "Handout A" });
      await foundry.applications.apps.ImagePopout.shareImage({ image: "icons/svg/cowled.svg", title: "Handout B" });
      // re-share A: should dedup, not add a third image
      await foundry.applications.apps.ImagePopout.shareImage({ image: "icons/svg/mystery-man.svg", title: "Handout A again" });
    });

    await expect.poll(
      () => page.evaluate(({ groupId, tp1 }) => {
        const g = game.journal.get(groupId);
        const gallery = g.pages.find(
          (p) => p.type === "campaign-record.media" && p.getFlag("campaign-record", "autoMediaTimepoint") === tp1
        );
        return gallery ? gallery.system.images.length : 0;
      }, ids),
      { timeout: 15_000 }
    ).toBe(2);

    // the gallery is linked to tp1
    const linkedToTp1 = await page.evaluate(async ({ groupId, tp1 }) => {
      const { timepointsForRecord } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const g = game.journal.get(groupId);
      const gallery = g.pages.find(
        (p) => p.type === "campaign-record.media" && p.getFlag("campaign-record", "autoMediaTimepoint") === tp1
      );
      return timepointsForRecord(g, gallery.uuid).includes(tp1);
    }, ids);
    expect(linkedToTp1).toBe(true);

    // --- add a newer timepoint, share again -> a second, distinct gallery ---
    const tp2 = await page.evaluate(async ({ groupId }) => {
      const { addTimepoint } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const g = game.journal.get(groupId);
      const tp = await addTimepoint(g, "E2E ShareMedia TP2");
      await foundry.applications.apps.ImagePopout.shareImage({ image: "icons/svg/sun.svg", title: "Handout C" });
      return tp.id;
    }, ids);

    await expect.poll(
      () => page.evaluate(({ groupId, tp2 }) => {
        const g = game.journal.get(groupId);
        const galleries = g.pages.filter((p) => p.type === "campaign-record.media");
        const newer = galleries.find((p) => p.getFlag("campaign-record", "autoMediaTimepoint") === tp2);
        return galleries.length === 2 && !!newer && newer.system.images.length === 1;
      }, { groupId: ids.groupId, tp2 }),
      { timeout: 15_000 }
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run the e2e spec (following the foundry-e2e contract)**

Acquire the e2e session lock and symlink ownership per the `foundry-e2e` skill, then run:

Run: `npx playwright test tests/e2e/26-shared-media-capture.spec.mjs`
Expected: PASS — one gallery with 2 images linked to TP1 (dedup held), and a second gallery with 1 image on TP2.

Release the lock afterward per the contract. If `shareImage`'s option keys differed in Task 4 Step 5, mirror that adjustment in the `page.evaluate` calls here.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/26-shared-media-capture.spec.mjs
git commit -m "test: e2e for shared-media timeline capture (per-timepoint gallery, dedup, new-timepoint split)"
```

---

## Self-Review

**Spec coverage:**

- Trigger via `ImagePopout.shareImage` GM-side wrap → Task 4 Step 4.
- One rolling gallery per newest timepoint, keyed by `autoMediaTimepoint` flag → Task 4 Step 3 (`findAutoGallery` + create/append branch).
- Newest timepoint = greatest sort → Task 1 (`pickNewestTimepoint`), used in Task 4.
- Empty-timeline → auto-create a date-labeled timepoint → Task 4 Step 3 (`new Date().toLocaleDateString()`).
- Dedup by src → Task 1 (`appendGalleryImage`), asserted in Task 5.
- Player-visible Media page + document-link (no `showPlayers`) → Task 4 Step 3 uses `addLink` with a `JournalEntryPage` document link and sets no hidden/showPlayers flags.
- Images + video: schema widening → Task 3 Step 1; `<video>` rendering → Task 3 Steps 3–4; category helper → Task 1 (`isVideoSrc`) + Task 3 Step 2.
- Default-on kill-switch setting → Task 2; early-return honored in `captureSharedMedia` → Task 4 Step 3.
- Tests: unit → Task 1; e2e → Task 5.

No spec requirement is left without a task.

**Placeholder scan:** No TBD/TODO/"handle edge cases" placeholders; every code step shows complete code. The one live-verification step (Task 4 Step 5) is a deliberate read-only API confirmation, not deferred work.

**Type consistency:** `pickNewestTimepoint`, `isVideoSrc`, `appendGalleryImage`, `captureSharedMedia`, `findAutoGallery`, `crIsVideo`, `AUTO_MEDIA_FLAG`, `MEDIA_CAPTURE_SETTING` are named identically everywhere they appear across Tasks 1–5. The gallery flag value is the timepoint id in both the writer (Task 4) and both readers (Task 4 lookup, Task 5 assertions). `appendGalleryImage` returns `{ images, added }` in its definition (Task 1) and is destructured that way at its call site (Task 4).
