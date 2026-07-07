# Manual Multi-Client Test Checklist

Run before each release with two browsers: one GM, one player (non-GM user).

## Setup
- [ ] Fresh v13 test world, module enabled, no console errors on load.
- [ ] Quench "Campaign Record: Core" batch passes.

## Groups & permissions
- [ ] GM sees the "Campaign Records" folder after first load.
- [ ] Player with Create Journal Entries permission can create a group.
- [ ] Player can add an NPC/Place/Quest page to a GM-created group.
- [ ] Player without the permission does not see the create-group button.

## Collaborative editing
- [ ] GM and player type in the same NPC description simultaneously; both
      streams of text survive with live cursors.
- [ ] Structured field edited by the player (e.g. NPC role) appears on the
      GM's open sheet without a manual refresh.
- [ ] Two clients toggle different quest objectives within a second of each
      other; both toggles persist.

## GM secrecy
- [ ] Player never sees GM Notes in edit or view mode.
- [ ] Player never sees GM-only quest objectives.
- [ ] GM hides a record: it vanishes from the player's journal TOC; the
      player's warning fires if they try to set hidden via the API.
- [ ] GM reveals the record: it returns for the player.

## Drag & drop
- [ ] Dropping an Actor on an NPC sheet links it; the link opens the actor.
- [ ] Dropping a Scene on a Place sheet links it.
