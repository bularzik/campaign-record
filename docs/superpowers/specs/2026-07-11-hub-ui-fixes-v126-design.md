# Hub UI fixes — v1.2.6

## Overview

A batch of seven small UI fixes for the Campaign Record module, spanning the
Hub (index list, timeline, record view), the import wizard, and the place/
encounter record sheets. They ship together on one branch → one PR → a v1.2.6
bump.

The fixes are independent of each other except for a shared prerequisite
(a doctype→icon map) used by #4, #5, and #6.

## Shared prerequisite: doctype→icon map

Add a single source of truth mapping each record kind to a Font Awesome icon,
so index rows, the left-pane index, and any future reuse all draw from one
place.

- Define `RECORD_ICONS` in `scripts/constants.mjs`, keyed by short type
  (the `RECORD_TYPES` entries plus `journal`).
- Expose an `icon` field from `toIndexEntry` in `scripts/apps/hub/hub-data.mjs`
  so every index entry carries its doctype icon.

Proposed mapping (tweakable):

| Type | Icon | Type | Icon |
|------|------|------|------|
| npc | `fa-solid fa-user` | shop | `fa-solid fa-shop` |
| pc | `fa-solid fa-shield-halved` | loot | `fa-solid fa-sack-dollar` |
| place | `fa-solid fa-map-location-dot` | media | `fa-solid fa-image` |
| quest | `fa-solid fa-scroll` | checklist | `fa-solid fa-list-check` |
| item | `fa-solid fa-gem` | journal (text) | `fa-solid fa-file-lines` |
| encounter | `fa-solid fa-skull` | | |

## Fix 1 — Import footer: horizontal buttons

**Problem:** The import dialog's footer buttons (Cancel / Back / Create in the
review step) stack vertically instead of sitting side by side.

**Change:** CSS only. In `styles/campaign-record.css`, make the wizard footer a
horizontal flex row:

```css
.import-wizard-app .form-footer {
  display: flex;
  flex-direction: row;
  justify-content: flex-end;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.import-wizard-app .form-footer button { flex: 0 0 auto; }
```

Applies to both wizard steps (source step has one button, review step has
three). No template or logic change.

## Fix 2 — Thumbnail toggle (bug)

**Problem:** The **Toggle thumbnail view** button on the Timeline tab appears to
do nothing.

**Expected behavior (approved):** Clicking the toggle visibly flips timeline
**image links** between their icon and a real image thumbnail. Scope is limited
to image links — record chips are unchanged.

**Approach:** Static inspection found the action registered
(`toggleThumbnails` → `#onToggleThumbnails`), the `timelineThumbnails` client
setting persisting, the `thumb` field computed in `#timelineGroups`, and
`.link-thumb` styled — so the defect is not obvious from reading alone and needs
a live Foundry repro. The implementation phase uses systematic-debugging plus
the e2e harness to reproduce, identify the actual cause, and fix it. "Fixed"
means: with an image link present on a timepoint, toggling the button switches
that link between `<i class="…">` and `<img class="link-thumb">`.

## Fix 3 — Unified doctype filter control

**Problem:** The doctype `<multi-select name="type-filter">` doesn't let a user
deselect a chosen type; deselection only happens via the separate
"Clear filters" button. The user wants the dropdown, the chip display, and
clearing combined into one control.

**Change:** Replace the `<multi-select>` **and** the standalone `.clear-filters`
button with a single `.doctype-filter` control rendered in the index part:

- **Selected types render as removable chips** — each chip shows the doctype
  icon + label + an ✕ that deselects that one type.
- A **"Types ▾" dropdown** lists every doctype (icon + checkbox); checking or
  unchecking adds/removes the type. Deselection therefore works from both the
  chip ✕ and the menu.
- A **Clear** affordance inside the control clears **doctype selections only**
  (approved). Hidden-only keeps its own eye toggle; the group selector keeps its
  own control.

**State:** Continues to drive `this.state.types` (a `Set`). Chip removal, menu
toggles, and clear all mutate that set and re-render the index.

**Retired:** `#onClearFilters` is repurposed to clear doctypes only (or removed
in favor of a doctype-specific handler). The `filtered-count` ("showing X of Y")
indicator stays as-is, gated on any active filter.

**Rejected alternative:** Keep Foundry's native `<multi-select>` and only fix
deselection. Rejected because the user asked for one combined control and a
purpose-built chip+dropdown gives reliable, obvious deselection plus doctype
icons.

## Fix 4 — Remove the group column

**Problem:** The index row shows a column with the entry's campaign-record
(group) name, which the user doesn't need.

**Change:** Delete the `record-group` `<span>` from `templates/hub/index.hbs`,
drop its column from the `.record-row` `grid-template-columns`, and remove the
`.record-group` CSS rules. `groupName` stays in the index data (harmless), just
unrendered in the row.

## Fix 5 — Doctype icon left of the name

**Problem:** The index has a text column naming the doctype; the user wants a
small doctype icon to the left of the entry name instead.

**Change:**

- The row's left cell becomes the **doctype icon** (from `RECORD_ICONS`).
- Remove the separate `record-type` (short-type text) column.
- Per the approved mockup, the doctype icon **replaces** the per-entry portrait
  thumbnail in the list row. Portraits still appear inside the record itself.
- New row grid: `[icon] [name] [subtitle]`.

Updated `.record-row` `grid-template-columns` reflects the removal of both the
type column (#5) and the group column (#4).

## Fix 6 — Full index in the left pane when viewing a record

**Problem:** When viewing an entry, the left pane shows a simplified "rail"
(names grouped by type). The user wants the actual working index there.

**Approved layout:** Left pane = the working index (search, doctype control,
sort, icon+name+subtitle rows) with the current record highlighted; right pane =
the mounted record sheet.

**Change:**

- Extract the index controls + list into a shared partial
  (`templates/hub/index-list.hbs`) used by **both** the Index tab
  (`templates/hub/index.hbs`) and the record view's left pane
  (`templates/hub/record.hbs`).
- In `record.hbs`, replace the `.record-rail` aside with the shared index
  partial. Remove the `#railGroups` method and `.record-rail` markup/CSS.
- The current record is highlighted in the left-pane list; clicking a row opens
  it on the right via the existing `openRecord` → `navigateToRecord` path.
- The open record stays mounted on the right even if the user filters it out of
  the left list.
- The existing rail-toggle continues to collapse the left pane
  (`RAIL_SETTING`).
- Control handlers (`index-search`, `sort-select`, `type-filter`) re-render the
  correct part depending on whether a record is being viewed; search-focus
  restoration is generalized so typing survives whichever location the input is
  in.

**Layout/CSS:** Two-column flex — left index column, right record-pane mount.
The record-pane header (back / forward / edit / rail-toggle / title) stays above
the right pane. Update `.record-pane-body`, `.record-rail`→index-column, and the
`.viewing-record` rules accordingly.

## Fix 7 — Scene picker for regular users

**Problem:** Scenes are linked on **place** and **encounter** sheets
(`system.scene`) by dropping a Scene onto the drop zone, but core gates
Scene-dragging out of the sidebar to GMs, so regular users can't link scenes.
This is the same gap the actor picker already fills for Actors.

**Change (mirror the actor-picker pattern):**

- New `scripts/apps/scene-picker.mjs` exporting `promptSelectScene()` — a
  `DialogV2` `<select>` of scenes the current user can see, resolving to the
  scene UUID or `null` on cancel. Twin of `promptSelectActor()`.
- Add a generic `linkScene` action to `BaseRecordSheet` (alongside `linkActor`)
  that calls `promptSelectScene()` and feeds the result into the existing
  `_onDropDocument({ type: "Scene", uuid })`. It is a no-op on sheets that don't
  accept Scene drops.
- Add a **"Link Scene"** button (icon `fa-solid fa-link`) next to the scene
  field in the `place` and `encounter` **view + edit** templates, mirroring how
  the "Link Actor" button sits on pc/npc sheets. Drag-drop still works for GMs;
  the button is the drag-free path, shown to everyone.
- New localization keys `CAMPAIGNRECORD.LinkScene` and
  `CAMPAIGNRECORD.SelectScene`; reuse the existing `Link` label.

This fix touches record sheets, not the hub, and is independent of #1–#6.

## Testing

- **vitest:** the `RECORD_ICONS` map coverage (every `RECORD_TYPES` entry plus
  `journal` has an icon), the doctype-control state logic (chip removal, menu
  toggle, clear resets only `state.types`), and `promptSelectScene` selection
  wiring where unit-testable.
- **e2e (Playwright + Foundry):** the thumbnail-toggle repro (#2) and the
  left-pane index interaction (#6 — open a record, confirm the index shows in
  the left pane, filter/search works, clicking a row swaps the right pane).

## Scope & delivery

- One branch, one PR, version bump to **v1.2.6**.
- Trivial: #1, #4, #5. Real work: #3, #6. Runtime bug hunt: #2. Isolated
  parallel-pattern add: #7.
