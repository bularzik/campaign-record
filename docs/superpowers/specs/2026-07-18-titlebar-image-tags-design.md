# Title-Bar Image & Tags, Relocated New Entry — Design

**Date:** 2026-07-18
**Status:** Approved (user, 2026-07-18)

## Problem

Image and tag editing for hub records is buried: both render as generic
Foundry `formGroup` fields inside the record body (`common-view.hbs` /
`common-edit.hbs`), visible only when inline editing is on or in manual
edit mode. The image control is a bare file-path field with a small browse
icon — users cannot tell how to add an image. The hero preview
`<img class="record-image">` has no CSS at all and can overflow the pane.
Separately, the New Entry button renders in two places (timeline tools and
record pane header) and the user wants it at the bottom of the left index
pane instead.

## Decisions (user-confirmed)

1. **Image**: thumbnail button in the record pane header; click opens
   FilePicker for editors, ImagePopout for viewers.
2. **Tags**: tag icon button with count badge in the record pane header;
   click opens an anchored popover with chips (× to remove) and an
   add-input.
3. **New Entry**: single full-width button pinned to the bottom of the
   left index pane; removed from the timeline tools and the record pane
   header.

## Design

### 1. Record pane header actions cluster

In `templates/hub/record.hbs`, right of the title, a new
`.record-header-actions` group replaces the current New Entry button and
contains, in order: the image thumbnail button, then the tag button.
Rendered only for module record types — the schemaless journal "text"
page shows neither. Standalone `CampaignHub` and `GroupHubSheet` share
these template parts, so both get the change.

### 2. Image thumbnail button — `data-action="pickRecordImage"`

- ~28px square button showing `system.image`; a placeholder image icon
  when unset.
- Click, by permission:
  - **Editor (`canUpdate`)**: opens Foundry `FilePicker`
    (`type: "image"`, current path preselected). Picking saves
    `system.image` via `page.update()`; header thumbnail, index-row
    thumbnail, and body preview re-render through existing update hooks.
  - **Non-editor, image set**: opens `ImagePopout` full-size.
  - **Non-editor, no image**: button hidden.
- This becomes the sole way to set the image: works in any mode,
  independent of the inline-editing setting.

### 3. Tag button + popover — `data-action="toggleTagPopover"`

- Tag icon with a count badge (hidden at zero).
- Popover anchored under the button: existing tags as chips; editors get
  an × per chip (`data-action="removeTag"`) and an add-input (Enter
  commits). Non-editors can open the popover read-only (no input, no ×).
- Closes on outside click or Esc.
- Tag normalization is a pure helper in `scripts/logic/` (vitest-covered):
  trim, drop blanks, dedupe case-insensitively preserving first-seen
  casing. Storage stays `SetField(StringField)`; search-index behavior
  unchanged.

### 4. Body cleanup (the "move")

- Remove the image and tags `formGroup` rows from
  `templates/partials/common-edit.hbs` and `common-view.hbs`.
- The hero `<img class="record-image">` preview **stays** in the body
  view and gains CSS: max-height cap, `object-fit: contain`, no
  overflow. Only the editing controls move to the bar.

### 5. New Entry relocation

- New `.index-footer` pinned at the bottom of `.hub-index` in
  `templates/hub/index.hbs`, containing one full-width button with the
  existing `newRecord` action (handler `hub-mixin.mjs` `#onNewRecord`
  unchanged).
- Removed from `templates/hub/timeline.hbs` and
  `templates/hub/record.hbs`.
- When the left rail is collapsed, the footer collapses with it; New
  Entry is reachable by expanding the rail (accepted; no collapsed-rail
  icon button — YAGNI).

### 6. Data flow, permissions, errors

- All new actions live in `hub-mixin.mjs` (the header belongs to the hub
  app, not the mounted sub-sheet). Writes go through `page.update()`;
  existing `updateJournalEntryPage` re-render paths handle refresh.
- Permission gating reuses the same `canUpdate` logic as inline editing.
- No schema changes, no migration, no settings.

### 7. Testing

- **Vitest**: tag-normalization helper; any extracted pure logic for
  header context (which buttons render for which type/permission).
- **E2E** (affected specs + smoke only, per the test-tier policy in
  `.claude/skills/foundry-e2e/SKILL.md`):
  - Update `05-hub.spec.mjs` (asserts New Entry in timeline tools and
    pane header, absent from index — all three assertions invert).
  - Update `21-hub-record-pane.spec.mjs` and `22-group-hub-sheet.spec.mjs`
    (both click `.hub-timeline [data-action="newRecord"]` → new selector
    `.hub-index [data-action="newRecord"]`).
  - New coverage (first e2e for tags/base image): tag popover add/remove
    as GM; read-only popover as player; thumbnail visibility/permission
    gating. FilePicker's file-browser UI is not e2e-driven — set
    `system.image` via the update path and assert the header thumbnail
    and index row reflect it.
- Full suite runs only at the next publish gate.

## Out of scope

- Tag facet/filtering in the left index pane (tags remain full-text
  searchable).
- Media type's own `system.images` gallery (unrelated feature, untouched).
- Collapsed-rail New Entry icon button.
