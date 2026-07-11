# Design: docx / Google Docs Import & Export

**Date:** 2026-07-09
**Status:** Approved
**Branch:** `feature/docx-import-export`

## Summary

Add two capabilities to Campaign Record:

1. **Import** a Word document (`.docx`) — including one downloaded from Google
   Docs — and turn it into a new (or existing) campaign group: the document is
   split into sections, the user reviews each section in a wizard and assigns
   it a record type (or plain text page), and dated session sections can
   become timeline timepoints.
2. **Export** a whole group (all records + timeline) or a single record to a
   native `.docx` file that opens in Word and converts cleanly when dragged
   into Google Drive.

Google Docs support in v1 is a **guided manual flow** (download-as-docx on
import; drag-into-Drive on export) built on a doc-source abstraction so a
real Google OAuth source can slot in later without UI rework. Rationale: the
module is client-only browser JS, and Google's unauthenticated export URLs
are CORS-blocked; a shipped OAuth client is deliberately deferred.

## Decisions made during brainstorming

| Question | Decision |
| --- | --- |
| Import mapping | Split into sections + review wizard (no automatic entity extraction from prose) |
| Google Docs mechanism | Hybrid: manual docx flow now, doc-source abstraction so OAuth can be added later |
| Export scope | Both whole-group (from Hub) and single-record (from sheet) |
| GM-only content in exports | GM-only "Include GM content" toggle, unchecked by default; non-GMs always get the player view |
| Architecture | Pure-logic core + vendored `mammoth.js` (import) and `docx` (export) libraries + provider abstraction |
| Round-trip | Structure-level only in v1 — re-import splits per record with correct type suggestions; `system` fields are **not** repopulated losslessly |

## Reference input

Test document for import (import only, never an export target):
`https://docs.google.com/document/d/1Zh8JtPMWwzE-QVpwv31unK9tfwhCmJJ0Hlr12e0gqOU`
("Adventure Notes", ~27,500 words). Its structure drives the import design:

- Only five markdown-level headings in the whole document; the real unit is
  ~33 **session headers** that are plain or fully-bold paragraphs:
  `Session Zero 10/6/2024`, `Arc 2 Session 3 2/23/25`,
  `**Arc 5, Session 1**` (no date), `IN PERSON SESSION 1 11/14/25`,
  `Out of Arc - 3/2/23 - Sidequest`, `Arc 3 Session 2 5/18/25 part 1`,
  and one session rendered as an `h3` with a spelled-out date
  (`Radiant Citadel - April 27th 2025`).
- Hazards the importer must survive: typo dates (`3/3025`, `9/31/25`),
  bold markers fused into a heading (`# Character List**`), a table with an
  empty header row and labels in the first body row, an empty terminal
  section (`# Party Inventory`), roughly half the lines being
  whitespace-only, escaped `\*` pseudo-bullets inside bold runs, broken
  `******` bold nesting, and corrupted emoji characters.
- Entities (NPCs, places, quests, items) appear only inside prose — there
  are no per-entity sections. This is why the design does **not** attempt
  automatic entity extraction.

## Import pipeline

### Entry point

A new **Import Document** button on the Campaign Hub (alongside "New
Record"), visible to users with Foundry's *Create Journal Entries*
permission (the same gate as creating a group, since importing may create
one). It opens the Import Wizard.

### Step 1 — Source

The wizard's first screen lists the registered doc sources
(`scripts/integrations/doc-sources.mjs`):

- **Local .docx file** — a file input accepting `.docx`.
- **Google Docs** — in v1, an instruction card: *"In Google Docs choose
  File → Download → Microsoft Word (.docx), then select that file here"*,
  with the same file input beneath. A future OAuth source replaces this
  card's body (URL paste / sign-in) without changing the wizard flow.

### Step 2 — Parse and split (pure logic)

- The `.docx` is converted to HTML in the browser by a lazily-imported,
  vendored `mammoth.js` build. Images come out as data URIs.
- `scripts/logic/doc-import.mjs` (pure, DOM parser injected) turns that HTML
  into a **section tree**:
  - Split on headings `h1`–`h3` **and** on session-header paragraphs: a
    plain or fully-bold paragraph matching session patterns
    (`Arc N Session M [date]`, `Session Zero|N [date]`,
    `IN PERSON SESSION N [date]`, `Out of Arc …`, optional
    `part N` suffix, optional comma, tolerant of repeated spaces).
  - Date extraction handles `M/D/YY`, `M/D/YYYY`, spelled-out
    (`April 27th 2025`), and flags unparseable dates (`3/3025`) as
    *no date* rather than guessing.
  - Whitespace-only paragraphs are dropped; stray bold markers fused into
    headings are stripped from titles; content before the first section
    becomes an **Introduction** section; sections with no content are
    flagged `empty` (defaulted to Skip in the wizard, not silently created).
  - Each section gets a **suggested type**: title-keyword map
    (e.g. `loot|inventory → loot`, `character → pc`, `shop → shop`,
    `bastion|location|place → place`), dated session sections →
    *text page + timepoint*, everything else → *text page*. Suggestions are
    conservative; no prose mining.
  - When the title carries a recognized type subtitle produced by our own
    exporter (see Export → Round-trip), that type is pre-suggested.

### Step 3 — Review wizard

One table row per section:

- editable title,
- content preview snippet + word count,
- type dropdown: *Text page*, the ten record types, **Merge into
  previous**, **Skip**,
- **Create timepoint** checkbox (pre-checked for dated sessions; shows the
  parsed date; available for any section).

Above the table: target selection — **new group** (name prefilled from the
document title) or an existing group the user can edit.

### Step 4 — Create

On confirm, in this order (so a failed parse can never half-create data):

1. Upload extracted images via `FilePicker.upload` to
   `campaign-record/imports/<slug>/` and rewrite `src` attributes. If the
   user lacks upload permission, continue without images and record a
   warning.
2. Create or locate the group (`createGroup()` for new).
3. Create all pages in a single `createEmbeddedDocuments("JournalEntryPage",
   …)` call. Typed records receive their section HTML in
   `system.description`; text pages in `text.content`. Page name = cleaned
   section title.
4. Create timepoints on the group flag in document order (label = section
   title) and attach each section's page to its timepoint via the existing
   timeline-link logic (`scripts/logic/timeline-links.mjs` conventions).
5. Show a summary notification: pages created, timepoints created, and any
   warnings (skipped empty sections, dropped images, unparseable dates).

### Errors

- Wrong file type or a mammoth parse failure aborts before any document is
  created, with a localized error notification.
- All user-facing strings go through `lang/en.json`.

## Export pipeline

### Entry points

- **Campaign Hub → Export Group**: exports every record in the current
  group plus its timeline.
- **Record sheet header controls → Export to Word**: exports that single
  record.

### Export dialog

A small `DialogV2`:

- Shows what will be exported (group name + record count, or record name).
- **Include GM content** checkbox — rendered only for GMs, unchecked by
  default. When unchecked, or for any non-GM user, the export applies the
  module's existing player-view stripping rules: hidden records are
  excluded entirely; `gmNotes` and GM-only quest objectives are omitted.
  Players may export; they always get the player view.
- A note: *"To turn this into a Google Doc, drag the downloaded file into
  drive.google.com — it converts automatically."*

### Document shape

Rendered as **native Word constructs** via the vendored `docx` library
(real headings, tables, lists, embedded images) — this is what converts
cleanly in Google Drive, unlike altChunk/HTML-wrapper approaches.

- Title heading: group name (or record name for single-record export).
- **Timeline section** (group export only): each timepoint as a subheading
  in timeline order, with its linked record / image names listed beneath.
- **One section per record**:
  - Heading 1 = record name, followed by a subtitle line naming the type
    (e.g. `Quest`) — this line doubles as the round-trip type marker.
  - Structured `system` fields as compact `Label: value` lines via a
    per-type field-rendering map (all ten types): NPC role/location/race/
    faction/status, quest status + objectives as a checked/unchecked list,
    shop/loot inventories as real Word tables, checklist items as a list,
    media gallery as embedded images with captions, etc.
  - `description` rich HTML converted HTML → doc model → docx: paragraphs,
    headings, bold/italic/underline, nested bullet/numbered lists, tables,
    hyperlinks, images.
  - `gmNotes` under a "GM Notes" subheading only when the GM toggle is on.
- Images (record `image`, media galleries, images inside descriptions) are
  fetched from the Foundry server (same-origin) as array buffers and
  embedded; a fetch failure degrades to a caption line with the file name.
- `@UUID[…]{label}` enricher links render as their display label in bold —
  they are meaningless outside Foundry.

### Delivery

Browser download of `<sanitized-name>.docx` via a Blob anchor.

### Round-trip (explicit v1 scope)

Re-importing an exported group docx splits one-section-per-record and the
type subtitle line pre-suggests the correct record type per section.
**Not** in v1: repopulating `system` fields from the `Label: value` lines —
descriptions absorb them as text. Field-level lossless round-trip is a
possible follow-up, deliberately excluded here.

## Architecture

New files, following the repo's pure-logic / apps / integrations split:

| File | Role |
| --- | --- |
| `vendor/mammoth.browser.min.js` | Checked-in browser build; lazy `import()` only when importing |
| `vendor/docx.min.js` | Checked-in browser build; lazy `import()` only when exporting |
| `scripts/logic/doc-import.mjs` | Pure: HTML → section tree (splitting, session/date detection, cleanup, type suggestion). DOM parser injected for testability |
| `scripts/logic/doc-export.mjs` | Pure: record data → intermediate doc model; HTML → doc-model converter; ten per-type field-rendering maps; GM stripping |
| `scripts/integrations/doc-sources.mjs` | Doc-source registry; `docx-file` source in v1, Google OAuth source later |
| `scripts/apps/import-wizard.mjs` + `templates/import/*.hbs` | ApplicationV2 wizard (pattern: `campaign-hub.mjs`) |
| `scripts/apps/export-dialog.mjs` | Export DialogV2 + doc model → `docx` rendering + download |

Wiring changes: Hub buttons in `scripts/apps/hub/campaign-hub.mjs`, sheet
header action in `scripts/sheets/base-record-sheet.mjs`, strings in
`lang/en.json`, vendor files listed nowhere in `module.json` (loaded on
demand, not at module load).

**No schema or migration changes** — import/export only creates and reads
standard documents; `SCHEMA_VERSION` is untouched.

## Testing

- **Vitest (pure logic)** — fixtures replicating every hazard observed in
  the test document: all session-header variants (including the `h3`
  session, no-date `Arc 5, Session 1`, typo dates, `part 1/2` splits, the
  ALL-CAPS and `Out of Arc` forms), bold-fused headings, whitespace
  padding, the empty-header table, empty terminal sections. Assertions on
  the section tree, suggested types, timepoint dates, and warnings.
  Export logic tested record-data-in → doc-model-out, including GM
  stripping with the toggle on/off and per-type field maps.
- **Playwright e2e** (per the `foundry-e2e` contract): new
  `tests/e2e/21-import-export.spec.mjs`.
  - **Import**: the fixture is the actual test Google Doc exported to
    `.docx` and checked into `tests/e2e/fixtures/` (fetched once during
    implementation). The spec uploads it with `setInputFiles`, drives the
    wizard (rename to `E2E `-prefixed names, adjust a couple of types),
    and asserts the group, expected page count, and dated timepoints.
  - **Export**: build a small `E2E `-prefixed group with typed records,
    export with and without GM content, unzip the `.docx` in Node, and
    assert included/stripped content.
- Existing suites must stay green; all e2e data uses the `E2E ` prefix.

## Out of scope (v1)

- In-app Google OAuth (URL import / direct Doc creation) — the doc-source
  abstraction is the landing zone for it.
- Automatic NPC/place/quest extraction from prose.
- Lossless field-level round-trip of `system` fields.
- Splitting one section into multiple records (e.g. a Character List into
  one PC record per character) — the wizard assigns one type per section.
- `.doc`, `.odt`, markdown, or PDF import.
