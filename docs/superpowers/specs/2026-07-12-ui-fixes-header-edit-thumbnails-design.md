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

**Decision:** open entries in an inline-editable view that auto-saves. This
removes the separate full-edit-sheet path, and with it **both** Save buttons.

### C1. Inline editing works reliably
- **Files:** `scripts/apps/hub/base-record-sheet.mjs:44–49`,
  `scripts/logic/inline-edit.mjs`, `scripts/hooks/hub-ui.mjs:56–74`,
  `hub-mixin.mjs:93` (`navigateToRecord` default mode), `:371` (new-record mode).
- Target behavior: opening **any** entry lands in the inline-editable view
  (`common-view.hbs`, `<prose-mirror data-inline-prose>`). Click in, type, and it
  **auto-saves** (inline editing already saves automatically per its setting
  description). The full Foundry edit sheet is never the default path.
- Implementation includes diagnosing why inline editing currently isn't taking
  effect (users land in the full edit sheet instead). Likely area:
  `computeInlineEdit` gating and/or the record-pane open mode.
- New records (`hub-mixin.mjs:371`, currently open in `"edit"`) should also land
  in the inline-editable view for consistency.

### C2. Editor fills the pane and resizes
- **File:** `styles/campaign-record.css:516–522` (currently only scopes
  `--min-height: 8rem` to the inline-edit VIEW path) and `.record-pane-mount`
  (`:605–609`).
- The inline editor grows to fill the available record-pane height and resizes
  with the window (flex-fill + a real min-height), replacing the collapsed
  ~4-line box. Root cause: the edit-mode editor got no `--min-height`.

### C3. Save buttons removed
- Both the button-bar Save and the large bottom Save originate from Foundry
  core's `JournalEntryPageHandlebarsSheet` full edit sheet
  (`scripts/apps/hub/record-pane.mjs`). Because C1 makes the inline-editable view
  the default, the full edit sheet no longer appears in the normal flow, so
  neither Save button renders. Auto-save replaces them. **(Confirmed with user.)**

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
7. Opening any entry (existing or new) lands in an inline-editable view that
   auto-saves; the full Foundry edit sheet and both Save buttons never appear in
   the normal flow.
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
