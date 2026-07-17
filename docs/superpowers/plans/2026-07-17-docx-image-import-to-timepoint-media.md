# Docx Image Import → Inline + Timepoint Media Galleries — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make docx import bring images in — inline in each journal page *and* into the media entry of the nearest-preceding timepoint — uploading each image to the server only once.

**Architecture:** Upload each inline data-URI image once via the existing `uploadHubMedia` (which has correct parent-first directory creation), reuse the returned server path for both the inline `<img src>` and a per-timepoint media gallery. Pure logic (data-URI parsing, nearest-preceding timepoint assignment, gallery merge/dedup) is unit-tested with vitest; Foundry-touching I/O (upload, transcode, gallery page writes) lives in thin wizard/hook adapters verified via the Playwright e2e harness.

**Tech Stack:** JavaScript ES modules, Foundry VTT v13 ApplicationV2, mammoth (docx→HTML), vitest (unit), Playwright (e2e).

## Global Constraints

- Foundry VTT v13 (`foundry.applications.*`, `foundry.utils.*`, `CONST.*`).
- Pure logic modules must import **no** Foundry globals so vitest can load them directly (matches `scripts/logic/doc-import.mjs` + `tests/doc-import.test.js`).
- Module id string is `"campaign-record"` (`MODULE_ID`).
- Media entry type id is `typeId("media")` → `"campaign-record.media"`.
- Per-timepoint gallery pages are flagged `flags["campaign-record"].autoMediaTimepoint = <timepointId>` (`AUTO_MEDIA_FLAG`).
- Gallery image entries have shape `{ id: string, src: string, caption: string }`; dedup key is `src`.
- Foundry-renderable image extensions: `apng, avif, bmp, gif, jpeg, jpg, png, svg, tiff, webp`. Everything else (notably Word's `image/x-emf`, `image/x-wmf`) is unsupported and must be skipped with a per-image warning, never silently.
- Unit test command: `npm test` (vitest run). Run a single file with `npx vitest run tests/<file>`.
- Commit style: conventional commits (`feat:`, `fix:`, `test:`, `refactor:`).

---

## File Structure

**New files:**
- `scripts/logic/import-images.mjs` — pure helpers: robust data-URI parsing, subtype→extension map, nearest-preceding timepoint assignment.
- `tests/import-images.test.js` — vitest for the above.

**Modified files:**
- `scripts/logic/auto-capture.mjs` — add pure `mergeGalleryImages(existing, entries)` (batch dedup-by-src).
- `tests/auto-capture.test.js` — add `mergeGalleryImages` tests (create the file if absent).
- `scripts/hooks/auto-capture.mjs` — add `fileMediaBatchToTimepoint(group, entries, timepointId)` reusing `findAutoGallery` + `mergeGalleryImages`.
- `scripts/apps/import-wizard.mjs` — replace `dataUriToFile`/`uploadDataUriImages` with the single-upload path (`uploadHubMedia`, transcode fallback, per-image skip); restructure `#onCreate` to collect image refs, assign timepoints, and batch-file galleries.
- `lang/en.json` — add `CAMPAIGNRECORD.Import.ImageTypeUnsupported`.

---

## Task 1: Pure data-URI parsing + extension map

**Files:**
- Create: `scripts/logic/import-images.mjs`
- Test: `tests/import-images.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseImageDataUri(uri: string) => { mime: string, subtype: string, base64: string } | null`
  - `IMAGE_SUBTYPE_EXT: Record<string,string>` (renderable subtype → file extension)
  - `imageExtension(subtype: string) => string | null` (null = not directly renderable)

- [ ] **Step 1: Write the failing test**

Create `tests/import-images.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import { parseImageDataUri, imageExtension } from "../scripts/logic/import-images.mjs";

describe("parseImageDataUri", () => {
  it("parses a base64 image data-URI into mime, subtype, and payload", () => {
    const r = parseImageDataUri("data:image/png;base64,AAAB");
    expect(r).toEqual({ mime: "image/png", subtype: "png", base64: "AAAB" });
  });

  it("lower-cases the subtype and handles hyphen/plus subtypes", () => {
    expect(parseImageDataUri("data:image/X-EMF;base64,ZZ").subtype).toBe("x-emf");
    expect(parseImageDataUri("data:image/svg+xml;base64,ZZ").subtype).toBe("svg+xml");
  });

  it("returns null for non-image, non-base64, or malformed URIs", () => {
    expect(parseImageDataUri("data:text/plain;base64,AA")).toBeNull();
    expect(parseImageDataUri("data:image/png,AA")).toBeNull();
    expect(parseImageDataUri("https://x/y.png")).toBeNull();
    expect(parseImageDataUri("")).toBeNull();
    expect(parseImageDataUri(null)).toBeNull();
  });
});

describe("imageExtension", () => {
  it("maps renderable subtypes to extensions (jpeg→jpg, svg+xml→svg)", () => {
    expect(imageExtension("png")).toBe("png");
    expect(imageExtension("jpeg")).toBe("jpg");
    expect(imageExtension("svg+xml")).toBe("svg");
    expect(imageExtension("webp")).toBe("webp");
  });

  it("returns null for types Foundry cannot render", () => {
    expect(imageExtension("x-emf")).toBeNull();
    expect(imageExtension("x-wmf")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/import-images.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/import-images.mjs`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/logic/import-images.mjs`:

```javascript
/**
 * Pure image helpers for docx import. No Foundry globals — unit-tested with vitest.
 */

/** Renderable image subtypes → the file extension Foundry serves them under. */
export const IMAGE_SUBTYPE_EXT = {
  png: "png",
  apng: "apng",
  avif: "avif",
  jpeg: "jpg",
  jpg: "jpg",
  gif: "gif",
  webp: "webp",
  bmp: "bmp",
  tiff: "tiff",
  "svg+xml": "svg"
};

/** Extension for a renderable subtype, or null when Foundry cannot render it. */
export function imageExtension(subtype) {
  return IMAGE_SUBTYPE_EXT[subtype] ?? null;
}

/**
 * Parse a base64 image data-URI. Returns { mime, subtype, base64 } or null.
 * subtype is lower-cased; hyphen/plus subtypes (x-emf, svg+xml) are preserved.
 */
export function parseImageDataUri(uri) {
  const m = /^data:(image\/([a-z0-9.+-]+));base64,(.*)$/i.exec(uri ?? "");
  if (!m) return null;
  return { mime: m[1], subtype: m[2].toLowerCase(), base64: m[3] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/import-images.test.js`
Expected: PASS (2 describe blocks, 5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/import-images.mjs tests/import-images.test.js
git commit -m "feat(import): pure data-URI parsing and image extension map"
```

---

## Task 2: Nearest-preceding timepoint assignment (pure)

**Files:**
- Modify: `scripts/logic/import-images.mjs`
- Test: `tests/import-images.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `assignTimepoints(sessionTpIds: (string|null)[]) => (string|null)[]`
  - Input: one entry per page in document order — the page's own timepoint id if it is a session page, else `null`.
  - Output: same length — each page's *governing* timepoint id: the nearest session at or before it; pages before the first session are backfilled to the first timepoint; all `null` when there are no session pages.

- [ ] **Step 1: Write the failing test**

Append to `tests/import-images.test.js`:

```javascript
import { assignTimepoints } from "../scripts/logic/import-images.mjs";

describe("assignTimepoints", () => {
  it("carries each session's id forward to following non-session pages", () => {
    // pages: [session A][text][session B][text]
    expect(assignTimepoints(["A", null, "B", null])).toEqual(["A", "A", "B", "B"]);
  });

  it("backfills pages before the first session to the first timepoint", () => {
    // pages: [intro][text][session A][text]
    expect(assignTimepoints([null, null, "A", null])).toEqual(["A", "A", "A", "A"]);
  });

  it("returns all null when there are no session pages", () => {
    expect(assignTimepoints([null, null, null])).toEqual([null, null, null]);
  });

  it("assigns a session page's own images to its own timepoint", () => {
    expect(assignTimepoints(["A", "B"])).toEqual(["A", "B"]);
  });

  it("returns an empty array for no pages", () => {
    expect(assignTimepoints([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/import-images.test.js`
Expected: FAIL — `assignTimepoints` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/logic/import-images.mjs`:

```javascript
/**
 * Map each page to its governing timepoint id (nearest session at or before it
 * in document order). Pages before the first session are backfilled to the
 * first timepoint. All null when no page is a session.
 * @param {(string|null)[]} sessionTpIds page's own tp id if a session, else null
 * @returns {(string|null)[]}
 */
export function assignTimepoints(sessionTpIds) {
  const firstId = sessionTpIds.find((id) => id != null) ?? null;
  let current = null;
  return sessionTpIds.map((id) => {
    if (id != null) current = id;
    return current ?? firstId;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/import-images.test.js`
Expected: PASS (all Task 1 + Task 2 tests green).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/import-images.mjs tests/import-images.test.js
git commit -m "feat(import): nearest-preceding timepoint assignment"
```

---

## Task 3: Batch gallery merge (pure)

**Files:**
- Modify: `scripts/logic/auto-capture.mjs` (add export next to `appendGalleryImage`)
- Test: `tests/auto-capture.test.js` (create if absent)

**Interfaces:**
- Consumes: existing `appendGalleryImage(images, entry)` semantics (dedup by `src`).
- Produces: `mergeGalleryImages(existing: Entry[], entries: Entry[]) => { images: Entry[], added: number }`
  where `Entry = { id: string, src: string, caption: string }`. Appends each of `entries` not already present by `src` (including duplicates within `entries`); `added` is how many were appended.

- [ ] **Step 1: Write the failing test**

Create (or append to) `tests/auto-capture.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import { mergeGalleryImages } from "../scripts/logic/auto-capture.mjs";

describe("mergeGalleryImages", () => {
  const e = (src) => ({ id: src, src, caption: "" });

  it("appends new entries and reports the count added", () => {
    const r = mergeGalleryImages([e("a.png")], [e("b.png"), e("c.png")]);
    expect(r.images.map((i) => i.src)).toEqual(["a.png", "b.png", "c.png"]);
    expect(r.added).toBe(2);
  });

  it("dedupes against existing images by src", () => {
    const r = mergeGalleryImages([e("a.png")], [e("a.png"), e("b.png")]);
    expect(r.images.map((i) => i.src)).toEqual(["a.png", "b.png"]);
    expect(r.added).toBe(1);
  });

  it("dedupes duplicates within the incoming batch", () => {
    const r = mergeGalleryImages([], [e("a.png"), e("a.png")]);
    expect(r.images.map((i) => i.src)).toEqual(["a.png"]);
    expect(r.added).toBe(1);
  });

  it("returns existing unchanged with added 0 for an empty batch", () => {
    const existing = [e("a.png")];
    const r = mergeGalleryImages(existing, []);
    expect(r.images).toEqual(existing);
    expect(r.added).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auto-capture.test.js`
Expected: FAIL — `mergeGalleryImages` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `scripts/logic/auto-capture.mjs`, add directly below the existing `appendGalleryImage` function:

```javascript
/**
 * Append many entries to a gallery's images, deduped by src against both the
 * existing images and earlier entries in the same batch.
 * @param {{id:string,src:string,caption:string}[]} existing
 * @param {{id:string,src:string,caption:string}[]} entries
 * @returns {{images:{id:string,src:string,caption:string}[], added:number}}
 */
export function mergeGalleryImages(existing, entries) {
  const images = [...existing];
  const seen = new Set(images.map((i) => i.src));
  let added = 0;
  for (const entry of entries) {
    if (seen.has(entry.src)) continue;
    seen.add(entry.src);
    images.push(entry);
    added++;
  }
  return { images, added };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auto-capture.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/auto-capture.mjs tests/auto-capture.test.js
git commit -m "feat(media): mergeGalleryImages batch dedup helper"
```

---

## Task 4: Batched per-timepoint gallery filer (Foundry I/O)

**Files:**
- Modify: `scripts/hooks/auto-capture.mjs`

**Interfaces:**
- Consumes: `findAutoGallery(group, timepointId)` (existing, module-local), `mergeGalleryImages` (Task 3), `getTimepoints`, `addLink`, `MEDIA_TYPE`, `MODULE_ID`, `AUTO_MEDIA_FLAG`.
- Produces: `fileMediaBatchToTimepoint(group, entries, timepointId) => Promise<{added:number, gallery:JournalEntryPage|null}>`
  - Writes the timepoint's auto-gallery **once**. Creates the gallery page + timeline link on first use; appends+dedupes on later use. Unknown/missing `timepointId` → `{ added: 0, gallery: null }`.

> **Note on testing:** this function touches Foundry document APIs, which the repo does not unit-test (see `fileMediaToTimepoint` — no vitest). Its pure core (`mergeGalleryImages`) is covered by Task 3. Verify behavior in Task 6's e2e/manual run. Do **not** add a vitest file that imports Foundry globals.

- [ ] **Step 1: Add the batched filer**

In `scripts/hooks/auto-capture.mjs`, update the import from `../logic/auto-capture.mjs` to include `mergeGalleryImages`:

```javascript
import { matchPlaceForScene, pickLatestTimepoint, pickNewestTimepoint, collapseParticipants, mergeParticipants, summarizeOutcome, appendGalleryImage, mergeGalleryImages } from "../logic/auto-capture.mjs";
```

Then add this function directly below the existing `fileMediaToTimepoint`:

```javascript
/**
 * File many media entries into a group's timepoint gallery in a single write.
 * Batch analogue of fileMediaToTimepoint: creates the gallery page (flagged
 * with the timepoint id) and its timeline link on first use; later calls
 * append, deduped by src. An unknown/missing timepointId is a no-op.
 * @param {JournalEntry} group
 * @param {{id:string,src:string,caption:string}[]} entries
 * @param {string} timepointId
 * @returns {Promise<{added:number, gallery:JournalEntryPage|null}>}
 */
export async function fileMediaBatchToTimepoint(group, entries, timepointId) {
  if (!entries?.length) return { added: 0, gallery: null };
  const tp = getTimepoints(group).find((t) => t.id === timepointId);
  if (!tp) return { added: 0, gallery: null };

  const gallery = findAutoGallery(group, tp.id);
  if (gallery) {
    const { images, added } = mergeGalleryImages(gallery.system.toObject().images, entries);
    if (added) await gallery.update({ "system.images": images });
    return { added, gallery };
  }

  const name = game.i18n.format("CAMPAIGNRECORD.AutoCapture.SharedMediaName", { label: tp.label });
  const { images } = mergeGalleryImages([], entries);
  const [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
    {
      name,
      type: MEDIA_TYPE,
      system: { images },
      flags: { [MODULE_ID]: { [AUTO_MEDIA_FLAG]: tp.id } }
    }
  ]);
  await addLink(group, tp.id, { uuid: page.uuid, name: page.name, type: "JournalEntryPage" });
  return { added: images.length, gallery: page };
}
```

- [ ] **Step 2: Verify the module still parses (no unit test for Foundry I/O)**

Run: `npx vitest run tests/auto-capture.test.js`
Expected: PASS — Task 3's pure tests still green (the hook file is not imported by vitest; this confirms the shared logic module is intact).

Run: `node --check scripts/hooks/auto-capture.mjs`
Expected: no output (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add scripts/hooks/auto-capture.mjs
git commit -m "feat(media): batched fileMediaBatchToTimepoint gallery filer"
```

---

## Task 5: Single-upload inline image path in the wizard

**Files:**
- Modify: `scripts/apps/import-wizard.mjs` (replace `dataUriToFile` at :299-305 and `uploadDataUriImages` at :307-334)
- Modify: `lang/en.json` (add key after `ImagesDropped` at :146)

**Interfaces:**
- Consumes: `parseImageDataUri`, `imageExtension` (Task 1); `uploadHubMedia(group, file)` (existing, `../apps/hub/media-upload.mjs` — note the wizard is in `scripts/apps/`, so import path is `./hub/media-upload.mjs`).
- Produces:
  - `dataUriToFile(uri, basename) => Promise<{ file: File } | { skipped: string }>` — builds a `File` for renderable types; transcodes unknown-but-decodable types to PNG; returns `{ skipped: subtype }` for undecodable types (EMF/WMF).
  - `uploadInlineImages(html, group, warnings) => Promise<{ html: string, images: {src:string, caption:string}[] }>` — uploads each inline data-URI once (deduped within the doc), rewrites `<img src>` to the stored path, and returns the collected `{src, caption}` refs. Replaces `uploadDataUriImages`.

- [ ] **Step 1: Add the i18n warning key**

In `lang/en.json`, add after the `ImagesDropped` line (:146):

```json
      "ImageTypeUnsupported": "Skipped an image of unsupported type \"{type}\".",
```

- [ ] **Step 2: Add the `import-images` import**

At the top of `scripts/apps/import-wizard.mjs`, add alongside the other imports:

```javascript
import { parseImageDataUri, imageExtension } from "../logic/import-images.mjs";
import { uploadHubMedia } from "./hub/media-upload.mjs";
```

- [ ] **Step 3: Replace `dataUriToFile` with the robust async builder**

Replace the existing `dataUriToFile` function (:299-305) with:

```javascript
/**
 * Build an upload File from an image data-URI. Renderable types upload as-is;
 * unknown-but-decodable types transcode to PNG; undecodable types (EMF/WMF)
 * return { skipped: subtype }.
 */
async function dataUriToFile(uri, basename) {
  const parsed = parseImageDataUri(uri);
  if (!parsed) return { skipped: "unknown" };
  const bytes = Uint8Array.from(atob(parsed.base64), (c) => c.charCodeAt(0));
  const ext = imageExtension(parsed.subtype);
  if (ext) return { file: new File([bytes], `${basename}.${ext}`, { type: parsed.mime }) };
  // Not directly renderable — best-effort transcode to PNG (EMF/WMF will throw).
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: parsed.mime }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const png = await canvas.convertToBlob({ type: "image/png" });
    return { file: new File([await png.arrayBuffer()], `${basename}.png`, { type: "image/png" }) };
  } catch {
    return { skipped: parsed.subtype };
  }
}
```

- [ ] **Step 4: Replace `uploadDataUriImages` with `uploadInlineImages`**

Replace the existing `uploadDataUriImages` function (:307-334) with:

```javascript
/**
 * Upload each inline data-URI image once (mammoth inlines docx images), rewrite
 * srcs to the stored path, and return the collected {src, caption} refs for
 * gallery filing. Identical data-URIs upload once. Per-image failures drop that
 * image with a warning; other images are unaffected.
 */
async function uploadInlineImages(html, group, warnings) {
  if (!html?.includes("data:image")) return { html, images: [] };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const imgs = [...doc.body.querySelectorAll('img[src^="data:"]')];
  if (!imgs.length) return { html, images: [] };

  const uploadedByUri = new Map(); // data-URI -> stored path (dedupe within doc)
  const images = [];
  let unsupported = 0;
  let n = 0;
  for (const img of imgs) {
    const uri = img.getAttribute("src");
    let path = uploadedByUri.get(uri);
    if (path === undefined) {
      const result = await dataUriToFile(uri, `import-${Date.now()}-${++n}`);
      if (result.skipped) {
        unsupported++;
        path = null;
      } else {
        try {
          path = await uploadHubMedia(group, result.file);
        } catch (error) {
          console.warn("campaign-record | inline image upload failed", error);
          path = null;
        }
      }
      uploadedByUri.set(uri, path);
    }
    if (path) {
      img.setAttribute("src", path);
      const caption = (img.getAttribute("alt") ?? "").trim();
      images.push({ src: path, caption });
    } else {
      img.remove();
    }
  }

  if (unsupported) {
    warnings.push(game.i18n.format("CAMPAIGNRECORD.Import.ImageTypeUnsupported", { type: "image" }));
  }
  const failed = imgs.length - images.length - unsupported;
  if (failed > 0) warnings.push(game.i18n.localize("CAMPAIGNRECORD.Import.ImagesDropped"));

  // Dedupe refs by src so the same image inline twice yields one gallery entry.
  const seen = new Set();
  const uniqueImages = images.filter((i) => (seen.has(i.src) ? false : seen.add(i.src)));
  return { html: doc.body.innerHTML, images: uniqueImages };
}
```

- [ ] **Step 5: Verify pure deps still pass and the module parses**

Run: `npx vitest run tests/import-images.test.js`
Expected: PASS (Task 1 + 2 still green).

Run: `node --check scripts/apps/import-wizard.mjs`
Expected: no output (syntax OK).

- [ ] **Step 6: Commit**

```bash
git add scripts/apps/import-wizard.mjs lang/en.json
git commit -m "fix(import): upload docx images once via uploadHubMedia; parse types robustly

Fixes total image loss on fresh worlds (non-recursive createDirectory) and
silent EMF/WMF drops. Collects per-page image refs for gallery filing."
```

---

## Task 6: Route imported images into timepoint galleries in `#onCreate`

**Files:**
- Modify: `scripts/apps/import-wizard.mjs` (`#onCreate` at :238-292)

**Interfaces:**
- Consumes: `uploadInlineImages` (Task 5), `assignTimepoints` (Task 2), `fileMediaBatchToTimepoint` (Task 4), existing `Timepoints.addTimepoint`/`addLink`, `foundry.utils.randomID`.
- Produces: no new exports — final wiring.

- [ ] **Step 1: Add the batch filer import**

At the top of `scripts/apps/import-wizard.mjs`, add:

```javascript
import { assignTimepoints } from "../logic/import-images.mjs";
import { fileMediaBatchToTimepoint } from "../hooks/auto-capture.mjs";
```

(Merge the `import-images.mjs` import with the one added in Task 5 so `parseImageDataUri`, `imageExtension`, and `assignTimepoints` come from one line.)

- [ ] **Step 2: Rewrite the upload + create + gallery section of `#onCreate`**

Inside `#onCreate`, replace the block that currently runs from the `const slug = …` upload loop through the timepoint-creation loop (the `for (const page of plan.pages) { page.html = await uploadDataUriImages(...) }` loop, the `payload`/`created` creation, and the `let timepoints = 0; for (…) { … addTimepoint … addLink … }` loop) with:

```javascript
      // Upload inline images once each; collect per-page refs for gallery filing.
      for (const page of plan.pages) {
        const { html, images } = await uploadInlineImages(page.html, group, plan.warnings);
        page.html = html;
        page.images = images;
      }

      const payload = plan.pages.map((p) => p.type === "text"
        ? { name: p.name, type: "text",
            text: { content: p.html, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML } }
        : { name: p.name, type: typeId(p.type), system: { description: p.html } });
      const created = await group.createEmbeddedDocuments("JournalEntryPage", payload);

      // Create a timepoint per session page; record each page's own tp id (or null).
      const sessionTpIds = [];
      let timepoints = 0;
      for (let i = 0; i < plan.pages.length; i++) {
        if (!plan.pages[i].timepoint) { sessionTpIds.push(null); continue; }
        const tp = await Timepoints.addTimepoint(group, plan.pages[i].timepoint);
        const page = created[i];
        if (page) await Timepoints.addLink(group, tp.id, {
          uuid: page.uuid, name: page.name, type: "JournalEntryPage"
        });
        sessionTpIds.push(tp.id);
        timepoints++;
      }

      // File images into the nearest-preceding timepoint's gallery, batched per tp.
      const governing = assignTimepoints(sessionTpIds);
      const byTimepoint = new Map();
      plan.pages.forEach((page, i) => {
        const tpId = governing[i];
        if (!tpId || !page.images?.length) return;
        const entries = page.images.map((img) => ({ id: foundry.utils.randomID(), ...img }));
        byTimepoint.set(tpId, [...(byTimepoint.get(tpId) ?? []), ...entries]);
      });
      for (const [tpId, entries] of byTimepoint) {
        await fileMediaBatchToTimepoint(group, entries, tpId);
      }
```

Leave the surrounding `try`/`catch`, the `group` resolution above it, and the `ui.notifications.info(… Created …)` / warnings / `this.close()` / `group.sheet.render(true)` below it unchanged.

- [ ] **Step 3: Remove the now-unused `slug`**

The old `const slug = group.name.slugify(...)` line is no longer referenced (uploads go through `uploadHubMedia`, which keys by `group.id`). Delete it.

- [ ] **Step 4: Verify the module parses and unit tests pass**

Run: `node --check scripts/apps/import-wizard.mjs`
Expected: no output.

Run: `npm test`
Expected: PASS — full vitest suite green (import-images + auto-capture + existing).

- [ ] **Step 5: End-to-end verification (Foundry)**

Manual/e2e check against the local Foundry v13 test world (World B). Import a `.docx` that contains: (a) a PNG under a "Session 1 <date>" heading, (b) a JPEG in an intro paragraph before any session, (c) the same PNG referenced twice, and (d) if available, a Word doc with an EMF-pasted image. Confirm:
  - Every renderable image appears **inline** in its imported journal page (regression: on a brand-new world, before any import folder exists).
  - Session 1's timepoint has a "Shared Media – Session 1 …" gallery containing the PNG.
  - The intro JPEG lands in the **first** timepoint's gallery (nearest-preceding backfill).
  - The duplicated PNG appears **once** in its gallery.
  - The EMF image is absent with a single "unsupported type" warning; other images are unaffected.
  - The server has exactly one uploaded file per distinct image (check `campaign-record-media/<group.id>/`).

If a Playwright import spec exists under `tests/e2e/`, run `npm run test:e2e` and extend the import journey to assert a gallery page is created for the session timepoint.

- [ ] **Step 6: Commit**

```bash
git add scripts/apps/import-wizard.mjs
git commit -m "feat(import): file imported images into nearest-preceding timepoint galleries"
```

---

## Self-Review

**Spec coverage:**
- Single upload, two references → Task 5 (`uploadInlineImages` uploads once, returns refs) + Task 6 (refs reused for galleries). ✓
- Defect 1 (directory) → Task 5 routes through `uploadHubMedia`. ✓
- Defect 2 (MIME parse) + transcode + undecodable warning → Task 1 (`parseImageDataUri`/`imageExtension`) + Task 5 (`dataUriToFile` transcode/skip). ✓
- Failure isolation (one bad image doesn't drop all) → Task 5 per-image loop. ✓
- Nearest-preceding assignment → Task 2. ✓
- Batched gallery filing + dedup by src + captions from alt → Task 3 (`mergeGalleryImages`) + Task 4 (`fileMediaBatchToTimepoint`) + Task 5 (caption from `alt`). ✓
- No-timepoints import → inline-only → Task 2 returns all null → Task 6 skips filing. ✓
- Duplicate images across pages under one timepoint → Task 3 dedup + Task 5 within-doc dedup. ✓
- Images in skipped sections never uploaded → unchanged (skip pages carry no html into `plan.pages`). ✓
- Pure/impure split matches repo convention → Tasks 1–3 vitest; Tasks 4–6 e2e/manual. ✓

**Placeholder scan:** none — every code step contains full code; no TBD/TODO.

**Type consistency:** `parseImageDataUri` returns `{mime,subtype,base64}` (Task 1) and is consumed identically in Task 5. `imageExtension(subtype)` used consistently. Gallery `Entry` shape `{id,src,caption}` consistent across Tasks 3/4/6. `uploadInlineImages` returns `{html, images:[{src,caption}]}` (Task 5) and is destructured that way in Task 6. `assignTimepoints(sessionTpIds)` input/output shape consistent between Task 2 and Task 6. `fileMediaBatchToTimepoint(group, entries, timepointId)` signature consistent between Task 4 and Task 6.
