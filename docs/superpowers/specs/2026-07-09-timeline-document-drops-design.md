# Timeline Document Drops — Design

**Date:** 2026-07-09
**Status:** Approved
**Branch:** `feature/timeline-document-drops`

## Goal

Let users drop Foundry documents (world journals and journal pages, actors, scenes,
items) and image/media files onto timeline timepoints in the Campaign Hub, and show
clickable links to those documents on the timeline.

Today the timeline only accepts campaign-record typed pages from the same group
journal, attached via the page's own `system.timepoints` field. Arbitrary documents
and files cannot carry that field, so this feature stores links on the timepoint
side instead.

## Requirements

- Droppable sources: JournalEntry, JournalEntryPage, Actor, Scene, Item documents
  (via Foundry drag data), and image/media files (file browser or OS drop).
- Visibility respects Foundry ownership: a document link is shown only to users
  with at least LIMITED permission on the target. Image files (no ownership) get a
  per-link `showPlayers` flag, default off, GM always sees them.
- Display: links render as chips with a type icon, after the existing record chips
  on each timepoint. A per-user toggle on the Timeline tab switches between icon
  chips and thumbnail mode.
- Editing links requires the same `canEdit` permission the timeline already uses
  for timepoints and record attachment.

## Storage (Approach A — links on the timepoint)

Each timepoint object in the group flag (`flags.campaign-record.<GROUP_FLAG>.timepoints[]`)
gains an optional `links` array:

- Document link: `{ id, uuid, name, type }` — `name` and `type` (document class)
  cached at drop time for rendering before/without resolution and for labeling
  broken links.
- Image link: `{ id, src, name, showPlayers }` — `name` defaults to the filename,
  `showPlayers` defaults to `false`.

`id` is `foundry.utils.randomID()`. A missing `links` array means empty — no
migration and no `schemaVersion` bump needed.

Concurrency: same last-write-wins-on-the-whole-flag model already accepted for
timepoints.

Rejected alternatives: proxy `media` record pages per drop (clutter, confusing
deletion semantics); flags on the linked document (cannot support files, writes to
foreign documents).

## API (`scripts/data/timepoints.mjs`)

- `addLink(group, timepointId, link)` — appends after dedupe: a drop whose `uuid`
  (or `src`) already exists on that timepoint is silently ignored.
- `removeLink(group, timepointId, linkId)`
- `resolveLinks(group, timepoint, user)` — resolves document UUIDs, filters by
  `doc.testUserPermission(user, "LIMITED")` (evaluated at render, never cached),
  applies `showPlayers` gating for image links, and marks dangling links
  (unresolvable UUID) so the hub can render them GM-only.

## Drag & drop (`scripts/apps/hub/campaign-hub.mjs`)

The existing `DragDrop` handler on `[data-drop-timepoint]` widens:

1. Internal payloads (`campaign-record.timepoint`, `campaign-record.record`) keep
   their current behavior, with one change: a campaign-record record from a
   *different* group — today rejected with the "WrongGroup" warning — now attaches
   as a document link. Same-group records keep the existing `system.timepoints`
   path unchanged.
2. Foundry document drag data (`{ type: "JournalEntry" | "JournalEntryPage" |
   "Actor" | "Scene" | "Item", uuid }`) becomes a document link.
3. File drops (drag data with a file path / `text/uri-list`) with an image
   extension (the set Foundry's `ImagePopout` supports) become an image link; the
   drop prompts for `showPlayers` (small confirm, default off). Non-image files
   (video/audio) are out of scope for this version and get the "cannot attach"
   warning.
4. Anything else keeps the existing "cannot attach" warning.

## Rendering (`templates/hub/timeline.hbs`, `hub-data.mjs`)

- Links render after record chips inside the existing `timepoint-records` row.
- Type icons: journal/page = book, actor = person, scene = map, item = suitcase,
  image = image.
- Thumbnail toggle in the Timeline tab header; client-scoped setting persists per
  user. In thumbnail mode, image links and documents exposing an `img` (actors,
  scenes) render as small thumbnails; others stay chips.
- Dangling links render GM-only as struck-through chips with a remove control;
  players see nothing.

## Interactions

- Click document link → `doc.sheet.render(true)`. Click image link → `ImagePopout`.
- Editors get the same ✕ detach control record chips have (calls `removeLink`).
- GM can flip an image link's `showPlayers` from a context (right-click) action on
  the chip.

## Error handling

- Unresolvable UUID at render → GM-only broken chip; players see nothing.
- Unsupported drop payload → existing "cannot attach" notification.
- Flag write failure → existing warn-and-continue pattern.
- Deleting a timepoint removes its `links` with it — no page-side cleanup needed
  for links (unlike record attachments).

## Testing

- Unit (vitest): `addLink` append + dedupe (uuid and src), `removeLink`,
  `resolveLinks` permission filtering, `showPlayers` gating, dangling detection.
- E2E (existing playwright/quench suite): drop an actor and a journal onto a
  timepoint → chips appear and open on click; player without permission does not
  see the link; image link hidden from players until `showPlayers`; thumbnail
  toggle switches modes and persists.
- i18n: all new strings added to `lang/en.json` (repo has an i18n coverage gate).
