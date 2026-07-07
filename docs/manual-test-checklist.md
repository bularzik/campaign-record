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
