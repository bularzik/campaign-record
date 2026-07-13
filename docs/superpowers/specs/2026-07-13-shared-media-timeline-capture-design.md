# Auto-capture of shared media onto the timeline — design

**Date:** 2026-07-13
**Status:** Approved (design), pending implementation plan

## Overview

When a GM shows players an image or video via Foundry's native **"Show
Players"** control (the `ImagePopout` share flow), the module automatically
files that media into a rolling **"Shared media" gallery** Media entry and
links it to the **newest timepoint** of the auto-capture target Campaign
Record. Each newest timepoint gets exactly one gallery, which accumulates
every image/video shared while that timepoint is current.

This extends the existing `auto-capture` subsystem (scene activation, combat
start/end) with a third capture source, reusing its target-group resolution,
timepoint helpers, and link mechanism.

## Goals

- Record ad-hoc handouts the GM shows mid-session without manual data entry.
- Keep the timeline tidy: one gallery entry (and one link) per timepoint.
- Honor the literal "attach to whichever timepoint is newest" target.
- Cover both images and videos, since both ride Foundry's `ImagePopout`
  share path.

## Non-goals (v1)

- Audio / "Play for players" — a different socket/playlist path.
- Presenter-overlay playback of captured video (this feature only *files*
  media; presenting it is separate).
- Capturing shares targeted at a subset of users rather than all players.
- Capturing images shared by non-GM users (native share is GM-only anyway).

## Trigger / interception

**Wrap the static `foundry.applications.apps.ImagePopout.shareImage`.**

The GM clicking "Show Players" calls this static method on the sharing GM's
own client. It fires no Foundry hook, and the socket emit does not echo to
the sender, so wrapping the method is the single clean GM-side capture point.

- Register the wrap during `ready`, guarded by `game.user.isGM`.
- The **calling GM** performs the capture. This is naturally single-writer —
  the initiator is already GM-side, so no socket relay is needed (unlike
  combat capture, which relays through the active GM).
- Call the original `shareImage` first (players see the popout exactly as
  today), then run the capture routine from the passed options.
- Read the shared source path and title/caption from the options object, and
  derive the media category (image vs video) from the source extension. Exact
  option key names (`image` / `src`, `title` / `caption`) are confirmed
  against the live Foundry v13 API at implementation time.

**Alternatives considered and rejected:**

- *Socket listener on a player client* — fragile: needs a player online and
  has no clean GM ownership of the write.
- *libWrapper* — adds a dependency the module does not currently carry. A
  plain save-and-reassign wrap that calls the original inside is the norm and
  keeps zero new dependencies.

## Data flow (capture routine)

1. `getTargetGroup()` → if none, no-op.
2. Newest timepoint = last element of `getTimepoints(group)` (already sorted
   ascending by `sort`). If the timeline is **empty**, `addTimepoint(group,
   <date label>)` and use the new timepoint.
3. Locate this timepoint's auto-gallery by scanning the group's pages for a
   `media` page flagged `flags.campaign-record.autoMediaTimepoint ===
   <timepointId>`:
   - **Found** → append the shared source to `system.images`, deduped by
     `src` (skip if already present).
   - **Not found** → create a Media page named
     `"Shared media — <timepoint label>"`, set the
     `autoMediaTimepoint` flag to the timepoint id, seed `system.images` with
     the shared item, then `addLink(group, timepointId, { uuid, name, type:
     "JournalEntryPage" })` so exactly one document-link points at the
     gallery.
4. Each gallery image entry = `{ id: randomID(), src, caption }`, where
   `caption` is the share's title when present, else empty.

## Grouping, dedup, visibility

- **One gallery per timepoint, one link per gallery.** Adding a new timepoint
  (e.g. starting a new session/scene) causes the next share to start a fresh
  gallery automatically — "the newest timepoint" *is* the session boundary.
- **Dedup by `src`** within a gallery: re-showing the same handout does not
  create a duplicate image.
- **Visibility:** the Media page is created player-visible (the normal
  Campaign Record default) because the GM already showed it publicly. The
  timeline entry is a document-link, permission-filtered normally through
  `resolveLinks`. No GM-hidden flag and no `showPlayers` flag are set
  (`showPlayers` applies only to raw image-links, not document-links).

## Empty-timeline behavior

If the target Campaign Record has no timepoints when the GM shares, create a
first timepoint labeled with the **current date** (e.g. `"Jul 13, 2026"`),
attach the gallery to it, and proceed. The timeline is never left with an
orphaned capture. (Rationale for date over `"Session 1"`: scene-activation
capture derives timepoint labels from available context — the scene name — and
a date is the neutral equivalent when no scene context exists.)

## Schema / UI changes for video

- Widen the Media gallery `src` field from `categories: ["IMAGE"]` to
  `categories: ["IMAGE", "VIDEO"]` in `scripts/data/media.mjs`. This is
  backward-compatible; existing image paths remain valid and no migration is
  required.
- The Media sheet gallery template must render `<video>` for video sources
  rather than a broken `<img>`. The media **presenter overlay** is unchanged
  for v1.

## Settings

Add a world-scoped boolean setting **"Auto-capture shared media"**, default
**on**. Shared images are more frequent and more variable than scene/combat
events (a GM might flash an out-of-character image), so a kill-switch is worth
the small cost even though existing auto-capture has no toggle. The capture
routine returns early when the setting is off.

## Testing

- **Unit (vitest)** — pure logic extracted to `logic/auto-capture.mjs`
  alongside existing helpers:
  - pick the newest timepoint overall (not filtered by attachment, unlike the
    existing `pickLatestTimepoint`);
  - append-vs-create gallery decision given the group's flagged media pages;
  - dedup by `src`;
  - derive media category (image vs video) from a source path/extension.
- **E2E (Playwright, per the `foundry-e2e` contract)**:
  - GM shares an image → a Media entry appears, linked to the newest
    timepoint;
  - GM shares a second image → it appends to the same gallery (no second
    entry, no second link);
  - GM adds a timepoint, then shares again → a new gallery entry is created
    and linked to the new timepoint;
  - GM shares a video → captured with the widened category and rendered as
    `<video>`.

## Files touched (anticipated)

- `scripts/logic/auto-capture.mjs` — pure helpers (newest timepoint,
  gallery decision, dedup, category-from-src).
- `scripts/hooks/auto-capture.mjs` — register the `shareImage` wrap and the
  capture routine; ensure-gallery-for-timepoint logic.
- `scripts/data/media.mjs` — widen gallery `src` categories to include VIDEO.
- `scripts/constants.mjs` — `autoMediaTimepoint` flag key and the setting key.
- Media sheet template (gallery) — render `<video>` for video sources.
- Settings registration — the world-scoped toggle.
- `lang/en.json` — setting label/hint, gallery entry name, date-label format.
- Tests under `tests/` (vitest + e2e).
