# Docx image import → inline + timepoint media galleries

**Date:** 2026-07-17
**Status:** Approved design, ready for implementation planning

## Problem

Importing a `.docx` currently fails to bring in any of its images. Two
independent defects in the image path both end the same way — the `<img>` is
removed from the HTML and an "images dropped" warning is shown:

1. **Directory creation (breaks every import).** `uploadDataUriImages()`
   (`scripts/apps/import-wizard.mjs`) creates its upload folder in a single
   call: `createDirectory("data", "campaign-record-imports/<slug>")`. Foundry's
   `createDirectory` is **not recursive**, so on any world where the
   `campaign-record-imports` parent does not yet exist the call throws. The
   throw lands in a catch-all that deliberately removes *every* image. Because
   nothing else ever creates that parent, this fails on the first import into a
   world and keeps failing. The newer drag-drop code (`media-upload.mjs`) hit
   exactly this and works around it with an explicit parent-first create and the
   comment *"Parent first: createDirectory is not recursive."*

2. **MIME regex (drops Word's common image types).** `dataUriToFile()` matches
   the data-URI with `/^data:(image\/(\w+));base64,…/`. `\w` excludes `-` and
   `+`, so `image/x-emf`, `image/x-wmf`, and `image/svg+xml` never match and the
   image is removed. Word frequently stores pasted pictures as EMF/WMF
   metafiles, so even after defect 1 is fixed, a document full of pasted images
   can still import with nothing.

Neither path has test coverage.

## Goal

Make docx image import work, and route the same images into per-timepoint media
galleries so they appear both in the journal prose and on the timeline —
**uploading each image to the server only once.**

## Approved behavior

- Every imported image is uploaded exactly once and referenced twice: it stays
  **inline** in its journal page, and it is added to the **media entry of the
  timepoint it belongs to**.
- **Timepoint assignment (nearest-preceding):** an image in a session section
  goes to that session's timepoint; an image in any other section goes to the
  nearest session above it in document order; images preceding all sessions go
  to the first timepoint.
- **Trigger:** automatic on every import. No new UI.
- If an import produces **no timepoints at all**, images are inline-only (there
  is nowhere to file them).

## Architecture: single upload, two references

The import creation flow (`ImportWizard.#onCreate`) changes to upload each
distinct data-URI once and thread the returned server path into both the inline
`<img src>` and the timepoint gallery.

1. **Upload pass** (per page, after the group is resolved/created): for each
   inline `<img src="data:…">`, convert the data-URI to a `File`, upload it via
   the existing `uploadHubMedia(group, file)` — which lands in
   `campaign-record-media/<group.id>` and already does parent-first directory
   creation (**this fixes defect 1 for free**) — rewrite the inline `src` to the
   returned path, and record `{ src, caption }` for that page. Identical
   data-URIs within one document are cached so a repeated image uploads once.
2. **Create pages** from the plan (unchanged).
3. **Create timepoints** for session pages and link page→timepoint (unchanged),
   capturing the created timepoint ids in document order.
4. **File galleries:** group the recorded `{ src, caption }` refs by their
   governing timepoint (via the nearest-preceding assignment) and write each
   timepoint's gallery **once**, reusing the same `src` paths — no second
   upload.

### Defect fixes folded in

- **Defect 1 (directory):** eliminated by routing uploads through
  `uploadHubMedia` instead of the bespoke non-parent-first logic.
- **Defect 2 (MIME parse):** replace the `image\/(\w+)` regex with a robust
  data-URI parser (mediatype up to `;base64,`, proper subtype→extension map).
  Web-native types (png/jpeg/gif/webp) upload as-is; decodable-but-non-native
  types (bmp/tiff) transcode to PNG via the same `createImageBitmap` +
  `OffscreenCanvas` approach the export path uses
  (`scripts/apps/export-dialog.mjs`). Genuinely undecodable types
  (EMF/WMF/SVG-blob) are dropped **with a per-image warning naming the type**,
  not silently.
- **Failure isolation:** today one directory error removes *every* image.
  Per-image handling means a single undecodable EMF no longer kills the good
  PNGs alongside it.

## Timepoint assignment (pure)

`assignTimepoints(pages, createdTimepointIds)` — a pure function, unit-tested
with no Foundry globals. Walking pages in document order, track the current
session's timepoint id; each page's images are governed by that id. Pages
before the first session are backfilled to the first timepoint. Returns, per
page, the governing timepoint id (or null when the import has no timepoints).

## Gallery filing

Reuse the model of the existing `fileMediaToTimepoint` primitive
(`scripts/hooks/auto-capture.mjs`): the per-timepoint "Shared Media – *label*"
gallery page flagged with `AUTO_MEDIA_FLAG`, deduped by `src`. Imported images
land in the **same** gallery as drag-dropped and show-to-players media for that
timepoint.

- **Batched writes:** build each timepoint's full image list and create-or-update
  its gallery page **once** (rather than one page write per image).
- **Dedup:** by `src`, so the same image appearing across multiple pages under
  one timepoint is stored once (existing `appendGalleryImage` semantics).
- **Captions:** default to the image's `alt` text if present, else empty.

## Module boundaries & testing

Matches the existing split (`doc-import.mjs`/`doc-import.test.js`,
`media-drop.mjs`/`media-drop.test.js`):

- **Pure / unit-tested (vitest, no globals):** the data-URI parser, the
  nearest-preceding `assignTimepoints`, and the per-timepoint dedup/merge of
  image lists.
- **Foundry-touching I/O (e2e / manual):** upload via `uploadHubMedia`, gallery
  page create/update, transcode. Kept in thin wizard/adapter code.

## Edge cases

- **No timepoints in the import** → images inline-only; no galleries created.
- **Duplicate images** across pages under one timepoint → deduped by `src`.
- **Undecodable image type** (EMF/WMF/SVG-blob) → per-image warning, other
  images unaffected.
- **Images in skipped sections** → never uploaded (page not created).
- **Repeated identical data-URI in one document** → uploaded once, path reused.

## Out of scope

- Changes to the export round-trip.
- New import-wizard UI or per-section image controls.
- Server-side transcoding of EMF/WMF (no browser decoder exists; these are
  reported and skipped).
