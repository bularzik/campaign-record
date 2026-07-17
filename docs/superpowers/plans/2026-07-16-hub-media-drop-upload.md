# Hub Media Drag-and-Drop Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dragging an image/video file from the OS onto the Campaign Hub uploads it to the Foundry server and attaches it to the open media entry, a specific timepoint (when dropped on its row), or the newest-timepoint shared auto-gallery.

**Architecture:** Extend the hub's existing `DragDrop` pipeline (widen the drop selector to the whole window, dispatch inside one handler), extend `classifyDropData` with a `files` payload kind, add a pure routing module, a `FilePicker.upload` helper, and reuse the shared-media auto-capture primitives (`fileMediaToTimepoint`, extracted in Task 2) for gallery filing. Non-GM gallery filings relay to the active GM over the module socket (same pattern as `AUTO_TARGET_ACTION`).

**Tech Stack:** Foundry VTT v13 module (vanilla ESM, ApplicationV2 + HandlebarsApplicationMixin), vitest for pure logic, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-07-16-hub-media-drop-upload-design.md`

## Global Constraints

- Pure decision logic lives in `scripts/logic/*.mjs` with **no Foundry globals** — that's what vitest can test. Foundry-global code is exercised by e2e only.
- Working directory is the worktree root: `/Users/danbularzik/Claude/Projects/campaign-record/campaign-record/.claude/worktrees/hub-media-drop-upload`. All paths below are relative to it.
- Run unit tests with `npx vitest run` (whole suite is fast; always run the whole suite before committing — `tests/i18n-coverage.test.js` checks that every `CAMPAIGNRECORD.*` key used in code exists in `lang/en.json`, so i18n keys and their usages must land in the same commit).
- Commit messages use conventional-commit style (`feat: …`, `test: …`, `refactor: …`) and end with the line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Do NOT run Playwright e2e tests without first invoking the project's `foundry-e2e` skill** (session locking rules for the shared Foundry install). Unit tests have no such restriction.
- Every DOM listener added in `_onRender` must be guarded with a `dataset.crXxxBound = "1"` flag (hub re-renders re-invoke `_onRender`; unguarded listeners double-fire).
- One deliberate refinement vs. the spec text: a **video** file dropped on a timepoint row files into that timepoint's auto-gallery instead of becoming an image link — timeline image-link chips render `<img src>` thumbnails (`displayLink` in `scripts/logic/timeline-links.mjs`), which are broken for video, and today video paths dropped on rows are rejected outright. Images dropped on rows become image links exactly as specced.

---

### Task 1: Pure logic — file classification and drop routing

**Files:**
- Modify: `scripts/logic/timeline-links.mjs` (extend `classifyDropData`, ~line 60)
- Create: `scripts/logic/media-drop.mjs`
- Test: `tests/media-drop.test.js` (new), `tests/timeline-links.test.js` (extend)

**Interfaces:**
- Consumes: `isImagePath(src)` from `timeline-links.mjs`; `isVideoSrc(src)` from `scripts/logic/auto-capture.mjs`; `typeId(type)` from `scripts/constants.mjs` (all pure).
- Produces (used by Task 5):
  - `classifyDropData(data, uriList = "", files = [])` → existing returns unchanged, plus `{ kind: "files", accepted: File[], rejected: string[] }` whenever `files.length > 0` (accepted filtered to supported image/video filenames; rejected = the other files' names).
  - `uploadFilename(name, now)` → `"<now>-<sanitized-name>"` (string).
  - `resolveDropTarget({ timepointId, viewedPage, canModifyPage })` → `{kind:"timepoint", id}` | `{kind:"media-entry", uuid}` | `{kind:"auto-gallery"}`. `viewedPage` only needs `.type` and `.uuid` properties.

- [ ] **Step 1: Write the failing tests**

Create `tests/media-drop.test.js`:

```js
import { describe, it, expect } from "vitest";
import { isMediaFilename, uploadFilename, resolveDropTarget } from "../scripts/logic/media-drop.mjs";

describe("isMediaFilename", () => {
  it("accepts images and videos by extension, case-insensitively", () => {
    expect(isMediaFilename("map.png")).toBe(true);
    expect(isMediaFilename("Handout.JPG")).toBe(true);
    expect(isMediaFilename("intro.webm")).toBe(true);
    expect(isMediaFilename("cutscene.MP4")).toBe(true);
  });
  it("rejects non-media and extensionless names", () => {
    expect(isMediaFilename("notes.pdf")).toBe(false);
    expect(isMediaFilename("track.mp3")).toBe(false);
    expect(isMediaFilename("README")).toBe(false);
    expect(isMediaFilename("")).toBe(false);
  });
});

describe("uploadFilename", () => {
  it("prefixes the timestamp and keeps a clean name", () => {
    expect(uploadFilename("map.png", 1700000000000)).toBe("1700000000000-map.png");
  });
  it("sanitizes spaces and special characters to dashes", () => {
    expect(uploadFilename("my cool map (v2).png", 5)).toBe("5-my-cool-map-v2-.png");
  });
  it("never returns an empty basename", () => {
    expect(uploadFilename("---", 5)).toBe("5-media");
  });
});

describe("resolveDropTarget", () => {
  const media = { type: "campaign-record.media", uuid: "U.media" };
  const npc = { type: "campaign-record.npc", uuid: "U.npc" };

  it("an explicit timepoint row wins over everything", () => {
    expect(resolveDropTarget({ timepointId: "tp1", viewedPage: media, canModifyPage: true }))
      .toEqual({ kind: "timepoint", id: "tp1" });
  });
  it("an open modifiable media entry wins over the gallery", () => {
    expect(resolveDropTarget({ timepointId: null, viewedPage: media, canModifyPage: true }))
      .toEqual({ kind: "media-entry", uuid: "U.media" });
  });
  it("falls back to the auto-gallery for non-media pages, unmodifiable pages, and no page", () => {
    expect(resolveDropTarget({ timepointId: null, viewedPage: npc, canModifyPage: true }))
      .toEqual({ kind: "auto-gallery" });
    expect(resolveDropTarget({ timepointId: null, viewedPage: media, canModifyPage: false }))
      .toEqual({ kind: "auto-gallery" });
    expect(resolveDropTarget({ timepointId: null, viewedPage: null, canModifyPage: false }))
      .toEqual({ kind: "auto-gallery" });
  });
});
```

Append to `tests/timeline-links.test.js` (inside the file, as a new top-level `describe`; keep existing imports and add `classifyDropData` to them if not already imported):

```js
describe("classifyDropData files kind", () => {
  it("classifies dropped files, splitting media from the rest", () => {
    const files = [
      { name: "map.png" }, { name: "intro.webm" }, { name: "notes.pdf" }
    ];
    const result = classifyDropData({}, "", files);
    expect(result.kind).toBe("files");
    expect(result.accepted.map((f) => f.name)).toEqual(["map.png", "intro.webm"]);
    expect(result.rejected).toEqual(["notes.pdf"]);
  });
  it("files take precedence over other payload data", () => {
    const result = classifyDropData({ type: "Actor", uuid: "Actor.x" }, "", [{ name: "a.png" }]);
    expect(result.kind).toBe("files");
  });
  it("without files, existing classification is unchanged", () => {
    expect(classifyDropData({ type: "Actor", uuid: "Actor.x" }))
      .toEqual({ kind: "document", uuid: "Actor.x", type: "Actor" });
    expect(classifyDropData({ src: "art/a.png" })).toEqual({ kind: "image", src: "art/a.png" });
    expect(classifyDropData({}, "")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/media-drop.test.js tests/timeline-links.test.js`
Expected: FAIL — `media-drop.mjs` does not exist; `classifyDropData` returns null for files.

- [ ] **Step 3: Implement**

Create `scripts/logic/media-drop.mjs`:

```js
/**
 * Pure drag-drop media routing logic. No Foundry globals — unit-tested with vitest.
 */
import { isImagePath } from "./timeline-links.mjs";
import { isVideoSrc } from "./auto-capture.mjs";
import { typeId } from "../constants.mjs";

const MEDIA_TYPE = typeId("media");

/** True when a filename/path is a supported image or video, by extension. */
export function isMediaFilename(name) {
  return isImagePath(name) || isVideoSrc(name);
}

/** Server-safe upload filename: timestamp prefix + sanitized original name. */
export function uploadFilename(name, now) {
  const safe = (name ?? "")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "");
  return `${now}-${safe || "media"}`;
}

/**
 * Decide where dropped media files land.
 * Precedence: explicit timepoint row > open modifiable media entry > shared auto-gallery.
 * `viewedPage` needs only `.type` and `.uuid`.
 */
export function resolveDropTarget({ timepointId = null, viewedPage = null, canModifyPage = false }) {
  if (timepointId) return { kind: "timepoint", id: timepointId };
  if (viewedPage?.type === MEDIA_TYPE && canModifyPage) {
    return { kind: "media-entry", uuid: viewedPage.uuid };
  }
  return { kind: "auto-gallery" };
}
```

(The test's expected values are the contract: `"5-my-cool-map-v2-.png"` keeps the dash before the extension dot — only *leading* dashes/dots are stripped.)

In `scripts/logic/timeline-links.mjs`, add the import at the top (after the existing header comment; this module stays pure — `auto-capture.mjs` logic has no Foundry globals):

```js
import { isVideoSrc } from "./auto-capture.mjs";
```

Replace the `classifyDropData` function (lines 54-69) with:

```js
/**
 * Classify a timeline drop payload into a link candidate.
 * Accepts raw OS files (dataTransfer.files — takes precedence), Foundry
 * document drag data, FilePicker/Tile file payloads (src / path /
 * texture.src), and a text/uri-list image URL fallback.
 * @returns {{kind:"files",accepted:File[],rejected:string[]}
 *   |{kind:"document",uuid:string,type:string}|{kind:"image",src:string}|null}
 */
export function classifyDropData(data, uriList = "", files = []) {
  if (files.length) {
    const accepted = [];
    const rejected = [];
    for (const f of files) {
      if (isImagePath(f.name) || isVideoSrc(f.name)) accepted.push(f);
      else rejected.push(f.name);
    }
    return { kind: "files", accepted, rejected };
  }
  if (LINKABLE_TYPES.includes(data?.type) && typeof data.uuid === "string") {
    return { kind: "document", uuid: data.uuid, type: data.type };
  }
  const src = [data?.src, data?.path, data?.texture?.src].find((s) => typeof s === "string");
  if (isImagePath(src)) return { kind: "image", src };
  const uri = uriList.split("\n")[0]?.trim();
  if (isImagePath(uri)) return { kind: "image", src: uri };
  return null;
}
```

- [ ] **Step 4: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS (all files; the new tests and every existing test).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/media-drop.mjs scripts/logic/timeline-links.mjs tests/media-drop.test.js tests/timeline-links.test.js
git commit -m "feat: pure routing + file classification for hub media drops

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Extract reusable gallery filing from shared-media capture

**Files:**
- Modify: `scripts/hooks/auto-capture.mjs:23-63` (extract `fileMediaToTimepoint`, generalize the queue)

**Interfaces:**
- Consumes: existing private `findAutoGallery`, `pickNewestTimepoint`, `appendGalleryImage`, `addTimepoint`, `addLink`, `getTimepoints` (all already imported in this file).
- Produces (used by Tasks 3 and 5):
  - `fileMediaToTimepoint(group, entry, timepointId = null)` — async; `entry` is `{id, src, caption}`; `timepointId` null → newest timepoint (creating a date-labeled one on an empty timeline). Finds-or-creates the flagged gallery and its single timeline link; appends deduped by src. Returns `{ added: boolean, gallery, timepointId }`.
  - `queueMediaTask(task)` — serializes gallery writes through the existing module-level queue (prevents duplicate-gallery races); `task` is `() => Promise`. Returns the queue promise.
- Behavior of the GM Show-Players capture is **unchanged** (guarded by e2e `26-shared-media-capture.spec.mjs`, run at the end of the project).

- [ ] **Step 1: Refactor**

In `scripts/hooks/auto-capture.mjs`, replace `doCaptureSharedMedia` (lines 17-50) and the queue block (lines 52-63) with:

```js
/**
 * File a media entry into a group's timepoint gallery. timepointId null →
 * newest timepoint (created date-labeled when the timeline is empty; an
 * unknown explicit id is a no-op). Creates the gallery page (flagged with
 * the timepoint id) and its single timeline link on first use; later
 * filings append, deduped by src.
 * @param {JournalEntry} group
 * @param {{id:string,src:string,caption:string}} entry
 * @param {string|null} timepointId
 * @returns {Promise<{added:boolean,gallery:JournalEntryPage|null,timepointId:string|null}>}
 */
export async function fileMediaToTimepoint(group, entry, timepointId = null) {
  let tp = timepointId
    ? getTimepoints(group).find((t) => t.id === timepointId)
    : pickNewestTimepoint(getTimepoints(group));
  if (!tp) {
    if (timepointId) return { added: false, gallery: null, timepointId: null };
    tp = await addTimepoint(group, new Date().toLocaleDateString());
  }

  const gallery = findAutoGallery(group, tp.id);
  if (gallery) {
    const { images, added } = appendGalleryImage(gallery.system.toObject().images, entry);
    if (added) await gallery.update({ "system.images": images });
    return { added, gallery, timepointId: tp.id };
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
  return { added: true, gallery: page, timepointId: tp.id };
}

/**
 * File a GM-shared image/video into the target group's newest-timepoint
 * gallery (Show Players capture).
 */
async function doCaptureSharedMedia(src, caption) {
  if (!src) return;
  if (!game.settings.get(MODULE_ID, MEDIA_CAPTURE_SETTING)) return;
  const group = getTargetGroup();
  if (!group) return;
  await fileMediaToTimepoint(group, { id: foundry.utils.randomID(), src, caption: caption ?? "" });
}

// Serializes gallery filings per client so rapid back-to-back writes can't
// race findAutoGallery against a still-pending gallery create for the same
// timepoint (which would otherwise produce duplicate galleries/links).
let mediaQueue = Promise.resolve();

/** Queue a gallery-filing task so it never overlaps a prior in-flight one. */
export function queueMediaTask(task) {
  mediaQueue = mediaQueue
    .then(task)
    .catch((err) => console.error("campaign-record | media filing failed", err));
  return mediaQueue;
}

/** Queue a shared-media capture so it never overlaps a prior in-flight one. */
export function captureSharedMedia(src, caption) {
  return queueMediaTask(() => doCaptureSharedMedia(src, caption));
}
```

(Everything else in the file — `findAutoGallery`, the hooks registration, etc. — stays exactly as it is.)

- [ ] **Step 2: Verify no regressions**

Run: `npx vitest run`
Expected: PASS. Also run `node --input-type=module -e "import('./scripts/hooks/auto-capture.mjs').catch(e => { console.error(e.message); process.exit(1); })"` — expected: it fails only with a Foundry-global reference error (e.g. `game is not defined`) or import chain error mentioning a *data/* module, NOT a SyntaxError. (A SyntaxError means the edit broke the file.)

- [ ] **Step 3: Commit**

```bash
git add scripts/hooks/auto-capture.mjs
git commit -m "refactor: extract fileMediaToTimepoint + queueMediaTask from shared-media capture

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: GM relay socket for dropped media

**Files:**
- Modify: `scripts/constants.mjs` (add action constant after `AUTO_TARGET_ACTION`, line 67)
- Modify: `scripts/hooks/auto-capture.mjs` (add relay emit + socket listener)
- Modify: `scripts/campaign-record.mjs` (register the listener in `ready`, next to line 34-35)

**Interfaces:**
- Consumes: `fileMediaToTimepoint`, `queueMediaTask` (Task 2); `SOCKET_NAME` from `scripts/presenter/socket.mjs`; `isGroup` from `scripts/data/groups.mjs` (already imported in auto-capture.mjs).
- Produces (used by Task 5):
  - `relayDroppedMedia(group, entry, timepointId = null)` — emits the filing to the active GM; caller has already verified `game.users.activeGM` exists.
  - `registerMediaDropSocket()` — call once during `ready`.
- Trust model: like `AUTO_TARGET_ACTION`, module sockets carry no authenticated sender; the GM-side handler validates payload shape and group identity but cannot verify the sender's permissions (documented residual risk, matching `scripts/presenter/socket.mjs`'s stated model).

- [ ] **Step 1: Add the constant**

In `scripts/constants.mjs`, after the `AUTO_TARGET_ACTION` block (line 66-67), add:

```js
/** Socket action: relay a dropped-media gallery filing to the active GM. */
export const DROP_MEDIA_ACTION = "file-dropped-media";
```

- [ ] **Step 2: Add relay emit and listener**

In `scripts/hooks/auto-capture.mjs`:

Extend the constants import (line 3) to include `DROP_MEDIA_ACTION`:

```js
import { MODULE_ID, typeId, ENCOUNTER_FLAG, DEPARTED_FLAG, AUTO_MEDIA_FLAG, MEDIA_CAPTURE_SETTING, DROP_MEDIA_ACTION } from "../constants.mjs";
```

Add below the existing imports:

```js
import { SOCKET_NAME } from "../presenter/socket.mjs";
```

Add these two functions after `captureSharedMedia`:

```js
/**
 * Ask the active GM to file a dropped-media entry (players lack ownership
 * of GM-created galleries). Caller checks game.users.activeGM first.
 */
export function relayDroppedMedia(group, entry, timepointId = null) {
  game.socket.emit(SOCKET_NAME, {
    action: DROP_MEDIA_ACTION,
    groupId: group.id,
    src: entry.src,
    caption: entry.caption ?? "",
    timepointId
  });
}

/** Listen for relayed dropped-media filings; only the active GM applies them. Call in ready. */
export function registerMediaDropSocket() {
  game.socket.on(SOCKET_NAME, (payload) => {
    if (payload?.action !== DROP_MEDIA_ACTION) return;
    if (game.user !== game.users.activeGM) return;
    if (typeof payload.src !== "string" || !payload.src) return;
    const group = game.journal.get(payload.groupId);
    if (!group || !isGroup(group)) return;
    queueMediaTask(() => fileMediaToTimepoint(
      group,
      {
        id: foundry.utils.randomID(),
        src: payload.src,
        caption: typeof payload.caption === "string" ? payload.caption : ""
      },
      typeof payload.timepointId === "string" ? payload.timepointId : null
    ));
  });
}
```

- [ ] **Step 3: Register during ready**

In `scripts/campaign-record.mjs`, extend the import on line 13:

```js
import { registerAutoCapture, registerMediaDropSocket } from "./hooks/auto-capture.mjs";
```

and after the `registerAutoCapture();` call (line 35) add:

```js
  registerMediaDropSocket();
```

- [ ] **Step 4: Verify no regressions**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/constants.mjs scripts/hooks/auto-capture.mjs scripts/campaign-record.mjs
git commit -m "feat: GM relay socket for dropped-media gallery filings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Upload helper

**Files:**
- Create: `scripts/apps/hub/media-upload.mjs`

**Interfaces:**
- Consumes: `uploadFilename` (Task 1).
- Produces (used by Task 5): `uploadHubMedia(group, file)` — async; uploads into `campaign-record-media/<group.id>/` in the `data` source (group **id**, not name-slug: stable across renames and unicode-safe); returns the stored server path (string). Throws on failure — the caller notifies.

- [ ] **Step 1: Implement**

Create `scripts/apps/hub/media-upload.mjs`:

```js
import { uploadFilename } from "../../logic/media-drop.mjs";

/**
 * Upload a dropped media file into this group's media directory in the
 * user-data source. The filename is timestamp-prefixed so same-named drops
 * never overwrite. Returns the stored path; throws when the upload fails.
 */
export async function uploadHubMedia(group, file) {
  const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
  const dir = `campaign-record-media/${group.id}`;
  await FilePickerImpl.browse("data", dir).catch(async () => {
    // Parent first: createDirectory is not recursive.
    await FilePickerImpl.createDirectory("data", "campaign-record-media").catch(() => {});
    await FilePickerImpl.createDirectory("data", dir);
  });
  const renamed = new File([file], uploadFilename(file.name, Date.now()), { type: file.type });
  const result = await FilePickerImpl.upload("data", dir, renamed, {}, { notify: false });
  if (!result?.path) throw new Error(`campaign-record | upload failed for ${file.name}`);
  return result.path;
}
```

- [ ] **Step 2: Verify no regressions**

Run: `npx vitest run`
Expected: PASS (this file is Foundry-global; it's exercised by the Task 6 e2e).

- [ ] **Step 3: Commit**

```bash
git add scripts/apps/hub/media-upload.mjs
git commit -m "feat: FilePicker upload helper for hub media drops

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Hub wiring — drop zone, dispatch, attach, i18n, CSS

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs` (imports at top; drop handlers near line 597; DragDrop config + hover listeners in `_onRender`, lines 858-865)
- Modify: `lang/en.json` (new `CAMPAIGNRECORD.Hub.*` keys)
- Modify: `styles/campaign-record.css` (drag-hover highlight)

**Interfaces:**
- Consumes: `classifyDropData(data, uriList, files)` and `resolveDropTarget` (Task 1); `fileMediaToTimepoint`, `queueMediaTask`, `relayDroppedMedia` (Tasks 2-3); `uploadHubMedia` (Task 4); `isVideoSrc` from `scripts/logic/auto-capture.mjs`; existing `getTargetGroup`, `Timepoints`, `filenameFromSrc`, `#resolveViewedPage`.
- Produces: user-facing behavior; no new exports.

- [ ] **Step 1: Add imports**

In `scripts/apps/hub/hub-mixin.mjs`, extend the imports at the top:

```js
import { resolveDropTarget } from "../../logic/media-drop.mjs";
import { isVideoSrc } from "../../logic/auto-capture.mjs";
import { fileMediaToTimepoint, queueMediaTask, relayDroppedMedia } from "../../hooks/auto-capture.mjs";
import { uploadHubMedia } from "./media-upload.mjs";
```

- [ ] **Step 2: Widen the drop zone and add the dispatch handler**

Replace the DragDrop block in `_onRender` (lines 858-865) with:

```js
      new foundry.applications.ux.DragDrop.implementation({
        dragSelector: "[data-drag-record], [data-drag-timepoint]",
        dropSelector: ".window-content",
        callbacks: {
          dragstart: this.#onTimelineDragStart.bind(this),
          drop: this.#onHubDrop.bind(this)
        }
      }).bind(this.element);

      if (!this.element.dataset.crDropHoverBound) {
        this.element.dataset.crDropHoverBound = "1";
        this.element.addEventListener("dragover", (event) => {
          if (![...(event.dataTransfer?.types ?? [])].includes("Files")) return;
          event.preventDefault();
          this.element.classList.add("cr-file-drag");
        });
        this.element.addEventListener("dragleave", (event) => {
          if (!event.relatedTarget || !this.element.contains(event.relatedTarget)) {
            this.element.classList.remove("cr-file-drag");
          }
        });
        this.element.addEventListener("drop", () => this.element.classList.remove("cr-file-drag"));
      }
```

(Timepoint-row drops still work: the drop event bubbles to `.window-content`, and both `#onTimelineDrop` and the new file path resolve the row via `event.target.closest("[data-drop-timepoint]")`.)

- [ ] **Step 3: Add the drop handlers**

Immediately before `#onTimelineDrop` (line 597), add `#onHubDrop`; `#onTimelineDrop` itself is unchanged:

```js
    /** All hub drops enter here: OS media files branch off; everything else keeps the timeline path. */
    async #onHubDrop(event) {
      let data;
      try {
        data = JSON.parse(event.dataTransfer.getData("text/plain")) ?? {};
      } catch {
        data = {};
      }
      const drop = classifyDropData(
        data,
        event.dataTransfer.getData("text/uri-list"),
        [...(event.dataTransfer?.files ?? [])]
      );
      if (drop?.kind === "files") {
        event.preventDefault();
        return this.#onMediaFilesDrop(event, drop);
      }
      return this.#onTimelineDrop(event);
    }
```

After `#dropLink` (line 643), add the file pipeline:

```js
    /** The group receiving a file drop, per target kind; null when none applies. */
    #dropGroup(target, tpRow, viewedPage) {
      if (target.kind === "timepoint") {
        return game.journal.get(tpRow.closest("[data-group-id]").dataset.groupId) ?? null;
      }
      if (target.kind === "media-entry") return viewedPage?.parent ?? null;
      if (this.state.groupId !== "all") return game.journal.get(this.state.groupId) ?? null;
      return getTargetGroup();
    }

    /** Upload dropped media files and attach them per the resolved target. */
    async #onMediaFilesDrop(event, { accepted, rejected }) {
      for (const name of rejected) {
        ui.notifications.warn(game.i18n.format("CAMPAIGNRECORD.Hub.DropSkippedFile", { name }));
      }
      if (!accepted.length) return;
      if (!game.user.can("FILES_UPLOAD")) {
        return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.DropCannotUpload"));
      }
      const tpRow = event.target.closest("[data-drop-timepoint]");
      const viewedPage = this.#resolveViewedPage();
      const target = resolveDropTarget({
        timepointId: tpRow?.dataset.timepointId ?? null,
        viewedPage,
        canModifyPage: viewedPage?.canUserModify(game.user, "update") === true
      });
      const group = this.#dropGroup(target, tpRow, viewedPage);
      if (!group) {
        return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.DropNoGroup"));
      }
      if (!group.canUserModify(game.user, "update")) {
        return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.CannotEditTimeline"));
      }
      for (const file of accepted) {
        let path;
        try {
          path = await uploadHubMedia(group, file);
        } catch (error) {
          console.error("campaign-record | media upload failed", error);
          ui.notifications.error(game.i18n.format("CAMPAIGNRECORD.Hub.DropUploadFailed", { name: file.name }));
          continue;
        }
        await this.#attachDroppedMedia(target, group, file.name, path);
      }
    }

    /** Attach one uploaded file per the resolved target. Failures notify with the path so the upload isn't lost. */
    async #attachDroppedMedia(target, group, name, path) {
      const entry = { id: foundry.utils.randomID(), src: path, caption: "" };
      try {
        if (target.kind === "media-entry") {
          const page = await fromUuid(target.uuid);
          await page.update({ "system.images": [...page.system.toObject().images, entry] });
          return ui.notifications.info(
            game.i18n.format("CAMPAIGNRECORD.Hub.DropAdded", { name, target: page.name })
          );
        }
        if (target.kind === "timepoint" && !isVideoSrc(path)) {
          const showPlayers = await foundry.applications.api.DialogV2.confirm({
            window: { title: "CAMPAIGNRECORD.Hub.ShowImageToPlayers" },
            content: `<p>${game.i18n.format("CAMPAIGNRECORD.Hub.ShowImageToPlayersPrompt", {
              name: foundry.utils.escapeHTML(name)
            })}</p>`,
            rejectClose: false
          });
          if (showPlayers === null) {
            // Dialog dismissed: leave the file uploaded but unattached.
            return ui.notifications.info(game.i18n.format("CAMPAIGNRECORD.Hub.DropUnattached", { name, path }));
          }
          await Timepoints.addLink(group, target.id, {
            src: path, name: filenameFromSrc(path), showPlayers: showPlayers === true
          });
          const label = Timepoints.getTimepoints(group).find((t) => t.id === target.id)?.label ?? "";
          return ui.notifications.info(game.i18n.format("CAMPAIGNRECORD.Hub.DropAdded", { name, target: label }));
        }
        // Shared auto-gallery — hub-wide drops, and videos dropped on a timepoint
        // row (image-link chips render <img> thumbnails, broken for video).
        const timepointId = target.kind === "timepoint" ? target.id : null;
        if (game.user.isGM) {
          await queueMediaTask(() => fileMediaToTimepoint(group, entry, timepointId));
        } else if (game.users.activeGM) {
          relayDroppedMedia(group, entry, timepointId);
        } else {
          return ui.notifications.warn(game.i18n.format("CAMPAIGNRECORD.Hub.DropNoGM", { name, path }));
        }
        ui.notifications.info(game.i18n.format("CAMPAIGNRECORD.Hub.DropAddedToGallery", { name }));
      } catch (error) {
        console.error("campaign-record | dropped-media attach failed", error);
        ui.notifications.error(game.i18n.format("CAMPAIGNRECORD.Hub.DropAttachFailed", { name, path }));
      }
    }
```

- [ ] **Step 4: Add the i18n keys**

In `lang/en.json`, inside the `CAMPAIGNRECORD.Hub` object (alphabetical-ish placement near the other `Cannot*`/`Drop*` keys is fine; match the file's existing (nested or flat) key style — check how `Hub.CannotAttach` is written and follow it):

```json
"DropSkippedFile": "\"{name}\" is not a supported image or video and was skipped.",
"DropCannotUpload": "You lack permission to upload files to the server.",
"DropNoGroup": "No Campaign Record can receive this media — open one in the hub or set an auto-capture target.",
"DropUploadFailed": "\"{name}\" could not be uploaded.",
"DropAttachFailed": "\"{name}\" was uploaded to \"{path}\" but could not be attached.",
"DropUnattached": "\"{name}\" was uploaded to \"{path}\" and left unattached.",
"DropNoGM": "No GM is connected — \"{name}\" was uploaded to \"{path}\" but not filed to the timeline.",
"DropAdded": "Added \"{name}\" to \"{target}\".",
"DropAddedToGallery": "Filed \"{name}\" into the shared media gallery."
```

- [ ] **Step 5: Add the drag-hover style**

In `styles/campaign-record.css`, append:

```css
/* Hub drop-zone highlight while dragging OS files over the window. */
.campaign-hub.cr-file-drag .window-content {
  outline: 2px dashed var(--color-warm-2, #c9593f);
  outline-offset: -4px;
}
```

(If the stylesheet doesn't define `--color-warm-2`, the `#c9593f` fallback applies — check neighboring rules for the project's preferred accent variable and use that instead if one exists.)

- [ ] **Step 6: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS — in particular `tests/i18n-coverage.test.js` must pass with the new keys (fix key placement/style if it fails).

- [ ] **Step 7: Commit**

```bash
git add scripts/apps/hub/hub-mixin.mjs lang/en.json styles/campaign-record.css
git commit -m "feat: drag-and-drop media upload onto the Campaign Hub

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: E2E coverage + README note

**Files:**
- Create: `tests/e2e/28-hub-media-drop.spec.mjs`
- Modify: `README.md` (one feature bullet)

**Interfaces:**
- Consumes: `login`, `deleteGroupsByPrefix` from `tests/e2e/helpers/foundry.mjs`; `CampaignHub.open()`; module data APIs via dynamic import (`groups.mjs`, `timepoints.mjs`).
- **Before running anything here, invoke the project's `foundry-e2e` skill and follow its session-locking contract.**

- [ ] **Step 1: Write the e2e spec**

Create `tests/e2e/28-hub-media-drop.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

// Drops synthetic OS files (DataTransfer + File) onto the Campaign Hub and
// asserts the three routing paths: open media entry, shared auto-gallery on
// the newest timepoint, and a specific timepoint row (image link).
const P = "E2E MediaDrop";

// 1x1 transparent PNG
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Dispatch a synthetic file-drop on the first element matching selector. */
const dropFile = (page, selector, filename) =>
  page.evaluate(({ selector, filename, b64 }) => {
    const dt = new DataTransfer();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], filename, { type: "image/png" }));
    const el = document.querySelector(selector);
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { selector, filename, b64: PNG_B64 });

test.describe("hub media drag-and-drop upload", () => {
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

  test("hub-wide drop files into the newest-timepoint shared gallery", async () => {
    const ids = await page.evaluate(async (P) => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const { addTimepoint } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = await createGroup(`${P} Gallery`);
      await game.settings.set("campaign-record", "autoCaptureTargetGroup", group.id);
      const tp = await addTimepoint(group, `${P} TP1`);
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
      return { groupId: group.id, tpId: tp.id };
    }, P);
    await page.waitForSelector("#campaign-hub .window-content");

    await dropFile(page, "#campaign-hub .window-content", "drop-gallery.png");

    await expect.poll(() => page.evaluate(({ groupId, tpId }) => {
      const g = game.journal.get(groupId);
      const gallery = g.pages.find(
        (p) => p.type === "campaign-record.media"
          && p.getFlag("campaign-record", "autoMediaTimepoint") === tpId
      );
      return gallery?.system.images.length ?? 0;
    }, ids), { timeout: 15_000 }).toBe(1);

    // the stored src points at the uploaded copy, not a local path
    const src = await page.evaluate(({ groupId, tpId }) => {
      const g = game.journal.get(groupId);
      const gallery = g.pages.find(
        (p) => p.getFlag("campaign-record", "autoMediaTimepoint") === tpId
      );
      return gallery.system.images[0].src;
    }, ids);
    expect(src).toContain(`campaign-record-media/${ids.groupId}/`);
    expect(src).toContain("drop-gallery.png");

    // gallery is linked to the timepoint
    const linked = await page.evaluate(async ({ groupId, tpId }) => {
      const { getTimepoints } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const g = game.journal.get(groupId);
      return getTimepoints(g).find((t) => t.id === tpId).links.length;
    }, ids);
    expect(linked).toBe(1);
  });

  test("drop lands in the open media entry", async () => {
    const ids = await page.evaluate(async (P) => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const group = await createGroup(`${P} Entry`);
      const [media] = await group.createEmbeddedDocuments("JournalEntryPage", [
        { name: `${P} Slides`, type: "campaign-record.media", system: { images: [] } }
      ]);
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const hub = CampaignHub.open();
      await hub.navigateToRecord(media.uuid);
      return { groupId: group.id, mediaId: media.id };
    }, P);
    await page.waitForSelector("#campaign-hub .record-pane-mount .cr-record-sheet, #campaign-hub .record-pane-mount *");

    await dropFile(page, "#campaign-hub .window-content", "drop-entry.png");

    await expect.poll(() => page.evaluate(({ groupId, mediaId }) => {
      const media = game.journal.get(groupId).pages.get(mediaId);
      return media.system.images.length;
    }, ids), { timeout: 15_000 }).toBe(1);

    const img = await page.evaluate(({ groupId, mediaId }) => {
      return game.journal.get(groupId).pages.get(mediaId).system.images[0];
    }, ids);
    expect(img.src).toContain("drop-entry.png");
    expect(img.caption).toBe("");
  });

  test("drop on a timepoint row attaches an image link to that timepoint", async () => {
    const ids = await page.evaluate(async (P) => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const { addTimepoint } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = await createGroup(`${P} Row`);
      const tpOld = await addTimepoint(group, `${P} Older`);
      await addTimepoint(group, `${P} Newest`);
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const hub = CampaignHub.open();
      await hub.navigateToIndex();
      hub.state.groupId = group.id;
      await hub.render();
      return { groupId: group.id, tpOldId: tpOld.id };
    }, P);
    await page.waitForSelector(`#campaign-hub [data-drop-timepoint][data-timepoint-id="${ids.tpOldId}"]`);

    // Drop on the OLDER row: routing must honor the explicit row, not the newest timepoint.
    await dropFile(
      page,
      `#campaign-hub [data-drop-timepoint][data-timepoint-id="${ids.tpOldId}"]`,
      "drop-row.png"
    );

    // ShowPlayers confirm dialog → "No" (showPlayers: false)
    const noButton = page.locator('dialog button[data-action="no"], .application.dialog button[data-action="no"]');
    await noButton.first().click({ timeout: 15_000 });

    await expect.poll(() => page.evaluate(async ({ groupId, tpOldId }) => {
      const { getTimepoints } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const g = game.journal.get(groupId);
      const tp = getTimepoints(g).find((t) => t.id === tpOldId);
      return tp.links.length;
    }, ids), { timeout: 15_000 }).toBe(1);

    const link = await page.evaluate(async ({ groupId, tpOldId }) => {
      const { getTimepoints } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const g = game.journal.get(groupId);
      return getTimepoints(g).find((t) => t.id === tpOldId).links[0];
    }, ids);
    expect(link.src).toContain("drop-row.png");
    expect(link.showPlayers).toBe(false);
  });
});
```

Adjust the two `waitForSelector` calls if the actual DOM uses different hooks: check `templates/hub/timeline.hbs` for the exact `data-drop-timepoint` / `data-timepoint-id` attribute names, and `templates/hub/record.hbs` for the pane-mount selector, and fix the selectors to match reality before running.

- [ ] **Step 2: Run the new e2e spec**

**First invoke the `foundry-e2e` skill and follow its contract** (locking, server state). Then:

Run: `npx playwright test tests/e2e/28-hub-media-drop.spec.mjs`
Expected: 3 passed. Iterate on selectors/timing per the skill's iteration rules if not.

- [ ] **Step 3: Run the neighboring regression specs**

Run: `npx playwright test tests/e2e/26-shared-media-capture.spec.mjs tests/e2e/19-hub-timeline-links.spec.mjs tests/e2e/08-hub-timeline.spec.mjs`
Expected: all pass (Task 2's refactor and Task 5's dropSelector change are the risk surface — reordering timepoints and document/image drops must still work).

- [ ] **Step 4: README feature bullet**

In `README.md`, find the feature list and add one bullet alongside the shared-media-capture feature (match surrounding phrasing):

```markdown
- **Drag-and-drop media upload** — drop an image or video from your desktop onto the Campaign Hub: it uploads to the server and lands in the open media entry, the timepoint you dropped it on, or the newest timepoint's shared media gallery.
```

- [ ] **Step 5: Full unit suite + commit**

Run: `npx vitest run`
Expected: PASS.

```bash
git add tests/e2e/28-hub-media-drop.spec.mjs README.md
git commit -m "test: e2e coverage for hub media drag-and-drop upload

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
