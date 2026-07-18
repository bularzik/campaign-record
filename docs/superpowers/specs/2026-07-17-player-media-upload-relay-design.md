# Player Media Upload via GM Relay + Record-Pane Mount Race Fix — Design

**Date:** 2026-07-17
**Status:** Approved for planning

## Problem

When a non-GM player without Foundry's `FILES_UPLOAD` permission imports a
docx containing images, every image upload fails with `Target directory
campaign-record-media/<groupId> does not exist`, and the images are silently
dropped. Root cause: `uploadHubMedia`
(`scripts/apps/hub/media-upload.mjs`) swallows `createDirectory` permission
failures with `.catch(() => {})`, then `FilePicker.upload` fails against the
never-created directory. The import path is gated only on `JOURNAL_CREATE`
(`hub-mixin.mjs`) and never checks `FILES_UPLOAD` — unlike the drag-drop path,
which blocks players outright with "You lack permission to upload files to the
server."

Separately, the import's burst of create/update hooks triggers overlapping
hub renders; `hub-mixin.mjs` `_onRender` calls `RecordPane.mount()`
fire-and-forget with no reentrancy guard, so one mount re-parents a sheet
(`record-pane.mjs` `container.replaceChildren`) while another render has a
ProseMirror editor mid-initialization, destroying the editor under it
(`replaceWith`/`matchesNode` null crashes). This reproduces for any
import-driven render storm, GM or player.

## Summary

1. **GM upload relay:** players without `FILES_UPLOAD` can still add media
   (docx import images and hub drag-drop) whenever a GM is online — the file
   bytes are relayed over the module socket and the active GM client performs
   the validated upload.
2. **One shared upload entry point** used by both the import wizard and the
   hub drop handler: direct upload if permitted, relay if a GM is online,
   otherwise a clear "images skipped — no GM online" warning.
3. **Serialized `RecordPane.mount`** so overlapping renders can never tear
   down a live editor.

## Architecture

### Components

| Unit | Location | Responsibility |
|---|---|---|
| Relay protocol | `scripts/hooks/media-relay.mjs` (new) | `UPLOAD_MEDIA` request/response actions on the existing `module.campaign-record` socket (same raw-socket pattern as `auto-capture.mjs`). Request: `{action, requestId, groupId, name, type, data(base64)}`. Response: `{action, requestId, path}` or `{action, requestId, error}`. Player side awaits its `requestId` with a 30 s timeout. |
| GM handler | `scripts/hooks/media-relay.mjs` | Only `game.users.activeGM === game.user` acts. Validates before touching disk: `groupId` must resolve to an existing campaign-record group journal; MIME must pass the same image filter the import already uses; decoded size ≤ 10 MB. On success, decodes to a `File` and calls the existing `uploadHubMedia`, then replies with the stored path. |
| Upload entry point | `scripts/apps/hub/media-upload.mjs` | `uploadHubMediaAsUser(group, file)`: `game.user.can("FILES_UPLOAD")` → direct `uploadHubMedia`; else `game.users.activeGM` present → relay; else throw a typed "no GM online" error the callers surface as a warning. Also: stop swallowing `createDirectory` failures silently — log them so future failures are diagnosable. |
| Import wiring | `scripts/apps/import-wizard.mjs` | `uploadInlineImages` calls `uploadHubMediaAsUser`. At wizard start, if the user lacks `FILES_UPLOAD` **and** no GM is online, warn up front that images will be skipped (text import proceeds regardless). |
| Drop wiring | `scripts/apps/hub/hub-mixin.mjs` | `#onMediaFilesDrop` gate becomes: allowed if `game.user.can("FILES_UPLOAD")` **or** an active GM is present; only warn-and-block when neither holds (new i18n string alongside `DropCannotUpload`/`DropNoGM`). Uploads go through `uploadHubMediaAsUser`. |
| Mount serialization | `scripts/apps/hub/record-pane.mjs` + `hub-mixin.mjs` | `mount()` calls chain on a private promise queue with a monotonically increasing token; a queued mount that is stale by the time it runs (a newer mount was requested) exits before touching the DOM. `_onRender` chains onto the queue (still `.catch`-guarded) instead of firing blind. |

### Data flow (player without upload permission, GM online)

```
docx import / hub drop
  → uploadHubMediaAsUser(group, file)
      → no FILES_UPLOAD, activeGM present
      → base64-encode file, emit UPLOAD_MEDIA {requestId, groupId, name, type, data}
  GM client:
      → validate group / MIME / size          — reject reply on failure
      → uploadHubMedia(group, decodedFile)    — existing directory + rename logic
      → reply {requestId, path}
  player client:
      → resolve with path (or reject on error / 30 s timeout)
  → caller attaches path exactly as a direct upload would
```

### Trust model

Module sockets have no authenticated sender (documented caveat in
`presenter/socket.mjs`), so the GM handler treats every request as untrusted:
uploads land only under `campaign-record-media/<groupId>` for a group that
actually exists, only image MIME types are accepted, and payloads over the
size cap are rejected. The GM client never writes a caller-supplied path.

### Socket payload size

Foundry's socket transport has a message size limit; a single base64 message
must be verified against it on the local v13 install during implementation.
If large images can't fit one message, the relay chunks the base64 body into
sequence-numbered parts reassembled GM-side before validation; otherwise a
single message with the 10 MB cap suffices. The protocol shape above is
unchanged either way — chunking is an internal transport detail of
`media-relay.mjs`.

## Error handling

- Per-image semantics are unchanged from today: a failed or timed-out relay
  removes that `<img>` and aggregates into the existing import warning; the
  import never fails wholesale over images.
- Drag-drop relay failure → error notification for that file, remaining files
  continue (matches existing per-file behavior).
- Relay with no GM online is prevented up front by `uploadHubMediaAsUser`'s
  gate; the mid-flight case (GM disconnects) surfaces as a timeout failure.
- GM-side validation rejections reply with a reason string the player sees in
  the notification.

## Testing

**Unit (vitest, pure logic):**
- Relay request validation (group resolution, MIME filter, size cap, path
  confinement) as pure helpers.
- `uploadHubMediaAsUser` routing (direct / relay / no-GM error) with stubbed
  globals.
- Mount queue: overlapping calls serialize; stale mounts no-op; errors don't
  wedge the queue.

**E2E (playwright, per the `foundry-e2e` contract, World B):**
1. Player (no `FILES_UPLOAD`) imports a docx with images while a GM client is
   connected → images upload and appear inline + in timepoint galleries.
2. Same import with no GM online → clean warning, text imports fine, no
   console errors.
3. Player drag-drops an image onto the hub with a GM online → media attaches
   via relay.
4. Large-doc import → no ProseMirror `replaceWith`/`matchesNode` console
   errors (mount race regression check).

## Decisions & consistency notes

- The relay carries **file bytes for upload**; the existing auto-capture
  media-drop relay (`auto-capture.mjs`) continues to handle the *document
  write* step unchanged. The two compose: player upload-by-relay, then
  player-or-relay attach as today.
- `DropCannotUpload` messaging is reserved for the no-permission-and-no-GM
  case; wording updated to say a GM must be online.
- Size cap 10 MB per image; oversized images are skipped with a warning
  naming the file, import continues.
- No socketlib dependency — stays on the raw module socket like every other
  handler in the codebase.
