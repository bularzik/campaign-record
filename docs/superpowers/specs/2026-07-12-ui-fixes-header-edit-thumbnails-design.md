# Campaign Record — UI fixes: header, editing, thumbnails

**Date:** 2026-07-12
**Status:** Approved (design)

## Summary

A batch of UI fixes to the Campaign Record journal sheet (`GroupHubSheet`) and
the standalone hub (`CampaignHub`), both built from `scripts/apps/hub/hub-mixin.mjs`.
The work groups into four areas: header/window chrome, filter/sort controls, the
inline editing experience, and making thumbnail display the standard everywhere.

The sheet is a custom ApplicationV2 hub, not a stock `JournalSheet`. All UI logic
lives in `hub-mixin.mjs`; templates are in `templates/hub/`; the single stylesheet
is `styles/campaign-record.css`.

## A. Header & window chrome

### A1. Header layout — name left, gear right
- **File:** `templates/hub/header.hbs`, CSS `styles/campaign-record.css:31–41` (`.hub-header`).
- `.hub-header` becomes a flex row with `justify-content: space-between`.
- **Left:** the campaign-record name.
  - On `GroupHubSheet` (journal-backed): render the group/journal name.
  - On the standalone `CampaignHub`: the existing `<select name="group-select">`
    stays on the left (it already identifies the active group).
- **Right:** the settings gear menu (`.hub-settings-menu`), right-justified.

### A2. Window title → "Campaign Record"
- **File:** `scripts/apps/hub/group-hub-sheet.mjs` (DEFAULT_OPTIONS, lines 7–13).
- Add a `get title()` override returning the localized "Campaign Record".
- Root cause of the current "Journal Entry: <name>": `GroupHubSheet` omits a
  `title`, so it inherits Foundry core's `DocumentSheetV2#title` getter
  (`<DocumentClassLabel>: <name>`). The record name still appears in the header
  row (A1), so the window title stays generic.

### A3. Move "Snippets" into the settings menu
- **From:** `templates/hub/index.hbs:31–35` (`.snippets-toggle` in `.index-controls`).
- **To:** the `.hub-settings-panel` in `templates/hub/header.hbs`, styled like the
  existing "Toggle inline editing" entry (header.hbs:26–30).
- Handler (`hub-mixin.mjs:519–523`, `#onToggleSnippets`) and setting
  (`SNIPPETS_SETTING`) are unchanged; only the markup relocates.

## B. Filter & sort controls

### B1. Fix the types dropdown contrast
- **File:** `styles/campaign-record.css:63–90` (`.doctype-menu`).
- Current bug: line ~74 sets a light background fallback
  (`var(--color-bg-option, var(--color-bg, #e8e6dc))`) with no explicit text
  color, so inherited light text renders white-on-white.
- Fix: give `.doctype-menu` the same dark background + explicit light text color
  used by the settings panel (`.hub-settings-panel`, css:703), so options are
  legible.

### B2. Sort becomes an icon popup, right of the types dropdown
- **Files:** `templates/hub/index.hbs:36–40`; `hub-mixin.mjs:649–653` (options),
  `hub-mixin.mjs:718–725` (change handler).
- Replace the native `<select name="sort-select">` with a **sort icon button**
  (collapsed state) placed **to the right of the types dropdown** in the index
  controls.
- Clicking opens a small popup menu with the existing options (Name / Type /
  Updated), mirroring the `.doctype-filter` popup pattern (index.hbs:9–27).
- Selecting an option sets `state.sort` and re-renders the index part, exactly as
  today. Add popup open/close state (like `state.typeMenuOpen`) and an
  outside-click close (mirror `hub-mixin.mjs:733–741`).

### B3. Remove "Show hidden entries only"
- **File:** `templates/hub/index.hbs:41–46` and all references:
  action registration `hub-mixin.mjs:45`, state field `:74`, filter application
  `:290`, handler `:384–387`, clear-filters `:389–394`, `hasActiveFilters` `:641`,
  `#otherGroupMatches` `:315`, CSS `:132–135`, label `lang/en.json:54`.
- Delete the button and every reference so no dead state remains.

## C. Editing experience

**Decision:** typed entries open in an inline-editable view that auto-saves; the
manual "edit mode" (Foundry's full edit sheet, with its two Save buttons and
4-line box) is no longer offered for those entries.

**Diagnosis (from code trace).** Inline editing is *not* broken. For the normal
case (a module record page, inside a group journal, viewed by a user who can
update it, with the default-on `inlineEditing` setting), the view already renders
as an always-open auto-saving editor with **no** Save buttons. Users land in the
full edit sheet only because the module still *offers* an edit path: a pen
"edit-toggle" button in the pane header (`record.hbs:10–16` → `#onToggleEditMode`)
shown whenever the user can update — independent of inline-editability — plus new
records opening in `mode: "edit"` (`hub-mixin.mjs:371`). The two Save buttons are
Foundry core's edit-mode footer submit + the ProseMirror menu Save; they exist
only in `mode: "edit"`, so this is a *mode* problem, not CSS.

**Nuance — do not regress text pages.** Only module record types
(`campaign-record.*`) use `BaseRecordSheet` and therefore have an inline-editable
view. Core **text/journal** pages have no inline path, and users may also turn
`inlineEditing` off. For those cases the edit-toggle must remain, or the entry
becomes uneditable in the hub. So: **hide the edit-toggle only when the current
view is genuinely inline-editable**; keep it otherwise.

### C1. Inline view is the default; edit-toggle hidden when redundant
- **Files:** `scripts/apps/hub/hub-mixin.mjs` (`:371` new-record mode; `_prepareContext`
  `view` block `:675–681`), `templates/hub/record.hbs:10–16` (edit-toggle),
  `scripts/logic/inline-edit.mjs` (add a pure `shouldShowEditToggle` helper),
  `scripts/sheets/base-record-sheet.mjs:44–49` (reference for the inline predicate).
- New records open in **view** mode (`navigateToRecord(page.uuid)` — drop
  `{ mode: "edit" }`). With inline editing on, the view is immediately editable.
- The pane's edit-toggle renders only when the view is **not** inline-editable —
  i.e. hidden for a `campaign-record.*` page in a group journal with inline
  editing on and update permission (the default typed-entry case), shown for text
  pages, inline-off, or already-in-edit-mode (as the "Done editing" toggle).
- The `toggleEditMode` action/handler stays (it still serves text pages and
  inline-off); only its visibility gate changes.

### C2. Editor fills the pane and resizes
- **File:** `styles/campaign-record.css:516–522` (currently scopes
  `--min-height: 8rem` to the inline-edit view path only) plus `.record-pane-mount`
  (`:605–609`) and the two-pane record cell (`.hub-record.active`, `:561–568`).
- Establish a flex-column height chain from `.record-pane-body` →
  `.record-pane-mount` → the mounted view sheet → `.campaign-record-content.inline-edit`
  so the description editor grows to fill the pane and resizes with the window,
  replacing the fixed short box.

### C3. Save buttons gone in the normal flow
- Consequence of C1: for the default typed-entry case there is no edit-toggle,
  so `mode: "edit"` (and thus core's footer Save + ProseMirror menu Save) is never
  reached. Auto-save replaces them. The buttons still exist in core's edit sheet,
  which is only reachable now for text pages / inline-off — where a Save button is
  the expected affordance. **(Direction confirmed with user; text-page/inline-off
  retention is an implementation-driven refinement — flagged for review.)**

## D. Thumbnails as the standard display

**Decision:** thumbnails are always on; the toggle and its setting are removed.

### D1. Entry list shows thumbnails
- **Files:** `templates/hub/index-row.hbs`, `styles/campaign-record.css` (row
  styles ~`:191`).
- Each row in the left index renders its entry image as a thumbnail, with a
  sensible fallback icon when an entry has no image.

### D2. Timeline thumbnails fixed
- **Files:** `templates/hub/timeline.hbs:46`, `hub-mixin.mjs:396–419`
  (`#timelineGroups`, image population at `:411–414`), CSS `.link-thumb` `:271`.
- Timeline link chips render image thumbnails reliably. Fix the image-population
  gap (`entry.img` / `resolveLinks`) so chips that have an image actually show it
  instead of the generic icon. `.link-thumb` is already styled.

### D3. Remove the toggle
- **Files:** `templates/hub/timeline.hbs:8–12` (button), `hub-mixin.mjs:507–511`
  (`#onToggleThumbnails`), action registration `:55`, setting
  `THUMBNAILS_SETTING` in `scripts/constants.mjs:48–49` and `hub-ui.mjs:35–40`,
  label `lang/en.json:76`.
- Delete the "Toggle thumbnail view" button and the `timelineThumbnails` setting;
  thumbnail rendering (D1, D2) is always on.

## Acceptance criteria

1. Header shows the campaign-record name left-justified and the settings gear
   right-justified in the same row.
2. Window title reads "Campaign Record" (no "Journal Entry:" prefix).
3. The Snippets option appears only inside the settings (gear) menu.
4. The types dropdown menu is legible (no white-on-white).
5. Sort is a single icon to the right of the types dropdown that opens a popup;
   selecting Name/Type/Updated re-sorts the list.
6. There is no "Show hidden entries only" control anywhere, and no dead references.
7. Opening a typed entry (existing or new) lands in an inline-editable view that
   auto-saves; no edit-toggle, edit sheet, or Save buttons appear for it. The
   edit-toggle still appears for text pages and when inline editing is off.
8. The editor fills the record pane and grows/shrinks with the window (not a
   fixed ~4-line box).
9. Entry rows show image thumbnails (with fallback), and timeline chips with an
   image show that image.
10. There is no "Toggle thumbnail view" control and no `timelineThumbnails`
    setting.

## Out of scope

- Any redesign of the record content templates beyond thumbnail rendering and
  editor sizing.
- Changes to auto-capture, import/export, or search behavior.
- Reworking the standalone `CampaignHub` group-select beyond keeping it on the
  left of the header row.
