# Campaign Record

A Foundry VTT (v13+) module for collaborative campaign journaling. Every player
at the table can create and edit campaign records — NPCs, places, quests, and
more — organized into shared campaign groups.

**Status:** Phase 1 (core) — groups, NPC/Place/Quest record types, collaborative
sheets, and GM-only content. Index, timeline, search, and further record types
are planned; see `docs/superpowers/specs/2026-07-07-campaign-record-design.md`.

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

## Development

- No build step. Plain ES modules under `scripts/`.
- Unit tests: `npm test` (Vitest; pure logic only).
- Integration tests: enable the [Quench](https://foundryvtt.com/packages/quench)
  module and run the "Campaign Record: Core" batch.
- Before release: run `docs/manual-test-checklist.md` with two clients.
