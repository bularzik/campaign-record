# Manual Multi-Client Test Checklist

Most of this checklist is now automated — `npm run test:e2e` runs Playwright
specs against the local test world with real GM and player clients (see
`tests/e2e/README.md`). Before each release: run the automated suite, then
walk only the manual section below with two browsers.

## Automated (run `npm run test:e2e` — must be green)

- [x] Module enabled, no module console errors on load *(01-module)*
- [x] GM sees the "Campaign Records" folder after first load *(01-module)*
- [x] Create-group button visibility matches the player's Create Journal
      Entries permission; GM creates a group via the dialog *(01-module)*
- [x] Player can add/edit records in a GM-created group *(04-collaboration)*
- [x] Structured field edited on one client appears on the other client's
      open sheet without a refresh *(04-collaboration)*
- [x] GM and player type in the same NPC description with both editors open;
      both streams of text survive *(04-collaboration)*
- [x] Two clients toggle different quest objectives in quick succession
      (sequentially observed); both changes persist. Simultaneous same-moment
      writes are last-write-wins by design — see spec, Permissions &
      Concurrency *(03-quest)*
- [x] Player never sees GM Notes (edit or view DOM) *(04-collaboration)*
- [x] Player never sees GM-only quest objectives; player can toggle visible
      objectives from view mode *(03-quest)*
- [x] GM hides a record: the player loses access; the client guard blocks a
      player setting hidden via the API; revealing restores access
      *(04-collaboration)*
- [x] Hub opens from the sidebar for GM and players; tabs switch *(05-hub)*
- [x] Index lists records, filters by type chip, live-updates, and hides
      hidden records from players *(06-hub-index)*
- [x] Search matches structured fields with prefixes and snippets; GM-only
      content is searchable only by GMs *(07-hub-search)*
- [x] Timepoints: GM and player add/rename via dialog, reorder persists,
      record chips attach/detach across clients *(08-hub-timeline)*
- [x] PC sheet renders/persists player facts; Item sheet persists rarity;
      view modes show the fields *(09-pc-item)*
- [x] Encounter combatant rows add/edit/delete and persist; view mode lists
      combatants with counts *(10-encounter)*
- [x] Checklist: GM adds/edits/assigns/toggles items; player toggles an item
      from view mode and the GM sees the change *(11-checklist)*
- [x] Shop inventory rows add/edit/delete (name, price, quantity); view mode
      renders the inventory table *(12-shop)*
- [x] Loot currency persists; item rows add and edit; view mode renders;
      dropped Encounter sets source (junk drops are silently ignored)
      *(13-loot)*
- [x] Media captions edit, reorder via up/down buttons, and delete, all
      persisting in order; view mode renders the gallery; moving the first
      image up is a no-op (start-of-list boundary guard) *(14-media)*
- [x] Hub shows one type chip per record type plus journal (11 total);
      phase-3 subtitles (shop, pc, checklist) render; search hits shop
      inventory item names and checklist item text *(15-hub-types)*
- [x] GM presents an image via show/goto/end socket relay; player overlay
      displays it; player sees dismiss button; hidden images do not display
      *(16-presenter)*
- [x] On a dnd5e world, dropping a weapon onto a Shop autofills price;
      dropping onto an Item record autofills rarity; a dropped linked actor's
      summary on the NPC sheet shows its name and HP (portrait/AC display is
      not asserted by the automated test) *(17-dnd5e)*

## Manual (before each release)

- [ ] Quench "Campaign Record: Core" batch passes (enable the Quench module,
      run from its sidebar tab).
- [ ] Dropping an Actor from the sidebar onto an NPC sheet links it; the link
      opens the actor. (Pointer-driven drag-and-drop is not automated.)
- [ ] Dropping a Scene onto a Place sheet links it.
- [ ] Collaborative editing feels right with live remote cursors (subjective).
- [ ] A record granted explicit per-user ownership (Configure Ownership) still
      disappears for that user when the GM hides it. If it remains visible,
      this is a known gap in ownership-default-based hiding — file an issue.
      (Note: page creators receive explicit OWNER automatically, so records a
      player created fall under this case for that player.)
- [ ] Quench "Campaign Record: Hub" batch passes.
- [ ] Quench "Campaign Record: Types" batch passes.
- [ ] Drag a record row from the Hub index onto a timeline timepoint — the
      chip appears (pointer-driven drag is not automated).
- [ ] Drag a timepoint onto another timepoint to reorder it.
- [ ] The scene-controls journal group shows an "Open Campaign Hub" tool.
- [ ] Add an image to a Media record through the real FilePicker dialog
      (dialog flow not automated).
- [ ] The record-pane header thumbnail button opens the real FilePicker and
      saves the picked image (dialog flow not automated).
- [ ] With two clients viewing the same record, tag and image changes made on
      one client appear on the other (tag-count badge, an open tag popover, and
      the header thumbnail all update live).
- [ ] A group created before v1.1.0 (legacy `CampaignGroupSheet` flag) opens as the hub after migration, and its records inline-edit with the setting on; in manual edit mode the pane shows exactly one name editor (the title-bar input).
- [ ] Drop an Actor from the sidebar onto an Encounter sheet and an Item onto
      a Shop sheet (real pointer drag; only synthetic drops are automated).
- [ ] Drop an Encounter record onto a Loot sheet to set its source (and a
      non-Encounter page: expect a silent no-op) (real pointer drag; only
      synthetic drops are automated).
- [ ] Subjective pass over the seven new sheets' (pc, item, encounter,
      checklist, shop, loot, media) layout/styling in both edit and view
      modes.
- [ ] Run a slideshow with a non-zero auto-advance interval and confirm
      images advance on both clients without interaction (timer behavior is
      not automated).
- [ ] Present an image and confirm the overlay looks correct on a real
      second display (fullscreen fit, caption legibility).
- [ ] On a non-dnd5e world, confirm Shop/Item drops still link items with
      blank price/rarity and NPC/PC linked actors show name/portrait without
      AC/HP.

## Import / Export

- [ ] Hub → Import Document → pick a .docx: sections listed with sensible
      suggested types; dated sessions pre-checked as timepoints.
- [ ] Import into a NEW group and an EXISTING group.
- [ ] Skip and Merge rows behave; empty sections default to Skip.
- [ ] Imported images appear in descriptions (GM with upload permission).
- [ ] Export Group as player view: no hidden records, no GM notes.
- [ ] Export Group with "Include GM content": both present.
- [ ] Export single record from its sheet menu.
- [ ] Exported .docx opens in Word/Pages and converts in Google Drive.
- [ ] Re-import an exported group docx: types pre-suggested from markers.

## Release gate (before tagging each release)

- [ ] Run all three Quench batches ("Campaign Record: Core", "Campaign
      Record: Hub", "Campaign Record: Types") in a world with Quench
      installed; all pass.
- [ ] Create a fresh world, enable the module, and confirm it initializes the
      `schemaVersion` world setting to `2` with no console errors.
- [ ] After tagging a release, install the module via its manifest URL
      (`https://github.com/bularzik/campaign-record/releases/latest/download/module.json`)
      into a clean Foundry instance and smoke-test that the module loads
      without errors.
