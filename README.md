# Campaign Record

A Foundry VTT (v13+) module for collaborative campaign journaling. Every player
at the table can create and edit campaign records — NPCs, places, quests, and
more — organized into shared campaign groups.

**Status:** Phase 2 (Campaign Hub) — groups, NPC/Place/Quest record types,
collaborative sheets, GM-only content, and the Campaign Hub: a filterable
record index, cross-document search, and a free-form timeline. Further record
types, the media presenter, and deeper dnd5e integration are planned; see
`docs/superpowers/specs/2026-07-07-campaign-record-design.md`.

## Installation (development)

1. Clone this repository.
2. Symlink it into your Foundry data directory:
   `ln -s "$(pwd)" "$FOUNDRY_DATA/Data/modules/campaign-record"`
3. Enable **Campaign Record** in your world's module management.

## Usage

- Click **Create Campaign Group** at the bottom of the Journal sidebar.
- Open the group and add pages: NPC, Place, and Quest types appear alongside
  Foundry's standard page types.
- Everyone owns group content by default — all players can add and edit records.
- GMs can hide records from players (eye toggle) and keep GM Notes on any record.
- Open the **Campaign Hub** from the Journal sidebar button (or Ctrl+Shift+H):
  browse and filter all records in the Index, search everything in Search,
  and organize events on the Timeline — drag records from the Index onto a
  timepoint to attach them.

## Development

- No build step. Plain ES modules under `scripts/`.
- Unit tests: `npm test` (Vitest; pure logic only).
- Integration tests: enable the [Quench](https://foundryvtt.com/packages/quench)
  module and run the "Campaign Record: Core" batch.
- Before release: run `docs/manual-test-checklist.md` with two clients.
