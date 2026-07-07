# Campaign Record — Design Spec

**Date:** 2026-07-07
**Status:** Approved design, pre-implementation
**Target:** Foundry VTT v13+ module, public release, dnd5e-focused with system-agnostic core

## Summary

Campaign Record is a Foundry VTT module for collaborative campaign journaling. Every
connected user can edit records concurrently. Records are typed (NPCs, quests, shops,
loot, etc.), organized into named **groups**, and surfaced through a **Campaign Hub**
window offering a filterable index, a free-form timeline, and cross-document search.

## Decisions Made During Design

| Question | Decision |
|---|---|
| Audience | Public release on the Foundry package list, dnd5e-focused |
| Record ↔ game-document relationship | Hybrid: records are standalone data with optional UUID links to Actors/Items/Scenes |
| Grouping | Multiple named groups per world; index/timeline/search scoped per group with an "all groups" view |
| Permissions | All records editable by all players by default; GM-only fields and hidden records on top |
| Timeline time model | Free-form ordered timepoints (text labels, drag-reorder); no calendar math |
| Media type | Image gallery per record + push-to-players fullscreen presenter with synced slideshow |
| Storage architecture | Custom `JournalEntryPage` sub-types; one JournalEntry per group; custom Hub app |

## Architecture

Three layers plus an integration layer:

### 1. Data layer — custom journal page types

- The module registers one `JournalEntryPage` sub-type per record kind:
  `campaign-record.pc`, `.npc`, `.place`, `.encounter`, `.media`, `.quest`,
  `.item`, `.checklist`, `.shop`, `.loot`. Each is backed by a `TypeDataModel`
  schema declared in `module.json` `documentTypes`.
- A **group** is a JournalEntry carrying the flag
  `campaign-record.group = { timepoints: [{ id, label, sort }], sort }`.
  Its pages are the group's records. Groups live in a module-created
  "Campaign Records" journal folder.
- Regular journal entries within a group are core `text` pages — standard Foundry
  journaling works inside groups with no extra code.
- Foundry's server-authoritative document database provides persistence, sync,
  permissions, content links (`@UUID[...]`), and compendium export. The module
  writes no custom persistence or sync code for records.

### 2. Sheet layer — one custom page sheet per type

- ApplicationV2 + HandlebarsApplicationMixin sheets, one per page type.
- Rich-text fields use Foundry's collaborative ProseMirror editor (native
  multi-user simultaneous editing).
- Structured fields save on change; list rows (inventory, objectives, checklist
  items) are written as targeted array updates immediately on action, not batched
  form submits, to minimize last-write-wins collisions.
- Sheets render differently for GM vs player: GM-only content is stripped at
  render time (consistent with Foundry norms; data-level secrecy is explicitly
  out of scope, same as core secret blocks).
- Dropping an Actor/Item/Scene onto a sheet sets the record's optional link UUID.

### 3. Hub layer — the Campaign Hub application

A single resizable ApplicationV2 window opened from a journal-sidebar button, a
scene-control tool, and a keybinding. Persistent header: group picker (one group
or "All groups") + three view tabs.

**Index view**
- Row/card list: type icon, thumbnail, name, key subtitle (NPC role, quest
  status, place type), tags.
- Filters: type chips (all record kinds), tag filter, hidden-only toggle (GM).
  Sort: name / type / recently updated.
- Click opens the record sheet; "+ New" prompts for type and group.
- Reads live from journal collections and re-renders on document update hooks —
  there is no separately stored index to drift.
- Players never see `hidden` records in any Hub view.

**Timeline view**
- Vertical ordered list of the scoped group's timepoints; each shows its label
  and attached record chips.
- For "All groups," per-group timelines are stacked (free-form timepoints from
  different groups are not interleaved).
- Any user can add a timepoint at any position, rename, drag-reorder, and drag
  records from the index onto a timepoint. Records can attach to multiple
  timepoints.
- Ordering uses fractional sort keys (Foundry `SORT_INTEGER_DENSITY` pattern) so
  inserts do not rewrite siblings.

**Search view**
- Full-text search over names, tags, structured fields, and rich text across all
  records in scope. GM-only fields are searchable for GMs only.
- Implementation: in-memory inverted index in plain JS (no dependency), built
  lazily on first search, patched incrementally via document update hooks.
- Prefix matching on terms; no fuzzy matching in v1. Results grouped by type
  with match-context snippets; click jumps to the record.

### 4. dnd5e integration layer (`integrations/dnd5e.js`)

Activates only when the world system is dnd5e:
- Shop inventory / Loot items can link real 5e Items via drag-drop and pull
  price and rarity automatically.
- Currency fields use 5e denominations (cp/sp/ep/gp/pp).
- PC/NPC records linking an Actor show portrait and basic stats.

On other systems these degrade to plain text/number fields; the module remains
fully functional.

## Data Model

**Common fields on every record type** (shared base data model):

| Field | Notes |
|---|---|
| `description` | Collaborative rich text |
| `gmNotes` | Rich text, GM-only |
| `image` | Portrait/banner path |
| `tags` | Free-form strings; drive index filtering |
| `hidden` | Boolean; record invisible to players until revealed. GM-only to set. |
| `timepoints` | Array of timepoint IDs the record is attached to |

**Per-type fields:**

| Type | Fields beyond common |
|---|---|
| PC | player name, class/level (text), faction, linked Actor UUID |
| NPC | role, location (Place link or text), race, gender, profession, voice, faction, status (alive/dead/unknown), linked Actor UUID |
| Place | location (parent Place link or text), government, size, type (town/region/POI/feature), linked Scene UUID |
| Encounter | location, difficulty (text), combatants (list: name + optional Actor UUID + count), linked Scene UUID, outcome |
| Media | ordered image list (src + caption), slideshow settings |
| Quest | source (NPC link or text), status (available/active/completed/failed/abandoned), objectives (checklist with done flags, individually GM-hideable), rewards, linked parent Quest |
| Item | type, rarity, attunement (text), linked Item UUID |
| Checklist | items (list: text + done + optional assignee user) |
| Shop | type, location (Place link or text), owner (NPC link or text), inventory (list: name + price + quantity + optional Item UUID) |
| Loot | currency (5e denominations or free text), items (name + quantity + optional Item UUID), source Encounter link, distribution notes |
| Journal | core `text` page, unmodified |

Cross-record references store Foundry UUIDs plus a fallback display name.

## Permissions & Concurrency

- New groups get `default: OWNER` ownership — every player can create, edit, and
  delete records. GM can flip a group to read-only (default: OBSERVER) in group
  settings.
- Hiding a record sets its page `ownership.default` to NONE; revealing writes
  the group's current effective default explicitly (Foundry v13 rejects
  re-writing the `-1` inherit marker through updates — verified empirically
  on v13.351). Explicit per-user ownership overrides (including the
  auto-assigned creator OWNER entry) are not swept and can leak hidden
  records to those users; accepted limitation, on the manual checklist.
- GM privacy: `hidden` records (filtered from all player-facing views, page
  sheets blocked) and GM-only fields (`gmNotes`, hidden objectives), stripped at
  render time.
- Rich text: native collaborative ProseMirror — simultaneous editing works.
- Structured fields: last-write-wins on simultaneous same-field edits (standard
  Foundry behavior; accepted). Targeted immediate array updates keep the
  collision window small. All open sheets and Hub views re-render on document
  update hooks.

## Media Presenter

- Media sheet shows the gallery; controls: "Show to players" per image and
  "Start slideshow". Presenting is GM-only in v1 (players can browse galleries
  but not push overlays to other clients).
- Presenting emits a module socket message; clients open a fullscreen borderless
  overlay (ImagePopout-style).
- Slideshow: presenter prev/next syncs all viewers; optional auto-advance
  interval. Viewers may dismiss their own overlay; presenter can end for all.
- Hidden Media records cannot be presented to players.

## Error Handling

- Dangling UUID links render as struck-through fallback names; link resolution
  is wrapped in safe lookups — never a render crash.
- Socket handlers validate payloads and no-op on unknown message types
  (version-mismatched clients).
- If the world's stored schema version is newer than the installed module, the
  module warns and goes read-only rather than risk corrupting data.

## Migrations

- Field-level evolution via `TypeDataModel.migrateData`.
- A `schemaVersion` world setting plus a startup migration runner for structural
  changes (e.g., flag shape). Present from the first release.

## Testing

1. **Unit (Vitest):** pure logic — search indexer, sort-key math, data-model
   migrations — extracted into plain ES modules, tested against mocked Foundry
   globals.
2. **Integration (Quench):** in-world suite covering document CRUD, permission
   behavior, and hook wiring.
3. **End-to-end (Playwright):** automated multi-client tests against a local
   Foundry v13 server with a dedicated test world (`tests/e2e/`, see its
   README for the environment contract). Real browser clients log in as GM
   and players and exercise sheets, permissions, GM secrecy, and collaborative
   editing. **Every phase extends this suite with specs for its features**
   (added 2026-07-07; the Phase 1 suite is the template).
4. **Manual multi-client checklist:** reduced to what automation can't cover —
   pointer-driven drag-and-drop from the sidebar and subjective look/feel —
   run before each release.

## Non-Functional

- Plain JavaScript ES modules, no build step.
- All UI strings through `game.i18n` with `lang/en.json` from the start.
- Repo layout: `module.json`, `scripts/{data,sheets,apps,integrations}/`,
  `templates/`, `lang/`, `styles/`.

## Out of Scope (v1)

- Calendar-based timeline (date math, Simple Calendar integration)
- Fuzzy search
- Data-level (cryptographic) secrecy for GM content
- Interleaved cross-group timeline view
- Localization beyond English (scaffolding only)

## Build Phasing

Each phase ships something usable, and each phase's plan must include
Playwright e2e specs for its features (run against the local test world
per `tests/e2e/README.md`) alongside its Vitest/Quench coverage:

1. **Core** — module scaffold, group management, base data model, page type
   registration, NPC + Place + Quest + core-text records with sheets,
   permissions model. *(Shipped; e2e suite covers module load, group
   creation/permissions, record sheets, quest objectives, collaboration,
   and GM secrecy.)*
2. **Hub** — index view, then search, then timeline. *E2E: index filtering
   and type chips, live re-render on document updates, search hits across
   record fields (GM-only fields excluded for players), timepoint
   add/rename/reorder and record attachment from both GM and player clients.*
3. **Remaining types** — PC, Item, Encounter, Shop, Loot, Checklist, Media
   (sheet only). *E2E: one render/persist/view spec per type following the
   Phase 1 sheet-spec pattern; checklist item toggling from both clients;
   shop inventory row add/edit/delete.*
4. **Presenter + 5e layer** — slideshow sockets, dnd5e currency/item/actor
   integration. *E2E: GM presents an image and a player context receives the
   overlay; slideshow next/prev sync; player-side dismiss; hidden media
   cannot be presented; 5e item drop populates price/rarity (world system is
   dnd5e).*
5. **Release polish** — migration runner, localization sweep, Quench suite
   completion, Foundry package listing. *E2E: full-suite green gate plus a
   migration spec (seed old-schema data, reload, assert migrated).*
