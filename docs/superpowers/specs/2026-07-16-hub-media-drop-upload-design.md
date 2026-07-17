# Hub Media Drag-and-Drop Upload — Design

**Date:** 2026-07-16
**Status:** Approved for planning

## Summary

Dragging an image or video file (from the OS) onto the Campaign Hub uploads it
to the Foundry server, then attaches it based on context:

1. **Dropped on a specific timepoint row** → upload, then attach to *that*
   timepoint as an image link (unifies with existing timeline drops, which
   today only accept files that already have a server path).
2. **A media entry is open in the record pane** (view or edit mode, and the
   user can modify it) → upload, then append to that entry's `images` array.
3. **Otherwise** (nothing open, a non-media record open, or an unmodifiable
   media entry open) → upload, then append to the per-timepoint **shared
   auto-gallery** on the newest timepoint — the same gallery the Show-Players
   auto-capture feature uses (`AUTO_MEDIA_FLAG` conventions), creating the
   gallery and, if the timeline is empty, a date-labeled timepoint.

Available to any user who can edit the group (`group.canUserModify(user,
"update")`) and who has Foundry's `FILES_UPLOAD` permission. Non-GM writes to
the GM-owned auto-gallery are relayed to the active GM over the existing
auto-capture socket.

## Architecture (Approach A: extend existing DragDrop pipeline)

One drop pipeline, not two. The hub's existing
`foundry.applications.ux.DragDrop` instance (`scripts/apps/hub/hub-mixin.mjs`,
`_onRender`) gains a second drop selector covering the hub window content
alongside the current `[data-drop-timepoint]` rows. A single shared drop
handler inspects the event target: a drop landing on a timepoint row routes to
that timepoint; anything else is a hub-wide drop.

### Components

| Unit | Location | Responsibility |
|---|---|---|
| Drop wiring & highlight | `scripts/apps/hub/hub-mixin.mjs` | Widened drop selector; dragover/dragleave CSS class toggle for a subtle highlight (border/tint, no full overlay); dispatch to routing + attach. |
| Classification | `scripts/logic/timeline-links.mjs` (`classifyDropData`) | New payload kind `files` from `dataTransfer.files`, filtered to image/video MIME types/extensions (consistent with `FilePathField` categories `IMAGE`/`VIDEO` and `isVideoSrc`). Non-media files are skipped with a warning naming them. Existing payload kinds (documents, existing-path images, uri-list) are untouched. |
| Routing (pure) | `scripts/logic/media-drop.mjs` (new) | `resolveDropTarget({ viewedPage, droppedOnTimepointId, canModifyPage })` → `{kind:"timepoint", id}` \| `{kind:"media-entry", uuid}` \| `{kind:"auto-gallery"}`. Precedence: explicit timepoint row > open modifiable media entry > auto-gallery. No Foundry globals; fully unit-testable. |
| Upload | `scripts/apps/hub/media-upload.mjs` (new) | `uploadHubMedia(group, file)`: ensure `campaign-record-media/<group-slug>/` exists in the `data` source (browse-then-createDirectory, per the import-wizard pattern), upload with a timestamp-prefixed sanitized filename (`<epoch>-<original-name>`) so same-named files never overwrite. Returns the stored path. |
| Attach: media entry | hub drop handler | Append `{id, src, caption: ""}` to the page's `images` array (same shape as `MediaSheet.#onAddImage`); the mounted pane sheet re-renders via the normal document-update flow. Requires `page.canUserModify`; if not modifiable, routing has already fallen back to auto-gallery. |
| Attach: timepoint | existing `addLink` (`scripts/data/timepoints.mjs`) | Image link `{id, src, name, showPlayers: false}`; dedup by src already handled. |
| Attach: auto-gallery | existing auto-capture primitives (`scripts/logic/auto-capture.mjs`, `scripts/hooks/auto-capture.mjs`) | `pickNewestTimepoint` (creating a date-labeled timepoint if the timeline is empty, exactly as the shared-media-capture spec does), `findAutoGallery`/create with `AUTO_MEDIA_FLAG`, `appendGalleryImage`, document link from timepoint to gallery. No parallel implementation. |
| GM relay | existing auto-capture socket | For non-GM users on the auto-gallery path, the attach step (not the upload) is relayed to the active GM with `{groupUuid, src, name}`; the GM client runs the same attach code. |

### Data flow

```
drop event
  → classifyDropData → media files[] (skip+warn non-media)
  → permission gate (group edit + FILES_UPLOAD)     — warn & abort if failed
  → resolveDropTarget (once per drop)
  → for each file, sequentially:
      uploadHubMedia → stored path
      attach per target (direct, or GM relay for non-GM auto-gallery)
      ui.notifications.info("… added to <target name>")
```

Multi-file drops: all files classify → upload → attach sequentially through
the same resolved route, so a burst of files lands in one place. Gallery dedup
by src is inherited from `appendGalleryImage`.

## Permissions

- Drop accepted only if `group.canUserModify(game.user, "update")`; otherwise
  a warning notification and nothing is uploaded.
- Foundry `FILES_UPLOAD` permission is checked before touching the server;
  warn and abort if absent.
- Open media entry append additionally requires `page.canUserModify`; failing
  that, the drop falls back to the auto-gallery route rather than failing.
- Auto-gallery attach by non-GMs goes over the GM relay. If no GM is
  connected: warn ("a GM must be online to file dropped media") and skip the
  attach — the uploaded file stays on the server and its path is included in
  the warning so it isn't lost.

## Error handling

Every failure surfaces as a notification and never leaves state worse than
"file uploaded but unattached":

- Upload failure → error notification, skip that file, continue with the rest.
- Attach failure after upload → error notification including the uploaded
  path.
- No group resolvable in the hub context → warn and ignore the drop.
- Non-media file in the drop → warning naming the file; other files proceed.

## Testing

**Unit (vitest, pure logic):**
- `media-drop.mjs` routing table (all precedence branches).
- Filename timestamp-prefixing and sanitization.
- MIME/extension media filtering.
- Extended `classifyDropData` cases (files present, mixed media/non-media,
  existing payload kinds unaffected).

**E2E (playwright, per the `foundry-e2e` contract):** one new numbered spec.
Simulate drops via `page.evaluate` dispatching a synthetic drop event carrying
a constructed `File`; assert:
1. Append to an open media entry.
2. Auto-gallery creation + newest-timepoint document link when nothing is
   open (and timepoint auto-creation on an empty timeline).
3. Timepoint-row drop attaches an image link to that specific timepoint.

Uses the existing name-prefix + `afterAll` cleanup pattern.

## Decisions & consistency notes

- **Reuse over parallel code:** the auto-gallery path must converge on the
  shared-media-capture implementation (`2026-07-13-shared-media-timeline-capture-design.md`)
  — same flag, same gallery-per-timepoint rule, same link conventions.
- **Classification contract:** extends, not bypasses, the drag-drop link
  unification contract (`2026-07-12-drag-drop-link-unification-design.md`).
- Upload destination: `campaign-record-media/<group-slug>/` under the `data`
  source.
- `showPlayers` defaults to `false` for timepoint image links (matches
  existing drops).
- Drops of non-file payloads (documents, uri-list) on timepoint rows keep
  their existing behavior; the hub-wide zone only acts on media files.
