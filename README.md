# Campaign Record

A Foundry VTT (v13+) module for collaborative campaign journaling. Every
connected player can create and edit typed campaign entries — NPCs, places,
quests, and more — organized into shared Campaign Records, and surfaced
through a Campaign Hub with a filterable index, a free-form timeline, and
cross-document search. The core is system-agnostic, with deeper integration
for dnd5e.

## Features

- **Ten entry types**: NPC, Place, Quest, PC, Item, Encounter, Checklist,
  Shop, Loot, and Media — each a custom journal page type with its own
  collaborative sheet.
- **Campaign Records**: multiple named Campaign Records per world; every
  player can create and edit entries in a Campaign Record by default, with a
  GM option to make a Campaign Record read-only.
- **Campaign Hub**: a dedicated window with a filterable entry index, a
  free-form drag-reorderable timeline, and cross-document search that
  matches structured fields with prefixes and snippets.
- **GM-only media presenter**: push images from a Media entry's gallery to
  all connected players as a fullscreen overlay, with a synced slideshow
  (prev/next and optional auto-advance) and per-viewer dismiss.
- **Drag-and-drop media upload** — drop an image or video from your desktop
  onto the Campaign Hub: it uploads to the server and lands in the open
  media entry, the timepoint you dropped it on, or the newest timepoint's
  shared media gallery.
- **Hidden entries & GM notes**: GMs can hide any entry from players and
  keep private GM Notes on any entry; both are stripped at render time.
- **dnd5e integration**: dropping a weapon onto a Shop or Item entry
  autofills price/rarity, and linked Actors show a live name/AC/HP summary
  on NPC and PC sheets.
- **Word / Google Docs import & export**: import a `.docx` (or a Google Doc
  downloaded as one) through a review wizard that splits it into sections,
  assigns entry types, and builds timeline timepoints from dated session
  headers; export any Campaign Record or single entry to a native `.docx`
  that converts cleanly when dragged into Google Drive. GM-only content is
  exported only when a GM opts in.

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

- Click **Create Campaign Record** at the bottom of the Journal sidebar to
  start a new Campaign Record. The button appears for any user with
  Foundry's **Create Journal Entries** permission — by default that is
  Trusted Players and up, so regular Players won't see it (see
  [Permissions model](#permissions-model)).
- Open the Campaign Record and add pages: the ten entry types appear
  alongside Foundry's standard page types.
- Open the **Campaign Hub** from the Journal sidebar button, the scene
  controls tool, or the **Ctrl+Shift+H** shortcut: browse and filter entries
  in the Index, search everything in Search, and organize events on the
  Timeline by dragging entries onto a timepoint.
- To import a document: open the Campaign Hub and click the **Import
  Document** button (visible with the Create Journal Entries permission).
  For a Google Doc, first use **File → Download → Microsoft Word (.docx)**
  in Google Docs. Review the detected sections, pick types, then import.
- To export: click **Export Campaign Record** in the Campaign Hub (with a
  specific Campaign Record selected), or **Export to Word** in an entry
  sheet's window menu. Drag the downloaded file into drive.google.com to get
  a Google Doc.
- To present a slideshow: open a Media entry's sheet as GM, click **Show to
  players** on an image (or **Start slideshow**) — connected players see a
  fullscreen overlay that follows the presenter's prev/next and can
  auto-advance.

## Permissions model

Every entry is editable by all players by default (new Campaign Records get
`OWNER` ownership for everyone); the GM can flip a Campaign Record to
read-only.

Players also cannot *drag* Actors out of the sidebar — core Foundry gates
that drag on the **Create Token** permission (Assistant GM by default). The
NPC, PC, and Encounter sheets therefore offer a **Link Actor** button that
opens a picker of the actors the user can see, as a drag-free alternative
with the same result.

Creating a *new Campaign Record* is different: a Campaign Record is a
`JournalEntry` document, so it requires Foundry's **Create Journal
Entries** permission, which defaults to the Trusted Player role. Regular
Players can add and edit entries inside existing Campaign Records but
cannot create Campaign Records — and won't see the **Create Campaign
Record** button. To allow it, either promote those users to Trusted Player
or grant **Create Journal Entries** to the Player role (**Configure
Settings → Open Permission Configuration**). On top of that, GMs can hide
individual entries (blocked from all player-facing views and sheets) and
keep GM-only fields (`gmNotes`, hidden objectives) on any entry — both are
stripped at render time.

Explicit per-user ownership overrides (including the auto-assigned creator
OWNER entry) are not swept and can leak hidden entries to those users;
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
