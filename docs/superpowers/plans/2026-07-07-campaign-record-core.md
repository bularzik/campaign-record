# Campaign Record — Phase 1 (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core of the Campaign Record Foundry VTT module: module scaffold, campaign groups, the shared record data model, and working NPC/Place/Quest record types with collaborative sheets and the hidden/GM-notes permission model.

**Architecture:** Records are custom `JournalEntryPage` sub-types backed by `TypeDataModel` schemas; a campaign **group** is a `JournalEntry` carrying the module flag `campaign-record.group`, created with `default: OWNER` ownership so all players can edit. Custom ApplicationV2 page sheets provide structured fields plus collaborative ProseMirror rich text. This plan is **Phase 1 of 5** from the spec (`docs/superpowers/specs/2026-07-07-campaign-record-design.md`); the Hub, remaining types, presenter, and 5e layer come in later plans.

**Tech Stack:** Foundry VTT v13 API (ApplicationV2, TypeDataModel, DialogV2), plain JavaScript ES modules (`.mjs`, no build step), Handlebars templates, Vitest (unit tests for pure logic), Quench (in-world integration tests).

## Global Constraints

- Foundry compatibility: `"compatibility": { "minimum": "13", "verified": "13" }` — v13 APIs only, no v12 fallbacks.
- Module id is exactly `campaign-record`; page type ids are `campaign-record.npc`, `campaign-record.place`, `campaign-record.quest` (Phase 1 set).
- Group flag shape (verbatim from spec): `campaign-record.group = { timepoints: [] }` (timepoint objects `{ id, label, sort }` arrive in Phase 2; the empty array ships now).
- New groups get ownership `{ default: OWNER }`; hidden records get page `ownership.default = NONE`, revealed records get `-1` (inherit).
- No build step, no runtime npm dependencies. Only devDependency: `vitest`.
- Every user-facing string goes through `game.i18n` with keys in `lang/en.json` under the `CAMPAIGNRECORD` namespace (except Foundry's own `TYPES.*` keys).
- GM-only content (`gmNotes`, `hidden` toggle) is stripped at render time; data-level secrecy is explicitly out of scope.
- Repo layout: `module.json`, `scripts/{data,sheets,apps,hooks,logic,testing}/`, `templates/`, `lang/`, `styles/`, `tests/` (vitest, not shipped).

**Manual checkpoints:** Steps marked *Manual checkpoint* require a local Foundry v13 install with this repo symlinked into `Data/modules/campaign-record` (Task 1 sets this up). If no Foundry instance is available to the executor, mark those steps as "pending user verification" in the commit message and continue — do not skip the automated steps.

---

### Task 1: Module scaffold and dev environment

**Files:**
- Create: `module.json`
- Create: `scripts/campaign-record.mjs`
- Create: `lang/en.json`
- Create: `styles/campaign-record.css`
- Create: `package.json`
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the module entry point `scripts/campaign-record.mjs` (all later tasks add imports/hook calls here), `lang/en.json` (later tasks add keys under `CAMPAIGNRECORD`), and `module.json` (Task 3 adds `documentTypes`).

- [ ] **Step 1: Create `module.json`**

```json
{
  "id": "campaign-record",
  "title": "Campaign Record",
  "description": "Collaborative campaign journaling: shared typed records (NPCs, places, quests, and more) organized into groups, with an index, timeline, and cross-document search.",
  "version": "0.1.0",
  "authors": [{ "name": "Dan Bularzik" }],
  "compatibility": { "minimum": "13", "verified": "13" },
  "esmodules": ["scripts/campaign-record.mjs"],
  "styles": ["styles/campaign-record.css"],
  "languages": [{ "lang": "en", "name": "English", "path": "lang/en.json" }],
  "url": "",
  "manifest": "",
  "download": ""
}
```

- [ ] **Step 2: Create the entry module `scripts/campaign-record.mjs`**

```js
Hooks.once("init", () => {
  console.log("campaign-record | Initializing Campaign Record");
});
```

- [ ] **Step 3: Create `lang/en.json`**

```json
{
  "CAMPAIGNRECORD": {
    "ModuleName": "Campaign Record"
  }
}
```

- [ ] **Step 4: Create `styles/campaign-record.css`**

```css
/* Campaign Record */
.campaign-record .form-fields-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.25rem 1rem;
}

.campaign-record .campaign-record-drop {
  border: 1px dashed var(--color-border-light-primary, #7a7971);
  border-radius: 4px;
  padding: 0.5rem;
  text-align: center;
}

.campaign-record .gm-only {
  border-left: 3px solid var(--color-level-warning, #ee9b3a);
  padding-left: 0.5rem;
}
```

- [ ] **Step 5: Create `package.json` and `.gitignore`**

`package.json`:

```json
{
  "name": "campaign-record",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

`.gitignore`:

```
node_modules/
```

- [ ] **Step 6: Install dev dependencies and verify the test runner works**

Run: `npm install && npx vitest run --passWithNoTests`
Expected: exits 0, reports "No test files found" (passWithNoTests).

- [ ] **Step 7: Link the module into Foundry** *(Manual checkpoint)*

With `FOUNDRY_DATA` set to your Foundry user data path (e.g. `~/Library/Application Support/FoundryVTT`):

Run: `ln -s "$(pwd)" "$FOUNDRY_DATA/Data/modules/campaign-record"`

Launch Foundry v13, open a test world, enable "Campaign Record" in Manage Modules. Expected: world reloads, the console shows `campaign-record | Initializing Campaign Record`, no errors.

- [ ] **Step 8: Commit**

```bash
git add module.json scripts/campaign-record.mjs lang/en.json styles/campaign-record.css package.json .gitignore package-lock.json
git commit -m "feat: scaffold campaign-record Foundry v13 module"
```

---

### Task 2: Pure logic — constants and visibility helpers (TDD)

**Files:**
- Create: `scripts/constants.mjs`
- Create: `scripts/logic/visibility.mjs`
- Test: `tests/visibility.test.js`

**Interfaces:**
- Consumes: nothing Foundry-specific — these modules must stay free of `foundry.*`/`game.*` globals so Vitest can import them.
- Produces:
  - `MODULE_ID: string` (`"campaign-record"`), `GROUP_FLAG: string` (`"group"`), `FOLDER_FLAG: string` (`"recordsFolder"`), `typeId(type: string): string` from `scripts/constants.mjs`
  - `isRecordVisible(user, page): boolean`, `canSetHidden(user): boolean`, `hasGroupFlag(flags): boolean` from `scripts/logic/visibility.mjs`

- [ ] **Step 1: Write the failing tests**

`tests/visibility.test.js`:

```js
import { describe, it, expect } from "vitest";
import { MODULE_ID, GROUP_FLAG, typeId } from "../scripts/constants.mjs";
import { isRecordVisible, canSetHidden, hasGroupFlag } from "../scripts/logic/visibility.mjs";

describe("constants", () => {
  it("exposes the module id", () => {
    expect(MODULE_ID).toBe("campaign-record");
    expect(GROUP_FLAG).toBe("group");
  });

  it("builds namespaced type ids", () => {
    expect(typeId("npc")).toBe("campaign-record.npc");
  });
});

describe("isRecordVisible", () => {
  const gm = { isGM: true };
  const player = { isGM: false };

  it("GMs see everything", () => {
    expect(isRecordVisible(gm, { system: { hidden: true } })).toBe(true);
  });

  it("players see non-hidden records", () => {
    expect(isRecordVisible(player, { system: { hidden: false } })).toBe(true);
  });

  it("players do not see hidden records", () => {
    expect(isRecordVisible(player, { system: { hidden: true } })).toBe(false);
  });

  it("pages without system data (core text pages) are visible", () => {
    expect(isRecordVisible(player, { system: {} })).toBe(true);
    expect(isRecordVisible(player, {})).toBe(true);
  });
});

describe("canSetHidden", () => {
  it("only GMs may set hidden", () => {
    expect(canSetHidden({ isGM: true })).toBe(true);
    expect(canSetHidden({ isGM: false })).toBe(false);
    expect(canSetHidden(undefined)).toBe(false);
  });
});

describe("hasGroupFlag", () => {
  it("detects the group flag on a flags object", () => {
    expect(hasGroupFlag({ "campaign-record": { group: { timepoints: [] } } })).toBe(true);
    expect(hasGroupFlag({ "campaign-record": {} })).toBe(false);
    expect(hasGroupFlag({})).toBe(false);
    expect(hasGroupFlag(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/visibility.test.js`
Expected: FAIL — cannot resolve `../scripts/constants.mjs`.

- [ ] **Step 3: Write the implementations**

`scripts/constants.mjs`:

```js
export const MODULE_ID = "campaign-record";
export const GROUP_FLAG = "group";
export const FOLDER_FLAG = "recordsFolder";

/** Build the namespaced JournalEntryPage sub-type id for a record kind. */
export function typeId(type) {
  return `${MODULE_ID}.${type}`;
}
```

`scripts/logic/visibility.mjs`:

```js
import { MODULE_ID, GROUP_FLAG } from "../constants.mjs";

/** Whether a record page should be shown to this user. GMs see everything. */
export function isRecordVisible(user, page) {
  if (user?.isGM) return true;
  return page?.system?.hidden !== true;
}

/** Only GMs may hide or reveal records. */
export function canSetHidden(user) {
  return user?.isGM === true;
}

/** Whether a plain flags object carries the campaign group flag. */
export function hasGroupFlag(flags) {
  return !!flags?.[MODULE_ID]?.[GROUP_FLAG];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/visibility.test.js`
Expected: PASS — 4 test groups, all green.

- [ ] **Step 5: Commit**

```bash
git add scripts/constants.mjs scripts/logic/visibility.mjs tests/visibility.test.js
git commit -m "feat: add constants and pure visibility helpers with unit tests"
```

---

### Task 3: Record data models and page type registration

**Files:**
- Create: `scripts/data/base-record.mjs`
- Create: `scripts/data/npc.mjs`
- Create: `scripts/data/place.mjs`
- Create: `scripts/data/quest.mjs`
- Create: `scripts/data/registration.mjs`
- Modify: `module.json` (add `documentTypes`)
- Modify: `lang/en.json` (add `TYPES` and field labels)
- Modify: `scripts/campaign-record.mjs` (call registration in `init`)

**Interfaces:**
- Consumes: `MODULE_ID`, `typeId()` from `scripts/constants.mjs`.
- Produces:
  - `BaseRecordModel` (extends `foundry.abstract.TypeDataModel`) with schema fields `description` (HTMLField), `gmNotes` (HTMLField), `image` (FilePathField), `tags` (SetField of StringField), `hidden` (BooleanField, initial false), `timepoints` (SetField of StringField)
  - `NpcModel` adding `role, location, race, gender, profession, voice, faction` (StringField), `status` (StringField, choices alive/dead/unknown, initial "unknown"), `actor` (DocumentUUIDField type Actor)
  - `PlaceModel` adding `location, government, size` (StringField), `placeType` (StringField, choices town/region/poi/feature, initial "poi"), `scene` (DocumentUUIDField type Scene)
  - `QuestModel` adding `source` (StringField), `status` (StringField, choices available/active/completed/failed/abandoned, initial "available"), `objectives` (ArrayField of SchemaField `{id, text, done, gmOnly}`), `rewards` (HTMLField), `parentQuest` (DocumentUUIDField type JournalEntryPage)
  - `registerDataModels(): void` from `scripts/data/registration.mjs`

- [ ] **Step 1: Write the base record data model**

`scripts/data/base-record.mjs`:

```js
const { HTMLField, FilePathField, BooleanField, StringField, SetField } = foundry.data.fields;

/** Fields shared by every Campaign Record page type. */
export class BaseRecordModel extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["CAMPAIGNRECORD.Common"];

  static defineSchema() {
    return {
      description: new HTMLField({ textSearch: true }),
      gmNotes: new HTMLField(),
      image: new FilePathField({ categories: ["IMAGE"] }),
      tags: new SetField(new StringField({ blank: false })),
      hidden: new BooleanField({ initial: false }),
      timepoints: new SetField(new StringField({ blank: false }))
    };
  }
}
```

- [ ] **Step 2: Write the NPC, Place, and Quest models**

`scripts/data/npc.mjs`:

```js
import { BaseRecordModel } from "./base-record.mjs";

const { StringField, DocumentUUIDField } = foundry.data.fields;

export const NPC_STATUSES = {
  alive: "CAMPAIGNRECORD.Npc.Status.alive",
  dead: "CAMPAIGNRECORD.Npc.Status.dead",
  unknown: "CAMPAIGNRECORD.Npc.Status.unknown"
};

export class NpcModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Npc"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      role: new StringField(),
      location: new StringField(),
      race: new StringField(),
      gender: new StringField(),
      profession: new StringField(),
      voice: new StringField(),
      faction: new StringField(),
      status: new StringField({ required: true, choices: NPC_STATUSES, initial: "unknown" }),
      actor: new DocumentUUIDField({ type: "Actor" })
    };
  }
}
```

`scripts/data/place.mjs`:

```js
import { BaseRecordModel } from "./base-record.mjs";

const { StringField, DocumentUUIDField } = foundry.data.fields;

export const PLACE_TYPES = {
  town: "CAMPAIGNRECORD.Place.Type.town",
  region: "CAMPAIGNRECORD.Place.Type.region",
  poi: "CAMPAIGNRECORD.Place.Type.poi",
  feature: "CAMPAIGNRECORD.Place.Type.feature"
};

export class PlaceModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Place"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      location: new StringField(),
      government: new StringField(),
      size: new StringField(),
      placeType: new StringField({ required: true, choices: PLACE_TYPES, initial: "poi" }),
      scene: new DocumentUUIDField({ type: "Scene" })
    };
  }
}
```

`scripts/data/quest.mjs`:

```js
import { BaseRecordModel } from "./base-record.mjs";

const { StringField, HTMLField, BooleanField, ArrayField, SchemaField, DocumentUUIDField } =
  foundry.data.fields;

export const QUEST_STATUSES = {
  available: "CAMPAIGNRECORD.Quest.Status.available",
  active: "CAMPAIGNRECORD.Quest.Status.active",
  completed: "CAMPAIGNRECORD.Quest.Status.completed",
  failed: "CAMPAIGNRECORD.Quest.Status.failed",
  abandoned: "CAMPAIGNRECORD.Quest.Status.abandoned"
};

export class QuestModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Quest"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      source: new StringField(),
      status: new StringField({ required: true, choices: QUEST_STATUSES, initial: "available" }),
      objectives: new ArrayField(
        new SchemaField({
          id: new StringField({ required: true, blank: false }),
          text: new StringField(),
          done: new BooleanField({ initial: false }),
          gmOnly: new BooleanField({ initial: false })
        })
      ),
      rewards: new HTMLField(),
      parentQuest: new DocumentUUIDField({ type: "JournalEntryPage" })
    };
  }
}
```

- [ ] **Step 3: Write the registration module and wire it into `init`**

`scripts/data/registration.mjs`:

```js
import { typeId } from "../constants.mjs";
import { NpcModel } from "./npc.mjs";
import { PlaceModel } from "./place.mjs";
import { QuestModel } from "./quest.mjs";

export function registerDataModels() {
  Object.assign(CONFIG.JournalEntryPage.dataModels, {
    [typeId("npc")]: NpcModel,
    [typeId("place")]: PlaceModel,
    [typeId("quest")]: QuestModel
  });
}
```

Replace the whole of `scripts/campaign-record.mjs` with:

```js
import { registerDataModels } from "./data/registration.mjs";

Hooks.once("init", () => {
  console.log("campaign-record | Initializing Campaign Record");
  registerDataModels();
});
```

- [ ] **Step 4: Declare the sub-types in `module.json` and add localization**

In `module.json`, add this top-level key (after `"languages"`):

```json
"documentTypes": {
  "JournalEntryPage": {
    "npc": {},
    "place": {},
    "quest": {}
  }
}
```

Replace `lang/en.json` with:

```json
{
  "TYPES": {
    "JournalEntryPage": {
      "campaign-record.npc": "NPC",
      "campaign-record.place": "Place",
      "campaign-record.quest": "Quest"
    }
  },
  "CAMPAIGNRECORD": {
    "ModuleName": "Campaign Record",
    "Common": {
      "FIELDS": {
        "description": { "label": "Description" },
        "gmNotes": { "label": "GM Notes" },
        "image": { "label": "Image" },
        "tags": { "label": "Tags" },
        "hidden": { "label": "Hidden from players" },
        "timepoints": { "label": "Timeline points" }
      }
    },
    "Npc": {
      "FIELDS": {
        "role": { "label": "Role" },
        "location": { "label": "Location" },
        "race": { "label": "Race" },
        "gender": { "label": "Gender" },
        "profession": { "label": "Profession" },
        "voice": { "label": "Voice" },
        "faction": { "label": "Faction" },
        "status": { "label": "Status" },
        "actor": { "label": "Linked Actor" }
      },
      "Status": { "alive": "Alive", "dead": "Dead", "unknown": "Unknown" }
    },
    "Place": {
      "FIELDS": {
        "location": { "label": "Located In" },
        "government": { "label": "Government" },
        "size": { "label": "Size" },
        "placeType": { "label": "Place Type" },
        "scene": { "label": "Linked Scene" }
      },
      "Type": { "town": "Town", "region": "Region", "poi": "Point of Interest", "feature": "Geographical Feature" }
    },
    "Quest": {
      "FIELDS": {
        "source": { "label": "Source" },
        "status": { "label": "Status" },
        "objectives": { "label": "Objectives" },
        "rewards": { "label": "Rewards" },
        "parentQuest": { "label": "Parent Quest" }
      },
      "Status": { "available": "Available", "active": "Active", "completed": "Completed", "failed": "Failed", "abandoned": "Abandoned" }
    }
  }
}
```

- [ ] **Step 5: Verify in Foundry** *(Manual checkpoint)*

Reload the world (F5). In the browser console run:

```js
const e = await JournalEntry.create({ name: "Model Smoke Test" });
const [p] = await e.createEmbeddedDocuments("JournalEntryPage", [
  { name: "Gandalf", type: "campaign-record.npc" }
]);
console.log(p.system.constructor.name, p.system.status, p.system.hidden);
await e.delete();
```

Expected output: `NpcModel unknown false`. Also verify the journal "Create Page" dialog now lists NPC, Place, and Quest types with localized names.

- [ ] **Step 6: Run the unit suite (regression)**

Run: `npm test`
Expected: PASS — Task 2 tests still green (data model files are not imported by Vitest tests).

- [ ] **Step 7: Commit**

```bash
git add scripts/data/ module.json lang/en.json scripts/campaign-record.mjs
git commit -m "feat: add NPC, Place, and Quest page data models and type registration"
```

---

### Task 4: Group management and hidden-record enforcement

**Files:**
- Create: `scripts/data/groups.mjs`
- Create: `scripts/hooks/guards.mjs`
- Modify: `scripts/campaign-record.mjs`
- Modify: `lang/en.json` (warning + folder name keys)

**Interfaces:**
- Consumes: `MODULE_ID`, `GROUP_FLAG`, `FOLDER_FLAG` from `scripts/constants.mjs`; `canSetHidden` from `scripts/logic/visibility.mjs`.
- Produces (from `scripts/data/groups.mjs`):
  - `isGroup(entry: JournalEntry): boolean`
  - `getGroups(): JournalEntry[]`
  - `getRecordsFolder(): Folder | undefined` (sync lookup, no creation)
  - `ensureRecordsFolder(): Promise<Folder>` (creates if missing; GM only)
  - `createGroup(name: string): Promise<JournalEntry>`
  - `setRecordHidden(page: JournalEntryPage, hidden: boolean): Promise<JournalEntryPage>`
  - `registerUpdateGuards(): void` from `scripts/hooks/guards.mjs`

- [ ] **Step 1: Write the group management module**

`scripts/data/groups.mjs`:

```js
import { MODULE_ID, GROUP_FLAG, FOLDER_FLAG } from "../constants.mjs";

/** Whether a JournalEntry is a Campaign Record group. */
export function isGroup(entry) {
  return !!entry?.getFlag(MODULE_ID, GROUP_FLAG);
}

/** All Campaign Record groups in this world. */
export function getGroups() {
  return game.journal.filter(isGroup);
}

/** The module's journal folder, if it exists. Does not create it. */
export function getRecordsFolder() {
  return game.folders.find(
    (f) => f.type === "JournalEntry" && f.getFlag(MODULE_ID, FOLDER_FLAG)
  );
}

/** Find or create the module's journal folder. Creation requires GM privileges. */
export async function ensureRecordsFolder() {
  let folder = getRecordsFolder();
  folder ??= await Folder.create({
    name: game.i18n.localize("CAMPAIGNRECORD.RecordsFolder"),
    type: "JournalEntry",
    flags: { [MODULE_ID]: { [FOLDER_FLAG]: true } }
  });
  return folder;
}

/**
 * Create a new campaign group: a JournalEntry flagged as a group, owned by
 * everyone (default OWNER) so all players can add and edit records.
 */
export async function createGroup(name) {
  let folderId = getRecordsFolder()?.id ?? null;
  if (!folderId && game.user.isGM) folderId = (await ensureRecordsFolder()).id;
  return JournalEntry.create({
    name,
    folder: folderId,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
    flags: { [MODULE_ID]: { [GROUP_FLAG]: { timepoints: [] } } }
  });
}

/**
 * Hide or reveal a record. Hiding also drops the page's default ownership to
 * NONE so core Foundry filters it from players everywhere (TOC, links, search);
 * revealing restores inheritance from the group entry.
 */
export async function setRecordHidden(page, hidden) {
  const ownershipDefault = hidden
    ? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE
    : CONST.DOCUMENT_META_OWNERSHIP_LEVELS.DEFAULT;
  return page.update({ "system.hidden": hidden, "ownership.default": ownershipDefault });
}
```

- [ ] **Step 2: Write the update guard**

`scripts/hooks/guards.mjs`:

```js
import { canSetHidden } from "../logic/visibility.mjs";

/**
 * Client-side guard: prevent non-GM users from flipping the hidden flag.
 * Render-time secrecy is the accepted norm (see spec); this guard is advisory
 * and runs on the initiating client.
 */
export function registerUpdateGuards() {
  Hooks.on("preUpdateJournalEntryPage", (page, changes) => {
    if (canSetHidden(game.user)) return;
    if (foundry.utils.hasProperty(changes, "system.hidden")) {
      delete changes.system.hidden;
      ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Warning.HiddenGMOnly"));
    }
    if (foundry.utils.hasProperty(changes, "ownership")) {
      delete changes.ownership;
    }
  });
}
```

- [ ] **Step 3: Wire into the entry module and add strings**

Replace `scripts/campaign-record.mjs` with:

```js
import { registerDataModels } from "./data/registration.mjs";
import { registerUpdateGuards } from "./hooks/guards.mjs";
import { ensureRecordsFolder } from "./data/groups.mjs";

Hooks.once("init", () => {
  console.log("campaign-record | Initializing Campaign Record");
  registerDataModels();
  registerUpdateGuards();
});

Hooks.once("ready", () => {
  if (game.user.isGM) ensureRecordsFolder();
});
```

In `lang/en.json`, inside the `CAMPAIGNRECORD` object (sibling of `"ModuleName"`), add:

```json
"RecordsFolder": "Campaign Records",
"Warning": {
  "HiddenGMOnly": "Only a Gamemaster can hide or reveal records."
}
```

- [ ] **Step 4: Verify in Foundry** *(Manual checkpoint)*

Reload as GM. Expected: a "Campaign Records" journal folder appears. In the console:

```js
const { createGroup, isGroup, setRecordHidden } = await import("/modules/campaign-record/scripts/data/groups.mjs");
const g = await createGroup("Curse of Strahd");
console.log(isGroup(g), g.ownership.default === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER, g.folder?.name);
const [p] = await g.createEmbeddedDocuments("JournalEntryPage", [{ name: "Strahd", type: "campaign-record.npc" }]);
await setRecordHidden(p, true);
console.log(p.system.hidden, p.ownership.default === CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE);
await g.delete();
```

Expected: `true true Campaign Records` then `true true`.

- [ ] **Step 5: Run the unit suite (regression)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/data/groups.mjs scripts/hooks/guards.mjs scripts/campaign-record.mjs lang/en.json
git commit -m "feat: add campaign group management and hidden-record enforcement"
```

---

### Task 5: Create-group UI in the journal sidebar

**Files:**
- Create: `scripts/apps/create-group-dialog.mjs`
- Create: `scripts/hooks/directory.mjs`
- Modify: `scripts/campaign-record.mjs`
- Modify: `lang/en.json`

**Interfaces:**
- Consumes: `createGroup(name)` from `scripts/data/groups.mjs`.
- Produces: `promptCreateGroup(): Promise<JournalEntry|null>` from `scripts/apps/create-group-dialog.mjs`; `registerDirectoryUI(): void` from `scripts/hooks/directory.mjs`.

- [ ] **Step 1: Write the dialog**

`scripts/apps/create-group-dialog.mjs`:

```js
import { createGroup } from "../data/groups.mjs";

/** Prompt for a group name, create the group, and open its sheet. */
export async function promptCreateGroup() {
  const name = await foundry.applications.api.DialogV2.prompt({
    window: { title: "CAMPAIGNRECORD.CreateGroup" },
    content: `
      <div class="form-group">
        <label>${game.i18n.localize("CAMPAIGNRECORD.GroupName")}</label>
        <input type="text" name="name" required autofocus>
      </div>`,
    ok: {
      label: "CAMPAIGNRECORD.Create",
      callback: (event, button) => button.form.elements.name.value.trim()
    },
    rejectClose: false
  });
  if (!name) return null;
  const group = await createGroup(name);
  group.sheet.render(true);
  return group;
}
```

- [ ] **Step 2: Write the directory hook**

`scripts/hooks/directory.mjs`:

```js
import { promptCreateGroup } from "../apps/create-group-dialog.mjs";

/**
 * Add a "Create Campaign Group" button to the journal sidebar footer.
 * Available to any user with the Create Journal Entries permission.
 * In v13 the render hook receives an HTMLElement (ApplicationV2).
 */
export function registerDirectoryUI() {
  Hooks.on("renderJournalDirectory", (app, html) => {
    if (!game.user.can("JOURNAL_CREATE")) return;
    if (html.querySelector(".campaign-record-create-group")) return;
    const footer = html.querySelector(".directory-footer") ?? html;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "campaign-record-create-group";
    btn.innerHTML = `<i class="fa-solid fa-book-atlas"></i> ${game.i18n.localize("CAMPAIGNRECORD.CreateGroup")}`;
    btn.addEventListener("click", () => promptCreateGroup());
    footer.append(btn);
  });
}
```

- [ ] **Step 3: Wire in and add strings**

In `scripts/campaign-record.mjs`, add the import and call `registerDirectoryUI()` inside the `init` hook (after `registerUpdateGuards()`):

```js
import { registerDirectoryUI } from "./hooks/directory.mjs";
```

In `lang/en.json` under `CAMPAIGNRECORD`, add:

```json
"CreateGroup": "Create Campaign Group",
"GroupName": "Group Name",
"Create": "Create"
```

- [ ] **Step 4: Verify in Foundry** *(Manual checkpoint)*

Reload. Open the Journal sidebar tab. Expected: a "Create Campaign Group" button in the footer. Click it, enter "Test Arc", submit. Expected: a journal entry "Test Arc" opens, filed under Campaign Records. Log in as a player (second browser): the button appears only if that player has the Create Journal Entries permission, and the player can open "Test Arc" and add pages to it (default OWNER). Delete "Test Arc" afterward.

- [ ] **Step 5: Commit**

```bash
git add scripts/apps/create-group-dialog.mjs scripts/hooks/directory.mjs scripts/campaign-record.mjs lang/en.json
git commit -m "feat: add create-group button and dialog to the journal sidebar"
```

---

### Task 6: Base record sheet and NPC sheet

**Files:**
- Create: `scripts/sheets/base-record-sheet.mjs`
- Create: `scripts/sheets/npc-sheet.mjs`
- Create: `scripts/sheets/registration.mjs`
- Create: `templates/partials/common-edit.hbs`
- Create: `templates/partials/common-view.hbs`
- Create: `templates/npc/edit.hbs`
- Create: `templates/npc/view.hbs`
- Modify: `scripts/campaign-record.mjs`
- Modify: `lang/en.json`

**Interfaces:**
- Consumes: `MODULE_ID`, `typeId()` from `scripts/constants.mjs`; `NpcModel` (registered in Task 3); `setRecordHidden` from `scripts/data/groups.mjs`.
- Produces:
  - `BaseRecordSheet` extending `foundry.applications.sheets.journal.JournalEntryPageHandlebarsSheet`, providing `_prepareContext` (context keys: `page`, `system`, `systemFields`, `isGM`, `enriched.description`, `enriched.gmNotes`), a `toggleHidden` action, and drag-drop binding to elements matching `.campaign-record-drop`, dispatching to `_onDropDocument(data)` (subclasses override).
  - `NpcSheet` extending `BaseRecordSheet` (adds `enriched.actorLink`, accepts Actor drops).
  - `registerSheets(): void` from `scripts/sheets/registration.mjs` — Task 7 and Task 8 add their `registerSheet` calls here.
  - Handlebars partials `campaign-record.common-edit` and `campaign-record.common-view` used by all record templates.

- [ ] **Step 1: Verify the v13 page sheet API surface** *(Manual checkpoint)*

In the Foundry console run:

```js
console.log(Object.keys(foundry.applications.sheets.journal));
const S = foundry.applications.sheets.journal.JournalEntryPageHandlebarsSheet;
console.log(Object.keys(S.EDIT_PARTS), Object.keys(S.VIEW_PARTS));
```

Expected: the class list includes `JournalEntryPageHandlebarsSheet`; `EDIT_PARTS` includes a `header` and `content` part and `VIEW_PARTS` includes a `content` part. If the class or part names differ in your v13 build, note the actual names and substitute them consistently in Steps 2–4 (the only permitted deviation is renaming the base class / part keys to match the installed API — record what you changed in the commit message).

- [ ] **Step 2: Write the base record sheet**

`scripts/sheets/base-record-sheet.mjs`:

```js
import { setRecordHidden } from "../data/groups.mjs";

const { JournalEntryPageHandlebarsSheet } = foundry.applications.sheets.journal;
const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

/** Shared behavior for all Campaign Record page sheets. */
export class BaseRecordSheet extends JournalEntryPageHandlebarsSheet {
  static DEFAULT_OPTIONS = {
    classes: ["campaign-record", "record-sheet"],
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      toggleHidden: BaseRecordSheet.#onToggleHidden
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    context.page = this.document;
    context.system = system;
    context.systemFields = system.schema.fields;
    context.isGM = game.user.isGM;
    context.enriched = {
      description: await TextEditorImpl.enrichHTML(system.description, {
        relativeTo: this.document
      }),
      gmNotes: game.user.isGM
        ? await TextEditorImpl.enrichHTML(system.gmNotes, { relativeTo: this.document })
        : ""
    };
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".campaign-record-drop",
      callbacks: { drop: this.#onDrop.bind(this) }
    }).bind(this.element);
  }

  async #onDrop(event) {
    const data = TextEditorImpl.getDragEventData(event);
    return this._onDropDocument(data);
  }

  /** Subclasses override to accept dropped documents ({type, uuid}). */
  async _onDropDocument(data) {}

  static async #onToggleHidden() {
    if (!game.user.isGM) return;
    await setRecordHidden(this.document, !this.document.system.hidden);
  }
}
```

- [ ] **Step 3: Write the shared partials**

`templates/partials/common-edit.hbs`:

```hbs
{{formGroup systemFields.image value=system.image localize=true}}
{{formGroup systemFields.tags value=system.tags localize=true}}
{{#if isGM}}
<div class="form-group gm-only">
  <label>{{localize "CAMPAIGNRECORD.Common.FIELDS.hidden.label"}}</label>
  <button type="button" data-action="toggleHidden">
    {{#if system.hidden}}
      <i class="fa-solid fa-eye-slash"></i> {{localize "CAMPAIGNRECORD.Hidden"}}
    {{else}}
      <i class="fa-solid fa-eye"></i> {{localize "CAMPAIGNRECORD.Visible"}}
    {{/if}}
  </button>
</div>
{{/if}}
<div class="form-group stacked">
  <label>{{localize "CAMPAIGNRECORD.Common.FIELDS.description.label"}}</label>
  <prose-mirror name="system.description" toggled collaborate>{{{enriched.description}}}</prose-mirror>
</div>
{{#if isGM}}
<div class="form-group stacked gm-only">
  <label>{{localize "CAMPAIGNRECORD.Common.FIELDS.gmNotes.label"}}</label>
  <prose-mirror name="system.gmNotes" toggled collaborate>{{{enriched.gmNotes}}}</prose-mirror>
</div>
{{/if}}
```

`templates/partials/common-view.hbs`:

```hbs
{{#if system.image}}<img class="record-image" src="{{system.image}}" alt="{{page.name}}">{{/if}}
<section class="record-description">{{{enriched.description}}}</section>
{{#if isGM}}{{#if enriched.gmNotes}}
<section class="gm-only">
  <h3>{{localize "CAMPAIGNRECORD.Common.FIELDS.gmNotes.label"}}</h3>
  {{{enriched.gmNotes}}}
</section>
{{/if}}{{/if}}
```

- [ ] **Step 4: Write the NPC sheet and templates**

`scripts/sheets/npc-sheet.mjs`:

```js
import { BaseRecordSheet } from "./base-record-sheet.mjs";

const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

export class NpcSheet extends BaseRecordSheet {
  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/npc/edit.hbs" }
  };

  static VIEW_PARTS = {
    content: { template: "modules/campaign-record/templates/npc/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.enriched.actorLink = this.document.system.actor
      ? await TextEditorImpl.enrichHTML(`@UUID[${this.document.system.actor}]`)
      : "";
    return context;
  }

  async _onDropDocument(data) {
    if (data.type !== "Actor") return;
    await this.document.update({ "system.actor": data.uuid });
  }
}
```

`templates/npc/edit.hbs`:

```hbs
<div class="form-fields-grid">
  {{formGroup systemFields.role value=system.role localize=true}}
  {{formGroup systemFields.location value=system.location localize=true}}
  {{formGroup systemFields.race value=system.race localize=true}}
  {{formGroup systemFields.gender value=system.gender localize=true}}
  {{formGroup systemFields.profession value=system.profession localize=true}}
  {{formGroup systemFields.voice value=system.voice localize=true}}
  {{formGroup systemFields.faction value=system.faction localize=true}}
  {{formGroup systemFields.status value=system.status localize=true}}
</div>
<div class="form-group campaign-record-drop">
  <label>{{localize "CAMPAIGNRECORD.Npc.FIELDS.actor.label"}}</label>
  {{#if enriched.actorLink}}{{{enriched.actorLink}}}{{else}}
    <span class="hint">{{localize "CAMPAIGNRECORD.DropActorHint"}}</span>
  {{/if}}
</div>
{{> campaign-record.common-edit}}
```

`templates/npc/view.hbs`:

```hbs
<dl class="record-facts">
  {{#if system.role}}<dt>{{localize "CAMPAIGNRECORD.Npc.FIELDS.role.label"}}</dt><dd>{{system.role}}</dd>{{/if}}
  {{#if system.location}}<dt>{{localize "CAMPAIGNRECORD.Npc.FIELDS.location.label"}}</dt><dd>{{system.location}}</dd>{{/if}}
  {{#if system.race}}<dt>{{localize "CAMPAIGNRECORD.Npc.FIELDS.race.label"}}</dt><dd>{{system.race}}</dd>{{/if}}
  {{#if system.gender}}<dt>{{localize "CAMPAIGNRECORD.Npc.FIELDS.gender.label"}}</dt><dd>{{system.gender}}</dd>{{/if}}
  {{#if system.profession}}<dt>{{localize "CAMPAIGNRECORD.Npc.FIELDS.profession.label"}}</dt><dd>{{system.profession}}</dd>{{/if}}
  {{#if system.voice}}<dt>{{localize "CAMPAIGNRECORD.Npc.FIELDS.voice.label"}}</dt><dd>{{system.voice}}</dd>{{/if}}
  {{#if system.faction}}<dt>{{localize "CAMPAIGNRECORD.Npc.FIELDS.faction.label"}}</dt><dd>{{system.faction}}</dd>{{/if}}
  <dt>{{localize "CAMPAIGNRECORD.Npc.FIELDS.status.label"}}</dt><dd>{{system.status}}</dd>
  {{#if enriched.actorLink}}<dt>{{localize "CAMPAIGNRECORD.Npc.FIELDS.actor.label"}}</dt><dd>{{{enriched.actorLink}}}</dd>{{/if}}
</dl>
{{> campaign-record.common-view}}
```

- [ ] **Step 5: Write sheet registration and wire in**

`scripts/sheets/registration.mjs`:

```js
import { MODULE_ID, typeId } from "../constants.mjs";
import { NpcSheet } from "./npc-sheet.mjs";

const { DocumentSheetConfig } = foundry.applications.apps;

export function registerSheets() {
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, NpcSheet, {
    types: [typeId("npc")],
    makeDefault: true,
    label: "CAMPAIGNRECORD.Sheets.Npc"
  });
}

export function registerPartials() {
  return foundry.applications.handlebars.loadTemplates({
    "campaign-record.common-edit": "modules/campaign-record/templates/partials/common-edit.hbs",
    "campaign-record.common-view": "modules/campaign-record/templates/partials/common-view.hbs"
  });
}
```

In `scripts/campaign-record.mjs`, add to `init` (after `registerDataModels()`):

```js
import { registerSheets, registerPartials } from "./sheets/registration.mjs";
```

```js
  registerSheets();
  registerPartials();
```

In `lang/en.json` under `CAMPAIGNRECORD`, add:

```json
"Hidden": "Hidden",
"Visible": "Visible",
"DropActorHint": "Drop an Actor here to link it.",
"Sheets": {
  "Npc": "Campaign Record NPC Sheet",
  "Place": "Campaign Record Place Sheet",
  "Quest": "Campaign Record Quest Sheet"
}
```

- [ ] **Step 6: Verify in Foundry, including collaboration** *(Manual checkpoint)*

Reload. Create a group, add an NPC page. Expected:
1. Edit mode shows the structured field grid, actor drop zone, image/tags, hidden toggle (GM), and description/GM-notes editors; changing a field and clicking elsewhere persists it (submitOnChange).
2. Drag an Actor from the sidebar onto the drop zone — a content link to it appears.
3. View mode shows the fact list and enriched description; a logged-in player does **not** see GM Notes.
4. **Collaboration:** open the same NPC's description editor in two browsers (GM + player) and type in both — both cursors' text appears live. If live co-editing does not engage with the `<prose-mirror collaborate>` element, replace that element in `common-edit.hbs` with a `<div class="editor" data-field="system.description"></div>` and activate it in `BaseRecordSheet._onRender` via `ProseMirrorEditor.create(el, value, { document: this.document, fieldName: el.dataset.field, collaborate: true })` — apply the same treatment to `gmNotes`, and note the deviation in the commit message.
5. Toggle hidden as GM: player's journal TOC no longer lists the page (ownership NONE). Reveal: it returns.

- [ ] **Step 7: Run the unit suite (regression)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/sheets/ templates/ scripts/campaign-record.mjs lang/en.json
git commit -m "feat: add base record sheet and NPC sheet with collaborative editing"
```

---

### Task 7: Place sheet

**Files:**
- Create: `scripts/sheets/place-sheet.mjs`
- Create: `templates/place/edit.hbs`
- Create: `templates/place/view.hbs`
- Modify: `scripts/sheets/registration.mjs`
- Modify: `lang/en.json`

**Interfaces:**
- Consumes: `BaseRecordSheet` (context keys `system`, `systemFields`, `isGM`, `enriched`; `_onDropDocument(data)` override point; partials `campaign-record.common-edit` / `campaign-record.common-view`); `typeId()`, `MODULE_ID`.
- Produces: `PlaceSheet` registered as default for `campaign-record.place`.

- [ ] **Step 1: Write the Place sheet**

`scripts/sheets/place-sheet.mjs`:

```js
import { BaseRecordSheet } from "./base-record-sheet.mjs";

const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

export class PlaceSheet extends BaseRecordSheet {
  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/place/edit.hbs" }
  };

  static VIEW_PARTS = {
    content: { template: "modules/campaign-record/templates/place/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.enriched.sceneLink = this.document.system.scene
      ? await TextEditorImpl.enrichHTML(`@UUID[${this.document.system.scene}]`)
      : "";
    return context;
  }

  async _onDropDocument(data) {
    if (data.type !== "Scene") return;
    await this.document.update({ "system.scene": data.uuid });
  }
}
```

- [ ] **Step 2: Write the templates**

`templates/place/edit.hbs`:

```hbs
<div class="form-fields-grid">
  {{formGroup systemFields.placeType value=system.placeType localize=true}}
  {{formGroup systemFields.location value=system.location localize=true}}
  {{formGroup systemFields.government value=system.government localize=true}}
  {{formGroup systemFields.size value=system.size localize=true}}
</div>
<div class="form-group campaign-record-drop">
  <label>{{localize "CAMPAIGNRECORD.Place.FIELDS.scene.label"}}</label>
  {{#if enriched.sceneLink}}{{{enriched.sceneLink}}}{{else}}
    <span class="hint">{{localize "CAMPAIGNRECORD.DropSceneHint"}}</span>
  {{/if}}
</div>
{{> campaign-record.common-edit}}
```

`templates/place/view.hbs`:

```hbs
<dl class="record-facts">
  <dt>{{localize "CAMPAIGNRECORD.Place.FIELDS.placeType.label"}}</dt><dd>{{system.placeType}}</dd>
  {{#if system.location}}<dt>{{localize "CAMPAIGNRECORD.Place.FIELDS.location.label"}}</dt><dd>{{system.location}}</dd>{{/if}}
  {{#if system.government}}<dt>{{localize "CAMPAIGNRECORD.Place.FIELDS.government.label"}}</dt><dd>{{system.government}}</dd>{{/if}}
  {{#if system.size}}<dt>{{localize "CAMPAIGNRECORD.Place.FIELDS.size.label"}}</dt><dd>{{system.size}}</dd>{{/if}}
  {{#if enriched.sceneLink}}<dt>{{localize "CAMPAIGNRECORD.Place.FIELDS.scene.label"}}</dt><dd>{{{enriched.sceneLink}}}</dd>{{/if}}
</dl>
{{> campaign-record.common-view}}
```

- [ ] **Step 3: Register the sheet and add strings**

In `scripts/sheets/registration.mjs`, add the import and, inside `registerSheets()`, after the NPC registration:

```js
import { PlaceSheet } from "./place-sheet.mjs";
```

```js
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, PlaceSheet, {
    types: [typeId("place")],
    makeDefault: true,
    label: "CAMPAIGNRECORD.Sheets.Place"
  });
```

In `lang/en.json` under `CAMPAIGNRECORD`, add:

```json
"DropSceneHint": "Drop a Scene here to link it."
```

- [ ] **Step 4: Verify in Foundry** *(Manual checkpoint)*

Reload; add a Place page to a group. Expected: type/location/government/size fields, scene drop zone works with a Scene from the sidebar, view mode renders the fact list, description edits collaboratively.

- [ ] **Step 5: Run the unit suite (regression)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/sheets/place-sheet.mjs templates/place/ scripts/sheets/registration.mjs lang/en.json
git commit -m "feat: add Place record sheet"
```

---

### Task 8: Quest sheet with objectives

**Files:**
- Create: `scripts/sheets/quest-sheet.mjs`
- Create: `templates/quest/edit.hbs`
- Create: `templates/quest/view.hbs`
- Modify: `scripts/sheets/registration.mjs`
- Modify: `lang/en.json`

**Interfaces:**
- Consumes: `BaseRecordSheet`, `QuestModel` (`objectives` items `{id, text, done, gmOnly}`), partials, `typeId()`, `MODULE_ID`.
- Produces: `QuestSheet` registered as default for `campaign-record.quest`. Objective mutations are **targeted immediate array updates** (spec requirement), via actions `addObjective`, `deleteObjective`, `toggleObjective`, `toggleObjectiveGmOnly` — `toggleObjective` also works from view mode so players can check off objectives.

- [ ] **Step 1: Write the Quest sheet**

`scripts/sheets/quest-sheet.mjs`:

```js
import { BaseRecordSheet } from "./base-record-sheet.mjs";

const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

export class QuestSheet extends BaseRecordSheet {
  static DEFAULT_OPTIONS = {
    actions: {
      addObjective: QuestSheet.#onAddObjective,
      deleteObjective: QuestSheet.#onDeleteObjective,
      toggleObjective: QuestSheet.#onToggleObjective,
      toggleObjectiveGmOnly: QuestSheet.#onToggleObjectiveGmOnly
    }
  };

  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/quest/edit.hbs" }
  };

  static VIEW_PARTS = {
    content: { template: "modules/campaign-record/templates/quest/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    context.enriched.rewards = await TextEditorImpl.enrichHTML(system.rewards, {
      relativeTo: this.document
    });
    context.objectives = system.objectives.filter((o) => game.user.isGM || !o.gmOnly);
    return context;
  }

  /** Read, mutate, and write the objectives array as one targeted update. */
  async #updateObjectives(mutate) {
    const objectives = this.document.system.toObject().objectives;
    mutate(objectives);
    await this.document.update({ "system.objectives": objectives });
  }

  static async #onAddObjective() {
    await this.#updateObjectives((objectives) =>
      objectives.push({ id: foundry.utils.randomID(), text: "", done: false, gmOnly: false })
    );
  }

  static async #onDeleteObjective(event, target) {
    const id = target.closest("[data-objective-id]").dataset.objectiveId;
    await this.#updateObjectives((objectives) => {
      const i = objectives.findIndex((o) => o.id === id);
      if (i >= 0) objectives.splice(i, 1);
    });
  }

  static async #onToggleObjective(event, target) {
    const id = target.closest("[data-objective-id]").dataset.objectiveId;
    await this.#updateObjectives((objectives) => {
      const o = objectives.find((x) => x.id === id);
      if (o) o.done = !o.done;
    });
  }

  static async #onToggleObjectiveGmOnly(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-objective-id]").dataset.objectiveId;
    await this.#updateObjectives((objectives) => {
      const o = objectives.find((x) => x.id === id);
      if (o) o.gmOnly = !o.gmOnly;
    });
  }
}
```

- [ ] **Step 2: Write the templates**

`templates/quest/edit.hbs`:

```hbs
<div class="form-fields-grid">
  {{formGroup systemFields.source value=system.source localize=true}}
  {{formGroup systemFields.status value=system.status localize=true}}
</div>
<fieldset class="quest-objectives">
  <legend>{{localize "CAMPAIGNRECORD.Quest.FIELDS.objectives.label"}}</legend>
  <ol>
    {{#each objectives}}
    <li data-objective-id="{{this.id}}" class="{{#if this.gmOnly}}gm-only{{/if}}">
      <input type="checkbox" data-action="toggleObjective" {{#if this.done}}checked{{/if}}>
      <input type="text" name="system.objectives.{{@index}}.text" value="{{this.text}}"
             {{#unless @root.isGM}}disabled{{/unless}}>
      {{#if @root.isGM}}
      <button type="button" data-action="toggleObjectiveGmOnly"
              data-tooltip="CAMPAIGNRECORD.ObjectiveGmOnly">
        <i class="fa-solid {{#if this.gmOnly}}fa-eye-slash{{else}}fa-eye{{/if}}"></i>
      </button>
      {{/if}}
      <button type="button" data-action="deleteObjective"><i class="fa-solid fa-trash"></i></button>
    </li>
    {{/each}}
  </ol>
  <button type="button" data-action="addObjective">
    <i class="fa-solid fa-plus"></i> {{localize "CAMPAIGNRECORD.AddObjective"}}
  </button>
</fieldset>
<div class="form-group stacked">
  <label>{{localize "CAMPAIGNRECORD.Quest.FIELDS.rewards.label"}}</label>
  <prose-mirror name="system.rewards" toggled collaborate>{{{enriched.rewards}}}</prose-mirror>
</div>
{{> campaign-record.common-edit}}
```

Note: editing objective *text* uses the indexed `name` path and saves via `submitOnChange` (GM only — indexes align because the GM sees the unfiltered array), while add/delete/done/gmOnly go through the targeted-update actions. Players see a `gmOnly`-filtered array, so their indexed paths would misalign with the stored array — that is why their text inputs are `disabled` above; players interact through the checkbox action only, which updates by objective id, never by index.

`templates/quest/view.hbs`:

```hbs
<dl class="record-facts">
  {{#if system.source}}<dt>{{localize "CAMPAIGNRECORD.Quest.FIELDS.source.label"}}</dt><dd>{{system.source}}</dd>{{/if}}
  <dt>{{localize "CAMPAIGNRECORD.Quest.FIELDS.status.label"}}</dt><dd>{{system.status}}</dd>
</dl>
<section class="quest-objectives">
  <h3>{{localize "CAMPAIGNRECORD.Quest.FIELDS.objectives.label"}}</h3>
  <ol>
    {{#each objectives}}
    <li data-objective-id="{{this.id}}" class="{{#if this.gmOnly}}gm-only{{/if}}">
      <input type="checkbox" data-action="toggleObjective" {{#if this.done}}checked{{/if}}>
      <span class="{{#if this.done}}done{{/if}}">{{this.text}}</span>
    </li>
    {{/each}}
  </ol>
</section>
{{#if enriched.rewards}}
<section class="quest-rewards">
  <h3>{{localize "CAMPAIGNRECORD.Quest.FIELDS.rewards.label"}}</h3>
  {{{enriched.rewards}}}
</section>
{{/if}}
{{> campaign-record.common-view}}
```

- [ ] **Step 3: Register, style, and add strings**

In `scripts/sheets/registration.mjs`, add the import and registration inside `registerSheets()`:

```js
import { QuestSheet } from "./quest-sheet.mjs";
```

```js
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, QuestSheet, {
    types: [typeId("quest")],
    makeDefault: true,
    label: "CAMPAIGNRECORD.Sheets.Quest"
  });
```

In `lang/en.json` under `CAMPAIGNRECORD`, add:

```json
"AddObjective": "Add Objective",
"ObjectiveGmOnly": "Toggle GM-only"
```

Append to `styles/campaign-record.css`:

```css
.campaign-record .quest-objectives li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.campaign-record .quest-objectives .done {
  text-decoration: line-through;
  opacity: 0.7;
}
```

- [ ] **Step 4: Verify in Foundry** *(Manual checkpoint)*

Reload; add a Quest to a group. Expected:
1. Add three objectives; type text; toggle one done; delete one — each action persists instantly and re-renders.
2. Mark one objective GM-only: a player viewing the quest does not see it; the GM sees it with the eye-slash marker.
3. As a player in **view** mode, click an objective checkbox — it toggles (targeted update by id).
4. Two clients toggling different objectives in quick succession: both changes survive.

- [ ] **Step 5: Run the unit suite (regression)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/sheets/quest-sheet.mjs templates/quest/ scripts/sheets/registration.mjs lang/en.json styles/campaign-record.css
git commit -m "feat: add Quest record sheet with targeted objective updates"
```

---

### Task 9: Quench integration suite

**Files:**
- Create: `scripts/testing/quench.mjs`
- Modify: `scripts/campaign-record.mjs`

**Interfaces:**
- Consumes: `createGroup`, `isGroup`, `setRecordHidden` from `scripts/data/groups.mjs`; `typeId()` from `scripts/constants.mjs`.
- Produces: Quench batch `campaign-record.core` (runs only when the Quench module is installed and active; the hook simply never fires otherwise).

- [ ] **Step 1: Write the Quench batch**

`scripts/testing/quench.mjs`:

```js
import { createGroup, isGroup, setRecordHidden } from "../data/groups.mjs";
import { typeId } from "../constants.mjs";

Hooks.on("quenchReady", (quench) => {
  quench.registerBatch(
    "campaign-record.core",
    (context) => {
      const { describe, it, assert, before, after } = context;
      let group;

      describe("Campaign groups", () => {
        before(async () => {
          group = await createGroup("Quench Test Group");
        });
        after(async () => {
          await group.delete();
        });

        it("carries the group flag", () => {
          assert.ok(isGroup(group));
          assert.deepEqual(group.getFlag("campaign-record", "group"), { timepoints: [] });
        });

        it("grants default OWNER ownership", () => {
          assert.equal(group.ownership.default, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
        });

        it("creates typed record pages with schema defaults", async () => {
          const [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
            { name: "Quench NPC", type: typeId("npc") }
          ]);
          assert.equal(page.system.status, "unknown");
          assert.equal(page.system.hidden, false);
          assert.deepEqual(page.system.tags.size, 0);
        });

        it("quest objectives round-trip through a targeted update", async () => {
          const [quest] = await group.createEmbeddedDocuments("JournalEntryPage", [
            { name: "Quench Quest", type: typeId("quest") }
          ]);
          const objectives = quest.system.toObject().objectives;
          objectives.push({ id: foundry.utils.randomID(), text: "Find the macguffin", done: false, gmOnly: false });
          await quest.update({ "system.objectives": objectives });
          assert.equal(quest.system.objectives.length, 1);
          assert.equal(quest.system.objectives[0].text, "Find the macguffin");
        });

        it("setRecordHidden syncs the ownership default", async () => {
          const [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
            { name: "Quench Secret", type: typeId("place") }
          ]);
          await setRecordHidden(page, true);
          assert.equal(page.system.hidden, true);
          assert.equal(page.ownership.default, CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE);
          await setRecordHidden(page, false);
          assert.equal(page.system.hidden, false);
          assert.equal(page.ownership.default, CONST.DOCUMENT_META_OWNERSHIP_LEVELS.DEFAULT);
        });
      });
    },
    { displayName: "Campaign Record: Core" }
  );
});
```

- [ ] **Step 2: Wire in**

In `scripts/campaign-record.mjs`, add at the top of the imports:

```js
import "./testing/quench.mjs";
```

- [ ] **Step 3: Run the batch** *(Manual checkpoint)*

Install and enable the Quench module in the test world. Open Quench from the sidebar, run "Campaign Record: Core". Expected: all 5 tests pass.

- [ ] **Step 4: Run the unit suite (regression)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/testing/quench.mjs scripts/campaign-record.mjs
git commit -m "test: add Quench integration suite for groups and records"
```

---

### Task 10: README and manual multi-client checklist

**Files:**
- Modify: `README.md`
- Create: `docs/manual-test-checklist.md`

**Interfaces:**
- Consumes: everything shipped in Tasks 1–9.
- Produces: contributor/user documentation; the release checklist the spec requires ("manual multi-client checklist … run before each release").

- [ ] **Step 1: Write the README**

Replace `README.md` with:

```markdown
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
```

- [ ] **Step 2: Write the manual checklist**

`docs/manual-test-checklist.md`:

```markdown
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
```

- [ ] **Step 3: Run the full checklist once** *(Manual checkpoint)*

Perform `docs/manual-test-checklist.md` end to end with two clients. Expected: every box checks. File issues (or fix inline) for any failures before closing out Phase 1.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/manual-test-checklist.md
git commit -m "docs: add README and manual multi-client test checklist"
```

---

## Out of Scope for This Plan (later plans)

- **Plan 2 — Campaign Hub:** index view, cross-document search (inverted index), timeline (timepoint CRUD on the group flag, fractional sort keys).
- **Plan 3 — Remaining record types:** PC, Item, Encounter, Shop, Loot, Checklist, Media (sheet only).
- **Plan 4 — Presenter + dnd5e integration:** slideshow sockets, currency/item/actor integration.
- **Plan 5 — Release polish:** migration runner (`schemaVersion` setting), localization sweep, package listing.
