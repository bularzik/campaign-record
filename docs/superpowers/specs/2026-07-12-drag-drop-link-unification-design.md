# Fix drag-and-drop; unify timeline attachments on links

**Date:** 2026-07-12
**Status:** Approved (design)

## Problem

Two drag-and-drop defects, and an underlying architectural split they expose.

1. **Dragging a hub record into a Foundry journal pastes raw JSON.** Dropping a
   record (e.g. a Place) inserts
   `{"kind":"campaign-record.record","uuid":"JournalEntry.…JournalEntryPage.…"}`
   instead of a content link like `@UUID[JournalEntry.…JournalEntryPage.…]{Natick}`.

2. **Journal-type records can't be dragged onto the timeline** (other record
   types can). Journal records are core Foundry `text` pages, which lack the
   `timepoints` field, so the index marks them `canAttach: false` and the row is
   never `draggable`.

The root cause of (2) is that the timeline supports **two** attachment models:

- **Record chips** — the record page stores its own `system.timepoints` set of
  timepoint IDs. Requires a custom document subtype with a `timepoints` field, so
  only Campaign Record's own types qualify.
- **Link chips** — an entry `{id, uuid, name, type}` stored on the timepoint
  itself (in the group flag). Works for any document (Actor, Scene, Item,
  cross-group page, image). Cross-group records already use this.

## Decision

Adopt the **link** model for **every** attachment and retire the record-chip
model. All record types — including core `text` journal pages — attach to a
timepoint as links. This fixes bug 2, removes a whole class of type-specific
branching, and leaves one attachment path to reason about.

Accepted trade-off: a record page no longer has reverse awareness of which
timepoints it sits on (the relationship lives on the timepoint). This is
acceptable — records are reference content, and auto-capture's one reverse-lookup
need is served by a small helper.

## Design

### Part 1 — Bug 1: drag payload produces a real content link

In `#onTimelineDragStart` (`scripts/apps/hub/hub-mixin.mjs`), the record branch
adds Foundry's standard document drop shape alongside the existing routing key:

```js
event.dataTransfer.setData("text/plain", JSON.stringify({
  kind: "campaign-record.record",   // internal timeline routing (checked first)
  type: "JournalEntryPage",         // Foundry recognises this + uuid → @UUID link
  uuid: recordRow.dataset.uuid
}));
```

- Foundry's journal (ProseMirror) drop handler reads `type` + `uuid` and inserts
  `@UUID[uuid]{Name}`.
- The timeline's own `#onTimelineDrop` checks `kind` before `classifyDropData`,
  so internal drops are unaffected by the added `type`.

This part is independent and low-risk; it stands even if Part 2 were deferred.

### Part 2 — Unify attachments on links

**Drop handler** (`#onTimelineDrop`): remove the `kind === "campaign-record.record"`
special case that called `attachRecord`. Every document drop — same-group,
cross-group, journal, sidebar — flows through `classifyDropData` →
`#dropLink` → `addLink`. Same-group record drops become links like any other.

**Index rows** (`hub-data.mjs`, `index-row.hbs`): drop the `canAttach` gate. Every
indexed record (including `text` journal pages) is `draggable` and carries the
standard drag payload from Part 1.

**Rendering** (`#timelineGroups`, `timeline.hbs`): remove the `records` array and
the `records` loop. `recordsAtTimepoint` is deleted. The existing `links` loop
renders all attachments.

**Detach**: the `detachRecord` action, its handler `#onDetachRecord`, and
`detachRecord`/`attachRecord` in `timepoints.mjs` are removed. Links are removed
via the existing `removeLink` action.

**`deleteTimepoint`** (`timepoints.mjs`): remove the pass that strips the timepoint
ID from every page's `system.timepoints`. A timepoint's links are stored inside
the timepoint object, so they are deleted with it.

**Callers**:
- `auto-capture.mjs`: `attachRecord(place, tp.id)` → `addLink(group, tp.id,
  {uuid: place.uuid, name: place.name, type: "JournalEntryPage"})`. See reverse
  lookup below.
- `import-wizard.mjs`: the `system.schema.fields.timepoints` guard and
  `attachRecord` call collapse to a single `addLink`.
- `export-dialog.mjs`: `recordsAtTimepoint` → `resolveLinks` so exports include
  attachments.

### Part 3 — Correctness items surfaced by the unification

**3a. Hidden-record visibility (must-fix).** Record chips filter through
`isRecordVisible(user, page)`, which respects the GM-only `hidden` flag. Link
resolution (`displayLink`) only checks Foundry's `LIMITED` permission, which does
not consider `hidden`. Without a fix, a GM-hidden record represented as a link
would leak its name to players.

Fix in `resolveLinks` (`timepoints.mjs`): when a link's document is a Campaign
Record page, gate visibility on `isRecordVisible(user, doc)` in addition to the
existing permission check. Non-record documents keep the current `LIMITED` check.

**3b. Auto-capture reverse lookup.** `auto-capture.mjs` reads
`place.system.timepoints` to find the place's latest existing visit and reuse it.
Replace with a helper in `timepoints.mjs`:

```js
/** Timepoint IDs whose links reference this record uuid. */
export function timepointsForRecord(group, uuid) {
  return getTimepoints(group)
    .filter((tp) => (tp.links ?? []).some((l) => l.uuid === uuid))
    .map((tp) => tp.id);
}
```

`pickLatestTimepoint` then operates on the IDs this returns. Behavior preserved.

### Part 4 — Migration (deprecate-then-remove)

Foundry strips source data for fields absent from the schema before a `ready`-time
migration runs, so the field cannot be both migrated and removed in one release.
Two-step:

**This release (schema v3):**
- `base-record.mjs` **keeps** the `timepoints` `SetField` in the schema, but no
  code writes it (all write paths moved to `addLink`).
- New migration `version: 3` in `MIGRATIONS`: for each group, for each page whose
  `system.timepoints` is non-empty, add a link
  `{uuid: page.uuid, name: page.name, type: "JournalEntryPage"}` to each named
  timepoint (via the dedupe in `withLink`), then clear the page's field
  (`system.timepoints: []`). Idempotent and safe to re-run.
- Bump `SCHEMA_VERSION` to 3.

**A later release:** delete the `timepoints` field definition from
`base-record.mjs` once worlds have migrated. Tracked as a follow-up; not in scope
here. From the user's view the field is already gone — nothing writes or reads it.

### Data / behavior notes

- **Live names**: link chips re-resolve the document each render and display
  `doc.name`, so renames still reflect. Stored `name` is a broken-link fallback —
  same as today.
- **Add permission**: attaching now requires update permission on the *group*
  (enforced in `#dropLink`) rather than on the page. Equivalent in practice for
  same-group records.
- **Ordering**: attachments render in link insertion order within a timepoint.

## Testing

**Unit (vitest):**
- Drag payload shape includes `type: "JournalEntryPage"` + `uuid` + `kind`.
- `resolveLinks` hides a GM-`hidden` Campaign Record page from a non-GM; still
  shows non-record documents by `LIMITED` as before.
- v3 migration: page attachments become timepoint links, deduped; field cleared;
  re-running is a no-op.
- `timepointsForRecord` returns the correct IDs; auto-capture reuses latest visit.
- Update/remove tests referencing `attachRecord`, `detachRecord`,
  `recordsAtTimepoint`, `system.timepoints`.

**e2e (quench / Playwright):**
- Drag a record from the hub into a journal → editor contains `@UUID[…]{Name}`
  and renders a clickable content link.
- Drag a journal-type (`text`) record onto a timepoint → a link chip appears.
- A GM-hidden record attached to a timepoint is not visible to a player client.

## Out of scope

- Deleting the `timepoints` schema field (follow-up release).
- Any change to image links, timepoint reordering, or the record sheets beyond
  removing the detach affordance.
