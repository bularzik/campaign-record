# Campaign Record

A Foundry VTT (v13+) module for collaborative campaign journaling. Every
connected player can create and edit typed campaign records — NPCs, places,
quests, and more — organized into shared campaign groups, and surfaced
through a Campaign Hub with a filterable index, a free-form timeline, and
cross-document search. The core is system-agnostic, with deeper integration
for dnd5e.

## Features

- **Ten record types**: NPC, Place, Quest, PC, Item, Encounter, Checklist,
  Shop, Loot, and Media — each a custom journal page type with its own
  collaborative sheet.
- **Groups**: multiple named campaign groups per world; every player can
  create and edit records in a group by default, with a GM option to make a
  group read-only.
- **Campaign Hub**: a dedicated window with a filterable record index, a
  free-form drag-reorderable timeline, and cross-document search that
  matches structured fields with prefixes and snippets.
- **GM-only media presenter**: push images from a Media record's gallery to
  all connected players as a fullscreen overlay, with a synced slideshow
  (prev/next and optional auto-advance) and per-viewer dismiss.
- **Hidden records & GM notes**: GMs can hide any record from players and
  keep private GM Notes on any record; both are stripped at render time.
- **dnd5e integration**: dropping a weapon onto a Shop or Item record
  autofills price/rarity, and linked Actors show a live name/AC/HP summary
  on NPC and PC sheets.

## Installation

- **From the Foundry package list** (once published): search for "Campaign
  Record" in Foundry's **Add-on Modules** browser and install it directly.
- **Manually**: in Foundry's **Add-on Modules** tab, click **Install
  Module**, and paste this manifest URL:

  ```
  https://github.com/bularzik/campaign-record/releases/latest/download/module.json
  ```

Then enable **Campaign Record** in your world's module management.

## Usage

- Click **Create Campaign Group** at the bottom of the Journal sidebar to
  start a new group. The button appears for any user with Foundry's
  **Create Journal Entries** permission — by default that is Trusted
  Players and up, so regular Players won't see it (see
  [Permissions model](#permissions-model)).
- Open the group and add pages: the ten record types appear alongside
  Foundry's standard page types.
- Open the **Campaign Hub** from the Journal sidebar button, the scene
  controls tool, or the **Ctrl+Shift+H** shortcut: browse and filter records
  in the Index, search everything in Search, and organize events on the
  Timeline by dragging records onto a timepoint.
- To present a slideshow: open a Media record's sheet as GM, click **Show to
  players** on an image (or **Start slideshow**) — connected players see a
  fullscreen overlay that follows the presenter's prev/next and can
  auto-advance.

## Permissions model

Every record is editable by all players by default (new groups get `OWNER`
ownership for everyone); the GM can flip a group to read-only.

Players also cannot *drag* Actors out of the sidebar — core Foundry gates
that drag on the **Create Token** permission (Assistant GM by default). The
NPC, PC, and Encounter sheets therefore offer a **Link Actor** button that
opens a picker of the actors the user can see, as a drag-free alternative
with the same result.

Creating a *new group* is different: a group is a `JournalEntry` document,
so it requires Foundry's **Create Journal Entries** permission, which
defaults to the Trusted Player role. Regular Players can add and edit
records inside existing groups but cannot create groups — and won't see the
**Create Campaign Group** button. To allow it, either promote those users
to Trusted Player or grant **Create Journal Entries** to the Player role
(**Configure Settings → Open Permission Configuration**). On top of
that, GMs can hide individual records (blocked from all player-facing views
and sheets) and keep GM-only fields (`gmNotes`, hidden objectives) on any
record — both are stripped at render time.

Explicit per-user ownership overrides (including the auto-assigned creator
OWNER entry) are not swept and can leak hidden records to those users;
accepted limitation, on the manual checklist.

## Development

- No build step — plain ES modules under `scripts/`.
- Unit tests: `npm test` (Vitest; pure logic only).
- Integration tests: enable the
  [Quench](https://foundryvtt.com/packages/quench) module in a test world and
  run the "Campaign Record: Core", "Campaign Record: Hub", and "Campaign
  Record: Types" batches from its sidebar tab.
- End-to-end tests: `npm run test:e2e` (Playwright) drives real GM and
  player browser clients against a local Foundry v13 server — see
  `tests/e2e/README.md` for the environment contract.

## License

[MIT](LICENSE)
