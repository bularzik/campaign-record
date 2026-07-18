# Campaign Record Changelog

All notable changes to this project are documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] - 2026-07-18

### Added

- Player media uploads via GM relay + record-pane mount race fix (#31)

## [1.6.0] - 2026-07-17

### Added

- New-creation defaults: alphabetized entry types, world-time timepoints (#30)

## [1.5.0] - 2026-07-17

### Added

- **Import:** Bring docx images inline and into timepoint galleries (#28)

### Fixed

- Fix journal edit flicker/freeze; make journals inline-editable (#29)

## [1.4.0] - 2026-07-17

### Added

- Auto-generated CHANGELOG from conventional commits (#26)

## [1.3.0] - 2026-07-17

### Added

- Drag-and-drop media upload onto the Campaign Hub (#25)

## [1.2.18] - 2026-07-14

### Fixed

- **Release:** Package vendor/ bundles so docx import/export work on installed module (#24)

## [1.2.17] - 2026-07-14

### Added

- Auto-capture encounters for theater-of-the-mind combats (#23)

### Fixed

- Fix auto-encounter creation for unlinked combats (Foundry v13) (#22)

## [1.2.16] - 2026-07-14

### Added

- Role-aware click behavior for linked-scene content links (#20)

## [1.2.15] - 2026-07-14

### Added

- Auto-link entry names on committed journal saves (#21)

## [1.2.14] - 2026-07-14

### Added

- Timepoint create & campaign dates, with timeline ordering (#19)

## [1.2.13] - 2026-07-13

### Added

- Hide New Entry record selector when hub is scoped to a group (#18)

## [1.2.12] - 2026-07-13

### Added

- Auto-capture GM-shared media onto the timeline (#17)

## [1.2.11] - 2026-07-13

### Fixed

- Fix drag-and-drop; unify timeline attachments on links (#16)

## [1.2.10] - 2026-07-12

### Added

- Campaign Record hub UI fixes: header, sort/filter, inline editing, thumbnails (#15)

## [1.2.9] - 2026-07-12

### Added

- Hub gear menu holding Import/Export/Edit and the auto-capture target
- Summarize combat outcome onto the Encounter at combat end
- Additively sync Encounter roster and track departures
- Auto-create Encounter on combat start
- Auto-create Place and visit timepoint on map activation
- Pure place-matching, timepoint selection, outcome summary
- Pure participant collapse and additive merge
- Newly created Campaign Record becomes auto-capture target
- Target-group world setting with GM socket relay

### Fixed

- Propagate auto-capture target changes to open hubs; stop player-side snap-back
- Repair inline-edit e2e for relocated toggle, renumber auto-capture spec, drop dead class

## [1.2.8] - 2026-07-11

### Added

- Type filter as a checkbox dropdown with its own rail-toggle row
- Add unlink buttons for linked actors and scenes
- Add a close button to the hub record overlay

### Changed

- Doctype filter view model uses checkbox items + summary

### Fixed

- Address final-review findings (encounter unlink, menu-open lifecycle, checkbox focus, e2e robustness)
- Record overlay follows Foundry's theme instead of forcing parchment

## [1.2.7] - 2026-07-11

### Added

- Group the hub index by type only when sorted by type
- Move New Entry into a shared right-pane nav beside Edit
- Collapse the hub index from any view via a toggle in the index controls
- Always-on two-pane hub with timeline persistent and record overlay

### Fixed

- Keep the covered timeline out of keyboard/AT reach behind a record
- Place New Entry beside Edit in the record header (review follow-up)

## [1.2.6] - 2026-07-11

### Added

- Add a scene picker so players can link scenes without dragging
- Show the full index in the record view's left pane
- Unify doctype filter into a chips + dropdown control
- Show doctype icon in index rows, remove group and type columns
- Add doctype icon map and expose icon/typeLabel on index entries

### Fixed

- Lay out import wizard footer buttons horizontally

## [1.2.5] - 2026-07-11

### Fixed

- Complete the import wizard flex chain through .import-wizard
- Scroll split-section dialog so its buttons stay reachable
- Scroll import review list so action buttons stay reachable

## [1.2.4] - 2026-07-11

### Added

- Rename Campaign Group -> Campaign Record and record -> entry in UI strings

### Fixed

- Sidebar activation of a Campaign Record opens the hub, not the editor
- Rename two stray page-sense "record" strings to "entry"

## [1.2.3] - 2026-07-11

### Added

- **Import:** Add merge-up and split controls to review step
- **Import:** Add reading busy-state and Cancel to wizard flow
- **Import:** Collapse Google-doc source into single .docx picker
- **Import:** Add splitSectionAt helper
- **Import:** Add mergeSections helper
- **Import:** Expose block list on parsed sections

### Fixed

- **Import:** Persist group choice across merge/split and refresh merged-row metadata
- **Import:** Guard merge-up at index 0 and make split dialog modal

## [1.2.2] - 2026-07-11

### Added

- Replace Index type chips with a multi-select dropdown
- Hint when filters hide Index search matches in other groups
- Add snippets toggle to the Hub Index search
- Make the Hub Index search box filter by full content

### Changed

- Remove the standalone Search tab; search lives in the Index

## [1.2.1] - 2026-07-11

### Added

- Permission-gate the record pane for out-of-scope pages
- Uuid-based pane navigation — every page opens in the current hub's pane

## [1.2.0] - 2026-07-10

### Added

- Docx export dialog with GM toggle, hub and sheet entry points
- Import creation - group, pages, uploaded images, timepoints
- Import wizard UI with doc-source registry and hub entry point
- Export snapshot-to-doc-model with per-type field renderers and GM stripping
- Export HTML-to-doc-model conversion with UUID tag handling
- Import type suggestion and wizard-rows-to-creation-plan
- Split imported HTML into sections at headings and session headers
- Import title/date/session-header parsing
- Vendor mammoth and docx builds with lazy script-tag loader

### Fixed

- Player-view export applies audience-level permission to timeline document links
- Export player view strips timeline GM content; transcode non-native image types
- Import creation re-enables button and reports failures
- Doc-model contract — multi-image paragraphs, inline flags, list flattening pinned
- Fully-bold detection survives split and nested bold runs
- Session-header detection requires a date or a very short line

## [1.1.0] - 2026-07-10

### Added

- Inline-editable media view via shared images partial
- Inline-editable shop and loot views via shared row partials
- Inline-editable encounter and checklist views via shared row partials
- Inline-editable place and item views
- Inline-editable npc and pc views
- Inline-editable quest view with objectives partial and e2e coverage
- Editable common-view partial; fix missing prose-mirror value attributes
- InlineEdit context flag, render guard, and prose auto-save in BaseRecordSheet
- Focus-guarded CampaignGroupSheet pinned to groups (schema v2)
- InlineEditing client setting with hub header toggle
- Inline-edit decision and debounced-saver logic
- Schema v2 migration points existing groups at the hub sheet
- GroupHubSheet — the hub is the campaign group's journal sheet
- Content links to group records navigate in-pane
- Route new records into in-pane edit mode; e2e coverage for edit, text pages, new-record
- Always-visible history nav bar in the hub
- Collapsible navigation rail in the record pane
- In-pane record viewing in the campaign hub
- Pure link-target classification for in-pane navigation
- Pure history-stack module for hub record pane navigation
- Link Actor picker — drag-free actor linking for players
- E2e session lock, deployment verification, unlock command, and env contract skill
- Symlink pinning and served-code verification helpers
- E2e environment lock primitive with pid-liveness stealing
- Consistent search result styling in hub
- Hover-reveal timepoint controls, auto-width add button
- Zebra striping and aligned columns in hub record list
- Clear-filters control with filtered count in hub index
- Compact horizontal type chips in hub index
- Timeline link chips with thumbnails toggle, open/remove/visibility actions
- Timeline drop accepts documents, image files, and cross-group records as links
- Timepoint link CRUD and live-permission resolution
- Pure timeline-link logic — dedupe, drop classification, display filtering

### Changed

- Final-review cleanups — reset history on close, guard search listener, drop duplicate CSS
- Extract shared hub behavior into HubMixin

### Fixed

- V2 migration fills the group sheetClass only when unset
- Flush pending prose savers on sheet teardown
- Gate inline editing on the campaign-group parent sheet
- Filter system.* from group-sheet form submits; cover hasInlineFocus and Enter-key path
- Restore Link Actor action lost in base sheet rewrite
- Preserve render _options through the group sheet's defer guard
- Restore dnd5e journal styling for pages in campaign groups
- Tolerate unresolvable content-link uuids in hub link handler
- Close embedded sheet when leaving the record pane
- Ignore stale debounced tag-filter events after a re-render
- Teardown never repoints the symlink under a live foreign session
- Deploy helpers — relative-symlink resolution, unreachable-server error, env-override scoping
- Atomic rename-claim steal and NaN-safe lock age reporting
- Guard timeline drop against null payloads and malformed URI encoding
- Zebra rule must precede search-hit hover rule for cascade

## [1.0.0] - 2026-07-08

### Added

- SchemaVersion setting, startup migration runner, downgrade read-only guard
- Presenter hardening — presenterId-matched goto/end, resync, dismiss semantics
- Dnd5e layer — item price/rarity autofill and linked-actor summary
- GM present controls on the media sheet with hidden-media guard
- Presenter socket channel and fullscreen media overlay
- Hub e2e coverage for all record types; v0.3.0
- Media record type with ordered gallery (sheet only)
- Loot record type with currency and item rows
- Shop record type with inventory rows
- Checklist record type with assignees and both-client toggling
- Encounter record type with combatant rows
- PC and Item record types
- Add hub timeline with timepoints, reordering, and record chips
- Add hub cross-document search with GM-only scoping
- Add hub index view with filters, sorting, and live updates
- Add Campaign Hub shell with tabs, group picker, and entry points
- Add hub record collection and search-record mapping
- Add timepoint CRUD on group flags with Quench coverage
- Add in-memory inverted search index with prefix matching
- Add fractional sort keys for timeline ordering
- Add Quest record sheet with targeted objective updates
- Add Place record sheet
- Add base record sheet and NPC sheet with collaborative editing
- Add create-group button and dialog to the journal sidebar
- Add campaign group management and hidden-record enforcement
- Add NPC, Place, and Quest page data models and type registration
- Add constants and pure visibility helpers with unit tests
- Scaffold campaign-record Foundry v13 module

### Changed

- Extract id-based list-row helpers into BaseRecordSheet

### Fixed

- Release-review wave — resync nonce, read-only create/delete guards, pinned release URL, close-path end
- Contain migration failures; strengthen read-only e2e assertion
- Minor polish — single gallery snapshot, AC zero display, scoped warn poll, PC summary e2e
- Cover prev-sync in presenter e2e; skip blank-src rows when presenting
- Harden bindRowInputs against cleared/invalid number inputs and contract violations
- Timeline & hub polish — batched detach, rename label, tag-filter typing, chip attrs
- Search-index polish — per-record token sets, match dedupe, UUID/non-group noise
- Reachable timeline drag, robust cleanup, and hub polish from final review
- Rebuild search index after hub close and dedupe filter listeners
- Scope Vitest to unit tests, excluding Playwright e2e specs
- Snippet token-boundary location and gm-field key namespacing
- Collaborative editor wiring and hidden-record reveal (found by e2e)
- Wrap sheet part templates in a single root element
- Engage collaborative editors and make objective text edits id-based
- Merge ancestor VIEW_PARTS in NpcSheet
- Surface group-creation failures to the user
