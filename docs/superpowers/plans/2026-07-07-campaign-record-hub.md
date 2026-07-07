# Campaign Record — Phase 2 (Campaign Hub) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Campaign Hub — a single ApplicationV2 window with a filterable record index, cross-document search, and a free-form timeline, scoped by campaign group.

**Architecture:** Pure logic (fractional sort keys, inverted search index) lives in `scripts/logic/` with Vitest TDD. Foundry-coupled data operations (timepoint CRUD on the group flag, record collection) live in `scripts/data/` and `scripts/apps/hub/`. The Hub is one `ApplicationV2` + `HandlebarsApplicationMixin` app with four parts (header + three tab bodies) that re-renders on document hooks and patches its search index incrementally. Each feature task ships its own Playwright e2e spec run against the local test world.

**Tech Stack:** Foundry VTT v13 API (ApplicationV2 TABS/parts, DialogV2, DragDrop, Hooks), plain `.mjs` ES modules, Handlebars, Vitest, Playwright (`tests/e2e/`), Quench.

## Global Constraints

- Foundry compatibility minimum/verified `13`; module id `campaign-record`; no build step; no new runtime dependencies.
- **Every ApplicationV2 Handlebars part template must render exactly ONE root HTML element** (Phase 1 e2e lesson — multi-root parts throw at render).
- All UI strings via `game.i18n`, keys under `CAMPAIGNRECORD` in `lang/en.json` (`TYPES.*` excepted).
- Group flag shape: `campaign-record.group = { timepoints: [{ id, label, sort }] }`; timepoint ordering uses fractional sort keys, gap `100000` (Foundry `SORT_INTEGER_DENSITY` convention).
- Records reference timepoints by id in `system.timepoints` (SetField); dangling ids are ignored at render, never a crash.
- Players never see records where `system.hidden === true` in any Hub view; GM-only content (`gmNotes`, GM-only objectives) is searchable by GMs only.
- The search index is in-memory, built lazily on first use, patched incrementally from document hooks; prefix matching; no fuzzy matching.
- E2E: specs live in `tests/e2e/`, use the existing helpers (`login`, `createGroupWithPage`, `deleteGroupsByPrefix`), prefix all created documents with `E2E `, and follow `tests/e2e/README.md` rules (one runner, no other connected users). Run a spec with `npx playwright test tests/e2e/<file>` — global setup manages the server/world.
- Unit tests: `npm test` (Vitest) must stay green; pure-logic modules must not import `foundry.*`/`game.*` globals.
- Phase 1 lesson: prose-mirror/document wiring uses `data-*` (dataset) attributes; `page.uuid` is the document reference of choice.

---

### Task 1: Fractional timeline sort keys (pure logic, TDD)

**Files:**
- Create: `scripts/logic/timeline-sort.mjs`
- Test: `tests/timeline-sort.test.js`

**Interfaces:**
- Consumes: nothing (pure module, no Foundry globals).
- Produces: `SORT_GAP = 100000`; `sortKeyBetween(before: number|null, after: number|null): number`; `sortTimepoints(timepoints: {id,label,sort}[]): {id,label,sort}[]` (non-mutating, sorted by `sort` then `label`).

- [ ] **Step 1: Write the failing tests**

`tests/timeline-sort.test.js`:

```js
import { describe, it, expect } from "vitest";
import { SORT_GAP, sortKeyBetween, sortTimepoints } from "../scripts/logic/timeline-sort.mjs";

describe("sortKeyBetween", () => {
  it("returns 0 for an empty timeline", () => {
    expect(sortKeyBetween(null, null)).toBe(0);
  });

  it("appends after the last key with a full gap", () => {
    expect(sortKeyBetween(300000, null)).toBe(300000 + SORT_GAP);
  });

  it("prepends before the first key with a full gap", () => {
    expect(sortKeyBetween(null, 0)).toBe(-SORT_GAP);
  });

  it("bisects two neighbors", () => {
    expect(sortKeyBetween(0, 100000)).toBe(50000);
    expect(sortKeyBetween(50000, 100000)).toBe(75000);
  });

  it("repeated insertion between the same neighbors keeps strict ordering", () => {
    let low = 0;
    const high = SORT_GAP;
    for (let i = 0; i < 20; i++) {
      const mid = sortKeyBetween(low, high);
      expect(mid).toBeGreaterThan(low);
      expect(mid).toBeLessThan(high);
      low = mid;
    }
  });
});

describe("sortTimepoints", () => {
  it("sorts by sort key, then label, without mutating the input", () => {
    const input = [
      { id: "c", label: "Gamma", sort: 200000 },
      { id: "a", label: "Alpha", sort: 100000 },
      { id: "b", label: "Beta", sort: 100000 }
    ];
    const copy = [...input];
    const sorted = sortTimepoints(input);
    expect(sorted.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(input).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/timeline-sort.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/timeline-sort.mjs`.

- [ ] **Step 3: Write the implementation**

`scripts/logic/timeline-sort.mjs`:

```js
/** Gap between appended sort keys (Foundry SORT_INTEGER_DENSITY convention). */
export const SORT_GAP = 100000;

/** A sort key strictly between two neighbors; null means open-ended. */
export function sortKeyBetween(before, after) {
  if (before == null && after == null) return 0;
  if (before == null) return after - SORT_GAP;
  if (after == null) return before + SORT_GAP;
  return (before + after) / 2;
}

/** Timepoints ordered by sort key, ties broken by label. Non-mutating. */
export function sortTimepoints(timepoints) {
  return [...timepoints].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/timeline-sort.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/timeline-sort.mjs tests/timeline-sort.test.js
git commit -m "feat: add fractional sort keys for timeline ordering"
```

---

### Task 2: Inverted search index (pure logic, TDD)

**Files:**
- Create: `scripts/logic/search-index.mjs`
- Test: `tests/search-index.test.js`

**Interfaces:**
- Consumes: nothing (pure module, no Foundry globals).
- Produces:
  - `createIndex(): Index`
  - `indexRecord(index, record): void` — record shape `{ uuid, name, type, tags: string[], fields: {[field]: string}, gmFields: {[field]: string} }`; re-indexing the same uuid replaces it
  - `removeRecord(index, uuid): void`
  - `search(index, query, {gm}): {uuid, name, type, matches: {field, snippet}[]}[]` — AND across query terms, prefix matching, gm-only fields excluded when `gm` is false, sorted by name
  - `stripHtml(html): string`, `tokenize(text): string[]` (lowercase, letters/digits, length ≥ 2)

- [ ] **Step 1: Write the failing tests**

`tests/search-index.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest";
import {
  createIndex, indexRecord, removeRecord, search, stripHtml, tokenize
} from "../scripts/logic/search-index.mjs";

const npc = {
  uuid: "u1", name: "Strahd von Zarovich", type: "campaign-record.npc",
  tags: ["vampire", "villain"],
  fields: { role: "Dark lord of Barovia", description: "<p>Rules from Castle Ravenloft.</p>" },
  gmFields: { gmNotes: "<p>Secretly seeks Ireena.</p>" }
};
const place = {
  uuid: "u2", name: "Vallaki", type: "campaign-record.place",
  tags: [], fields: { description: "A town under the Baron's iron fist." }, gmFields: {}
};

let index;
beforeEach(() => {
  index = createIndex();
  indexRecord(index, npc);
  indexRecord(index, place);
});

describe("tokenize / stripHtml", () => {
  it("strips tags and lowercases tokens of length >= 2", () => {
    expect(stripHtml("<p>Hello <b>World</b></p>")).toContain("Hello");
    expect(tokenize("<p>Hello, World! A</p>")).toEqual(["hello", "world"]);
  });
});

describe("search", () => {
  it("matches by prefix across name and fields", () => {
    const hits = search(index, "strah", { gm: false });
    expect(hits).toHaveLength(1);
    expect(hits[0].uuid).toBe("u1");
    expect(hits[0].matches.some((m) => m.field === "name")).toBe(true);
  });

  it("matches tags", () => {
    expect(search(index, "vampire", { gm: false })[0].uuid).toBe("u1");
  });

  it("ANDs multiple terms", () => {
    expect(search(index, "castle ravenloft", { gm: false })).toHaveLength(1);
    expect(search(index, "castle vallaki", { gm: false })).toHaveLength(0);
  });

  it("GM-only fields hit for GMs and are invisible to players", () => {
    expect(search(index, "ireena", { gm: true })).toHaveLength(1);
    expect(search(index, "ireena", { gm: false })).toHaveLength(0);
  });

  it("returns a snippet containing the matched term", () => {
    const [hit] = search(index, "baron", { gm: false });
    expect(hit.uuid).toBe("u2");
    const snippet = hit.matches.find((m) => m.field === "description").snippet;
    expect(snippet.toLowerCase()).toContain("baron");
  });

  it("re-indexing a record replaces its old tokens", () => {
    indexRecord(index, { ...place, fields: { description: "A quiet hamlet." } });
    expect(search(index, "baron", { gm: false })).toHaveLength(0);
    expect(search(index, "hamlet", { gm: false })).toHaveLength(1);
  });

  it("removeRecord drops the record from results", () => {
    removeRecord(index, "u1");
    expect(search(index, "strahd", { gm: true })).toHaveLength(0);
  });

  it("empty or too-short queries return no results", () => {
    expect(search(index, "", { gm: true })).toEqual([]);
    expect(search(index, "a", { gm: true })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/search-index.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/search-index.mjs`.

- [ ] **Step 3: Write the implementation**

`scripts/logic/search-index.mjs`:

```js
/** Replace HTML tags with spaces so adjacent words don't fuse. */
export function stripHtml(html) {
  return String(html ?? "").replace(/<[^>]*>/g, " ");
}

/** Lowercased word tokens (letters/digits), length >= 2. */
export function tokenize(text) {
  return stripHtml(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
}

/**
 * Inverted index:
 * - tokens: Map<token, Map<uuid, Set<field>>>
 * - records: Map<uuid, { uuid, name, type, texts: {field: plainText}, gmOnly: Set<field> }>
 */
export function createIndex() {
  return { tokens: new Map(), records: new Map() };
}

export function indexRecord(index, record) {
  removeRecord(index, record.uuid);
  const fields = {
    name: record.name,
    tags: (record.tags ?? []).join(" "),
    ...(record.fields ?? {}),
    ...(record.gmFields ?? {})
  };
  const gmOnly = new Set(Object.keys(record.gmFields ?? {}));
  const texts = {};
  for (const [field, raw] of Object.entries(fields)) {
    const text = stripHtml(raw).replace(/\s+/g, " ").trim();
    if (!text) continue;
    texts[field] = text;
    for (const token of tokenize(text)) {
      let byUuid = index.tokens.get(token);
      if (!byUuid) index.tokens.set(token, (byUuid = new Map()));
      let fieldSet = byUuid.get(record.uuid);
      if (!fieldSet) byUuid.set(record.uuid, (fieldSet = new Set()));
      fieldSet.add(field);
    }
  }
  index.records.set(record.uuid, {
    uuid: record.uuid, name: record.name, type: record.type, texts, gmOnly
  });
}

export function removeRecord(index, uuid) {
  if (!index.records.delete(uuid)) return;
  for (const [token, byUuid] of index.tokens) {
    byUuid.delete(uuid);
    if (!byUuid.size) index.tokens.delete(token);
  }
}

function snippetFor(text, terms, radius = 40) {
  const lower = text.toLowerCase();
  let pos = -1;
  for (const t of terms) {
    pos = lower.indexOf(t);
    if (pos >= 0) break;
  }
  if (pos < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, pos - radius);
  const end = Math.min(text.length, pos + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function search(index, query, { gm = false } = {}) {
  const terms = tokenize(query);
  if (!terms.length) return [];
  let candidates = null;
  const fieldHits = new Map(); // uuid -> Set<field>
  for (const term of terms) {
    const termMatches = new Map();
    for (const [token, byUuid] of index.tokens) {
      if (!token.startsWith(term)) continue;
      for (const [uuid, fields] of byUuid) {
        let set = termMatches.get(uuid);
        if (!set) termMatches.set(uuid, (set = new Set()));
        for (const f of fields) set.add(f);
      }
    }
    candidates = candidates === null
      ? new Set(termMatches.keys())
      : new Set([...candidates].filter((u) => termMatches.has(u)));
    for (const [uuid, fields] of termMatches) {
      let set = fieldHits.get(uuid);
      if (!set) fieldHits.set(uuid, (set = new Set()));
      for (const f of fields) set.add(f);
    }
  }
  const results = [];
  for (const uuid of candidates) {
    const rec = index.records.get(uuid);
    const fields = [...(fieldHits.get(uuid) ?? [])].filter((f) => gm || !rec.gmOnly.has(f));
    if (!fields.length) continue;
    results.push({
      uuid, name: rec.name, type: rec.type,
      matches: fields.map((f) => ({ field: f, snippet: snippetFor(rec.texts[f], terms) }))
    });
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/search-index.test.js`
Expected: PASS (10 tests). Then run `npm test` — the whole unit suite stays green.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/search-index.mjs tests/search-index.test.js
git commit -m "feat: add in-memory inverted search index with prefix matching"
```

---

### Task 3: Timepoint data operations and Quench coverage

**Files:**
- Create: `scripts/data/timepoints.mjs`
- Modify: `scripts/constants.mjs` (add `RECORD_TYPES`)
- Modify: `scripts/testing/quench.mjs` (add hub batch)

**Interfaces:**
- Consumes: `MODULE_ID`, `GROUP_FLAG` from `scripts/constants.mjs`; `sortKeyBetween`, `sortTimepoints` from `scripts/logic/timeline-sort.mjs`; `isRecordVisible` from `scripts/logic/visibility.mjs`.
- Produces (all in `scripts/data/timepoints.mjs`):
  - `getTimepoints(group): {id,label,sort}[]` (sorted)
  - `addTimepoint(group, label, position?: number|null): Promise<{id,label,sort}>` — `position` is the target array index among sorted timepoints; null/omitted appends
  - `renameTimepoint(group, id, label): Promise<void>`
  - `moveTimepoint(group, id, position): Promise<void>` — position is the target index in the sorted list *after* removal of the moved item
  - `deleteTimepoint(group, id): Promise<void>` — also strips the id from every page's `system.timepoints` in that group
  - `attachRecord(page, timepointId): Promise<void>` / `detachRecord(page, timepointId): Promise<void>`
  - `recordsAtTimepoint(group, timepointId, user): JournalEntryPage[]` (visibility-filtered)
  - `RECORD_TYPES = ["npc", "place", "quest"]` exported from `scripts/constants.mjs`

- [ ] **Step 1: Add `RECORD_TYPES` to `scripts/constants.mjs`**

Append to the file:

```js
/** Record kinds shipped so far; Phase 3 extends this list. */
export const RECORD_TYPES = ["npc", "place", "quest"];
```

- [ ] **Step 2: Write the timepoints module**

`scripts/data/timepoints.mjs`:

```js
import { MODULE_ID, GROUP_FLAG } from "../constants.mjs";
import { sortKeyBetween, sortTimepoints } from "../logic/timeline-sort.mjs";
import { isRecordVisible } from "../logic/visibility.mjs";

/** Sorted timepoints of a group. */
export function getTimepoints(group) {
  const flag = group.getFlag(MODULE_ID, GROUP_FLAG);
  return sortTimepoints(flag?.timepoints ?? []);
}

async function setTimepoints(group, timepoints) {
  await group.setFlag(MODULE_ID, GROUP_FLAG, { timepoints });
}

export async function addTimepoint(group, label, position = null) {
  const tps = getTimepoints(group);
  const i = position == null ? tps.length : Math.max(0, Math.min(position, tps.length));
  const tp = {
    id: foundry.utils.randomID(),
    label,
    sort: sortKeyBetween(tps[i - 1]?.sort ?? null, tps[i]?.sort ?? null)
  };
  await setTimepoints(group, [...tps, tp]);
  return tp;
}

export async function renameTimepoint(group, id, label) {
  const tps = getTimepoints(group).map((t) => (t.id === id ? { ...t, label } : t));
  await setTimepoints(group, tps);
}

export async function moveTimepoint(group, id, position) {
  const tps = getTimepoints(group);
  const moving = tps.find((t) => t.id === id);
  if (!moving) return;
  const rest = tps.filter((t) => t.id !== id);
  const i = Math.max(0, Math.min(position, rest.length));
  const sort = sortKeyBetween(rest[i - 1]?.sort ?? null, rest[i]?.sort ?? null);
  await setTimepoints(group, [...rest, { ...moving, sort }]);
}

export async function deleteTimepoint(group, id) {
  await setTimepoints(group, getTimepoints(group).filter((t) => t.id !== id));
  for (const page of group.pages) {
    const tps = page.system?.timepoints;
    if (!tps?.has?.(id)) continue;
    const next = [...tps].filter((t) => t !== id);
    await page.update({ "system.timepoints": next });
  }
}

export async function attachRecord(page, timepointId) {
  const next = new Set(page.system.timepoints ?? []);
  next.add(timepointId);
  await page.update({ "system.timepoints": [...next] });
}

export async function detachRecord(page, timepointId) {
  const next = new Set(page.system.timepoints ?? []);
  next.delete(timepointId);
  await page.update({ "system.timepoints": [...next] });
}

/** Records of a group attached to a timepoint, filtered by user visibility. */
export function recordsAtTimepoint(group, timepointId, user) {
  return group.pages.filter(
    (p) => p.system?.timepoints?.has?.(timepointId) && isRecordVisible(user, p)
  );
}
```

- [ ] **Step 3: Extend the Quench suite**

In `scripts/testing/quench.mjs`, add imports at the top:

```js
import {
  getTimepoints, addTimepoint, renameTimepoint, moveTimepoint, deleteTimepoint,
  attachRecord, recordsAtTimepoint
} from "../data/timepoints.mjs";
```

Inside the `Hooks.on("quenchReady", ...)` callback, after the existing
`quench.registerBatch("campaign-record.core", ...)` call, add:

```js
  quench.registerBatch(
    "campaign-record.hub",
    (context) => {
      const { describe, it, assert, before, after } = context;
      let group, page;

      describe("Timepoints", () => {
        before(async () => {
          group = await createGroup("Quench Hub Group");
          [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
            { name: "Quench Hub NPC", type: typeId("npc") }
          ]);
        });
        after(async () => {
          await group.delete();
        });

        it("adds, renames, and orders timepoints", async () => {
          const a = await addTimepoint(group, "Session 1");
          const b = await addTimepoint(group, "Session 2");
          const mid = await addTimepoint(group, "Interlude", 1);
          assert.deepEqual(getTimepoints(group).map((t) => t.label),
            ["Session 1", "Interlude", "Session 2"]);
          await renameTimepoint(group, mid.id, "Flashback");
          assert.equal(getTimepoints(group)[1].label, "Flashback");
          await moveTimepoint(group, b.id, 0);
          assert.deepEqual(getTimepoints(group).map((t) => t.label),
            ["Session 2", "Session 1", "Flashback"]);
        });

        it("attaches records and cleans references on delete", async () => {
          const tp = await addTimepoint(group, "The Heist");
          await attachRecord(page, tp.id);
          assert.equal(recordsAtTimepoint(group, tp.id, game.user).length, 1);
          await deleteTimepoint(group, tp.id);
          assert.equal(page.system.timepoints.has(tp.id), false);
        });
      });
    },
    { displayName: "Campaign Record: Hub" }
  );
```

- [ ] **Step 4: Verify**

Run: `npm test` (expected: PASS, unchanged). Then run `node --check` once per file — `scripts/data/timepoints.mjs`, `scripts/testing/quench.mjs`, `scripts/constants.mjs` — each must exit clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/data/timepoints.mjs scripts/constants.mjs scripts/testing/quench.mjs
git commit -m "feat: add timepoint CRUD on group flags with Quench coverage"
```

---

### Task 4: Hub record collection (`hub-data.mjs`)

**Files:**
- Create: `scripts/apps/hub/hub-data.mjs`

**Interfaces:**
- Consumes: `MODULE_ID` from `scripts/constants.mjs`; `getGroups` from `scripts/data/groups.mjs`; `isRecordVisible` from `scripts/logic/visibility.mjs`.
- Produces:
  - `isIndexablePage(page): boolean` — module record types plus core `text` pages
  - `getScopedGroups(groupId: string): JournalEntry[]` — `"all"` or one group id
  - `collectRecords({groupId, user}): IndexEntry[]` where IndexEntry is `{ uuid, id, groupId, groupName, name, type, shortType, image, tags: string[], subtitle, hidden, sortTime }`
  - `recordSubtitle(page): string`
  - `toSearchRecord(page): { uuid, name, type, tags, fields, gmFields }` (shape consumed by `indexRecord` from Task 2)

- [ ] **Step 1: Write the module**

`scripts/apps/hub/hub-data.mjs`:

```js
import { MODULE_ID } from "../../constants.mjs";
import { getGroups } from "../../data/groups.mjs";
import { isRecordVisible } from "../../logic/visibility.mjs";

const TYPE_PREFIX = `${MODULE_ID}.`;

/** Pages the Hub indexes: module record types plus core text pages. */
export function isIndexablePage(page) {
  return page.type.startsWith(TYPE_PREFIX) || page.type === "text";
}

export function getScopedGroups(groupId) {
  const groups = getGroups();
  return groupId === "all" ? groups : groups.filter((g) => g.id === groupId);
}

/** One-line summary shown under a record's name in the index. */
export function recordSubtitle(page) {
  const s = page.system ?? {};
  switch (page.type) {
    case `${TYPE_PREFIX}npc`:
      return [s.role, s.faction].filter(Boolean).join(" — ");
    case `${TYPE_PREFIX}place`:
      return s.placeType ? game.i18n.localize(`CAMPAIGNRECORD.Place.Type.${s.placeType}`) : "";
    case `${TYPE_PREFIX}quest`:
      return s.status ? game.i18n.localize(`CAMPAIGNRECORD.Quest.Status.${s.status}`) : "";
    default:
      return "";
  }
}

function toIndexEntry(group, page) {
  return {
    uuid: page.uuid,
    id: page.id,
    groupId: group.id,
    groupName: group.name,
    name: page.name,
    type: page.type,
    shortType: page.type.startsWith(TYPE_PREFIX) ? page.type.slice(TYPE_PREFIX.length) : "journal",
    image: page.system?.image || null,
    tags: [...(page.system?.tags ?? [])],
    subtitle: recordSubtitle(page),
    hidden: page.system?.hidden === true,
    sortTime: page._stats?.modifiedTime ?? 0
  };
}

/** Visible records across the scoped groups for a user. */
export function collectRecords({ groupId = "all", user }) {
  const records = [];
  for (const group of getScopedGroups(groupId)) {
    for (const page of group.pages) {
      if (!isIndexablePage(page)) continue;
      if (!isRecordVisible(user, page)) continue;
      records.push(toIndexEntry(group, page));
    }
  }
  return records;
}

/** Convert a page into the search-index record shape. */
export function toSearchRecord(page) {
  const fields = {};
  const gmFields = {};
  let tags = [];
  if (page.type === "text") {
    fields.text = page.text?.content ?? "";
  } else {
    const s = page.system.toObject();
    tags = s.tags ?? [];
    for (const [key, value] of Object.entries(s)) {
      if (typeof value !== "string" || !value || key === "image") continue;
      if (key === "gmNotes") gmFields[key] = value;
      else fields[key] = value;
    }
    if (Array.isArray(s.objectives)) {
      const open = s.objectives.filter((o) => !o.gmOnly).map((o) => o.text).join(" ");
      const gm = s.objectives.filter((o) => o.gmOnly).map((o) => o.text).join(" ");
      if (open) fields.objectives = open;
      if (gm) gmFields.gmObjectives = gm;
    }
  }
  return { uuid: page.uuid, name: page.name, type: page.type, tags, fields, gmFields };
}
```

- [ ] **Step 2: Verify syntax and unit-suite regression**

Run: `node --check scripts/apps/hub/hub-data.mjs` (clean) and `npm test` (PASS — this module is Foundry-coupled and not imported by Vitest tests).

- [ ] **Step 3: Commit**

```bash
git add scripts/apps/hub/hub-data.mjs
git commit -m "feat: add hub record collection and search-record mapping"
```

---

### Task 5: Campaign Hub shell — window, tabs, group picker, entry points

**Files:**
- Create: `scripts/apps/hub/campaign-hub.mjs`
- Create: `templates/hub/header.hbs`
- Create: `templates/hub/index.hbs` (placeholder body this task; Task 6 fills it)
- Create: `templates/hub/timeline.hbs` (placeholder body this task; Task 8 fills it)
- Create: `templates/hub/search.hbs` (placeholder body this task; Task 7 fills it)
- Create: `scripts/hooks/hub-ui.mjs`
- Modify: `scripts/campaign-record.mjs`
- Modify: `lang/en.json`
- Modify: `styles/campaign-record.css`
- Test: `tests/e2e/05-hub.spec.mjs` (shell coverage; Tasks 6–8 add their own specs)

**Interfaces:**
- Consumes: `getGroups` (Task 3 context), `collectRecords` (Task 4 — used from Task 6 on), Phase 1 helpers in e2e.
- Produces:
  - `CampaignHub` class with `static open(): CampaignHub` (singleton render) and `static toggle()`
  - Instance state object `this.state = { groupId: "all", types: new Set(), tag: "", hiddenOnly: false, sort: "name", query: "" }` (plain property so subclass-free actions can reach it; Tasks 6–8 read/extend it)
  - Tab parts `index` / `timeline` / `search` in tab group `primary`; each part template root carries `class="tab" data-group="primary" data-tab="<id>"`
  - `registerHubUI(): void` and `registerHubKeybinding(): void` from `scripts/hooks/hub-ui.mjs`

- [ ] **Step 1: Write the Hub application shell**

`scripts/apps/hub/campaign-hub.mjs`:

```js
import { getGroups } from "../../data/groups.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CampaignHub extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance = null;

  static open() {
    this.#instance ??= new CampaignHub();
    this.#instance.render({ force: true });
    return this.#instance;
  }

  static toggle() {
    if (this.#instance?.rendered) this.#instance.close();
    else this.open();
  }

  static DEFAULT_OPTIONS = {
    id: "campaign-hub",
    classes: ["campaign-record", "campaign-hub"],
    window: { title: "CAMPAIGNRECORD.Hub.Title", resizable: true, icon: "fa-solid fa-book-atlas" },
    position: { width: 760, height: 640 }
  };

  static PARTS = {
    header: { template: "modules/campaign-record/templates/hub/header.hbs" },
    index: { template: "modules/campaign-record/templates/hub/index.hbs" },
    timeline: { template: "modules/campaign-record/templates/hub/timeline.hbs" },
    search: { template: "modules/campaign-record/templates/hub/search.hbs" }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "index", icon: "fa-solid fa-list" },
        { id: "timeline", icon: "fa-solid fa-timeline" },
        { id: "search", icon: "fa-solid fa-magnifying-glass" }
      ],
      initial: "index",
      labelPrefix: "CAMPAIGNRECORD.Hub.Tabs"
    }
  };

  state = { groupId: "all", types: new Set(), tag: "", hiddenOnly: false, sort: "name", query: "" };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.state = this.state;
    context.isGM = game.user.isGM;
    context.groups = getGroups().map((g) => ({
      id: g.id, name: g.name, selected: g.id === this.state.groupId
    }));
    context.allSelected = this.state.groupId === "all";
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector('select[name="group-select"]')
      ?.addEventListener("change", (event) => {
        this.state.groupId = event.target.value;
        this.render();
      });
  }
}
```

*(Tab plumbing note: v13 `ApplicationV2` builds `context.tabs` from `static TABS` automatically and ships a built-in `tab` action — nav links with `data-action="tab" data-group data-tab` switch tabs, toggling the `active` class on part roots carrying matching `data-group`/`data-tab`. If `context.tabs` turns out empty on the installed build, call `this._prepareTabs("primary")` inside `_prepareContext` and assign it to `context.tabs` — note the deviation in the commit message.)*

- [ ] **Step 2: Write the four part templates (single root element each)**

`templates/hub/header.hbs`:

```hbs
<div class="hub-header">
  <select name="group-select" aria-label="{{localize "CAMPAIGNRECORD.Hub.GroupPicker"}}">
    <option value="all" {{#if allSelected}}selected{{/if}}>{{localize "CAMPAIGNRECORD.Hub.AllGroups"}}</option>
    {{#each groups}}
    <option value="{{this.id}}" {{#if this.selected}}selected{{/if}}>{{this.name}}</option>
    {{/each}}
  </select>
  <nav class="tabs" data-group="primary">
    {{#each tabs}}
    <a class="{{this.cssClass}}" data-action="tab" data-group="primary" data-tab="{{this.id}}">
      <i class="{{this.icon}}"></i> {{localize this.label}}
    </a>
    {{/each}}
  </nav>
</div>
```

`templates/hub/index.hbs` (placeholder until Task 6):

```hbs
<section class="tab hub-index" data-group="primary" data-tab="index">
  <p class="hint">{{localize "CAMPAIGNRECORD.Hub.Empty"}}</p>
</section>
```

`templates/hub/timeline.hbs` (placeholder until Task 8):

```hbs
<section class="tab hub-timeline" data-group="primary" data-tab="timeline">
  <p class="hint">{{localize "CAMPAIGNRECORD.Hub.Empty"}}</p>
</section>
```

`templates/hub/search.hbs` (placeholder until Task 7):

```hbs
<section class="tab hub-search" data-group="primary" data-tab="search">
  <p class="hint">{{localize "CAMPAIGNRECORD.Hub.Empty"}}</p>
</section>
```

- [ ] **Step 3: Write the entry-point hooks**

`scripts/hooks/hub-ui.mjs`:

```js
import { MODULE_ID } from "../constants.mjs";
import { CampaignHub } from "../apps/hub/campaign-hub.mjs";

/** Journal sidebar footer button — visible to every user. */
export function registerHubUI() {
  Hooks.on("renderJournalDirectory", (app, html) => {
    if (html.querySelector(".campaign-record-open-hub")) return;
    const footer = html.querySelector(".directory-footer") ?? html;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "campaign-record-open-hub";
    btn.innerHTML = `<i class="fa-solid fa-book-atlas"></i> ${game.i18n.localize("CAMPAIGNRECORD.Hub.Open")}`;
    btn.addEventListener("click", () => CampaignHub.open());
    footer.append(btn);
  });

  Hooks.on("getSceneControlButtons", (controls) => {
    const notes = controls.notes ?? controls.journal;
    if (!notes?.tools) return;
    notes.tools.campaignHub = {
      name: "campaignHub",
      title: "CAMPAIGNRECORD.Hub.Open",
      icon: "fa-solid fa-book-atlas",
      button: true,
      onChange: () => CampaignHub.open()
    };
  });
}

/** Ctrl+Shift+H (editable) toggles the Hub. Call during init. */
export function registerHubKeybinding() {
  game.keybindings.register(MODULE_ID, "openHub", {
    name: "CAMPAIGNRECORD.Hub.Open",
    editable: [{ key: "KeyH", modifiers: ["Control", "Shift"] }],
    onDown: () => {
      CampaignHub.toggle();
      return true;
    }
  });
}
```

- [ ] **Step 4: Wire into the entry module, add i18n and styles**

In `scripts/campaign-record.mjs`, add imports:

```js
import { registerHubUI, registerHubKeybinding } from "./hooks/hub-ui.mjs";
```

and inside the `init` hook (after `registerDirectoryUI()`):

```js
  registerHubUI();
  registerHubKeybinding();
```

In `lang/en.json`, add under `CAMPAIGNRECORD` (sibling of `"ModuleName"`):

```json
"Hub": {
  "Title": "Campaign Hub",
  "Open": "Open Campaign Hub",
  "GroupPicker": "Campaign group",
  "AllGroups": "All groups",
  "Empty": "Nothing here yet.",
  "Tabs": {
    "index": "Index",
    "timeline": "Timeline",
    "search": "Search"
  }
}
```

Append to `styles/campaign-record.css`:

```css
.campaign-hub .hub-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--color-border-light-primary, #7a7971);
}

.campaign-hub .hub-header select[name="group-select"] {
  max-width: 14rem;
}

.campaign-hub .tab {
  display: none;
  flex: 1;
  overflow-y: auto;
  padding-top: 0.5rem;
}

.campaign-hub .tab.active {
  display: block;
}
```

- [ ] **Step 5: Write the shell e2e spec**

`tests/e2e/05-hub.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { login } from "./helpers/foundry.mjs";

test.describe("campaign hub shell", () => {
  test("opens from the journal sidebar and switches tabs", async ({ page }) => {
    await login(page, "Gamemaster");
    await page.evaluate(() => ui.sidebar.changeTab("journal", "primary"));
    const openBtn = page.locator(".campaign-record-open-hub");
    await expect(openBtn).toBeVisible();
    await openBtn.evaluate((el) => el.click());

    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    await expect(hub.locator('select[name="group-select"]')).toBeVisible();
    await expect(hub.locator('.hub-index[data-tab="index"]')).toHaveClass(/active/);

    await hub.locator('[data-action="tab"][data-tab="search"]').click();
    await expect(hub.locator('.hub-search[data-tab="search"]')).toHaveClass(/active/);
    await expect(hub.locator('.hub-index[data-tab="index"]')).not.toHaveClass(/active/);

    await hub.locator('[data-action="tab"][data-tab="timeline"]').click();
    await expect(hub.locator('.hub-timeline[data-tab="timeline"]')).toHaveClass(/active/);
  });

  test("player also gets the hub button", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, "User 1");
    await page.evaluate(() => ui.sidebar.changeTab("journal", "primary"));
    await expect(page.locator(".campaign-record-open-hub")).toBeVisible();
    await ctx.close();
  });
});
```

- [ ] **Step 6: Verify**

Run: `node --check` on each new/modified `.mjs` file (clean); `npm test` (PASS);
`npx playwright test tests/e2e/05-hub.spec.mjs` — Expected: 2 passed. If the tab
`active` class does not toggle, apply the `_prepareTabs` fallback from Step 1's
note and re-run.

- [ ] **Step 7: Commit**

```bash
git add scripts/apps/hub/campaign-hub.mjs templates/hub/ scripts/hooks/hub-ui.mjs scripts/campaign-record.mjs lang/en.json styles/campaign-record.css tests/e2e/05-hub.spec.mjs
git commit -m "feat: add Campaign Hub shell with tabs, group picker, and entry points"
```

---

### Task 6: Index view — filters, live updates, record actions

**Files:**
- Modify: `scripts/apps/hub/campaign-hub.mjs`
- Modify: `templates/hub/index.hbs` (replace placeholder)
- Modify: `lang/en.json`
- Modify: `styles/campaign-record.css`
- Test: `tests/e2e/06-hub-index.spec.mjs`

**Interfaces:**
- Consumes: `collectRecords`, `isIndexablePage` from Task 4; `RECORD_TYPES`, `typeId` from `scripts/constants.mjs`; `getGroups`, `createGroup` from `scripts/data/groups.mjs`; `CampaignHub.state` from Task 5.
- Produces: actions `openRecord`, `newRecord`, `filterType`, `toggleHiddenOnly` and change listeners for tag filter + sort select; live re-render on journal document hooks (`#onDocChange`, `#teardownHooks` — Task 7 reuses the same hook pipeline for search-index patching).

- [ ] **Step 1: Extend `CampaignHub` with index data, filters, actions, and live hooks**

Apply these changes to `scripts/apps/hub/campaign-hub.mjs`:

Add imports at the top:

```js
import { RECORD_TYPES, typeId } from "../../constants.mjs";
import { collectRecords, isIndexablePage } from "./hub-data.mjs";
```

Add to `DEFAULT_OPTIONS` (new `actions` key):

```js
    actions: {
      openRecord: CampaignHub.#onOpenRecord,
      newRecord: CampaignHub.#onNewRecord,
      filterType: CampaignHub.#onFilterType,
      toggleHiddenOnly: CampaignHub.#onToggleHiddenOnly
    }
```

Add these members to the class body:

```js
  #hookHandlers = [];

  #registerDocHooks() {
    if (this.#hookHandlers.length) return;
    const hooks = [
      "createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage",
      "createJournalEntry", "updateJournalEntry", "deleteJournalEntry"
    ];
    for (const hook of hooks) {
      const id = Hooks.on(hook, (doc) => this._onDocumentChanged(hook, doc));
      this.#hookHandlers.push([hook, id]);
    }
  }

  #teardownHooks() {
    for (const [hook, id] of this.#hookHandlers) Hooks.off(hook, id);
    this.#hookHandlers = [];
  }

  #debouncedRender = foundry.utils.debounce(() => {
    if (this.rendered) this.render();
  }, 100);

  /** Task 7 extends this to patch the search index. */
  _onDocumentChanged(hook, doc) {
    this.#debouncedRender();
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.#registerDocHooks();
  }

  _onClose(options) {
    this.#teardownHooks();
    super._onClose(options);
  }

  #indexEntries() {
    let records = collectRecords({ groupId: this.state.groupId, user: game.user });
    if (this.state.types.size) records = records.filter((r) => this.state.types.has(r.shortType));
    if (this.state.tag) {
      const tag = this.state.tag.toLowerCase();
      records = records.filter((r) => r.tags.some((t) => t.toLowerCase().includes(tag)));
    }
    if (this.state.hiddenOnly) records = records.filter((r) => r.hidden);
    const sorters = {
      name: (a, b) => a.name.localeCompare(b.name),
      type: (a, b) => a.shortType.localeCompare(b.shortType) || a.name.localeCompare(b.name),
      updated: (a, b) => b.sortTime - a.sortTime
    };
    return records.sort(sorters[this.state.sort] ?? sorters.name);
  }

  static async #onOpenRecord(event, target) {
    const page = await fromUuid(target.closest("[data-uuid]").dataset.uuid);
    if (!page) return;
    const sheet = page.parent.sheet;
    await sheet.render(true);
    sheet.goToPage(page.id);
  }

  static async #onNewRecord() {
    const groups = getGroups();
    if (!groups.length) return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.NoGroups"));
    const current = this.state.groupId;
    const typeOptions = RECORD_TYPES.map((t) =>
      `<option value="${typeId(t)}">${game.i18n.localize(`TYPES.JournalEntryPage.${typeId(t)}`)}</option>`
    ).join("") + `<option value="text">${game.i18n.localize("CAMPAIGNRECORD.Hub.JournalPage")}</option>`;
    const groupOptions = groups.map((g) =>
      `<option value="${g.id}" ${g.id === current ? "selected" : ""}>${foundry.utils.escapeHTML(g.name)}</option>`
    ).join("");
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "CAMPAIGNRECORD.Hub.NewRecord" },
      content: `
        <div class="form-group"><label>${game.i18n.localize("CAMPAIGNRECORD.Hub.RecordName")}</label>
          <input type="text" name="name" required autofocus></div>
        <div class="form-group"><label>${game.i18n.localize("CAMPAIGNRECORD.Hub.RecordType")}</label>
          <select name="type">${typeOptions}</select></div>
        <div class="form-group"><label>${game.i18n.localize("CAMPAIGNRECORD.Hub.GroupPicker")}</label>
          <select name="group">${groupOptions}</select></div>`,
      ok: {
        label: "CAMPAIGNRECORD.Create",
        callback: (event, button) => ({
          name: button.form.elements.name.value.trim(),
          type: button.form.elements.type.value,
          groupId: button.form.elements.group.value
        })
      },
      rejectClose: false
    });
    if (!result?.name) return;
    const group = game.journal.get(result.groupId);
    const [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
      { name: result.name, type: result.type }
    ]);
    page.sheet.render(true);
  }

  static #onFilterType(event, target) {
    const type = target.dataset.type;
    if (this.state.types.has(type)) this.state.types.delete(type);
    else this.state.types.add(type);
    this.render();
  }

  static #onToggleHiddenOnly() {
    this.state.hiddenOnly = !this.state.hiddenOnly;
    this.render();
  }
```

Add the `getGroups` import if not already present (Task 5 imports it).

In `_prepareContext`, add before `return context`:

```js
    context.records = this.#indexEntries();
    context.typeChips = [...RECORD_TYPES, "journal"].map((t) => ({
      type: t,
      label: t === "journal"
        ? game.i18n.localize("CAMPAIGNRECORD.Hub.JournalPage")
        : game.i18n.localize(`TYPES.JournalEntryPage.${typeId(t)}`),
      active: this.state.types.has(t)
    }));
    context.sortOptions = ["name", "type", "updated"].map((s) => ({
      value: s,
      label: game.i18n.localize(`CAMPAIGNRECORD.Hub.Sort.${s}`),
      selected: this.state.sort === s
    }));
```

In `_onRender`, add listeners after the group-select listener:

```js
    this.element.querySelector('input[name="tag-filter"]')
      ?.addEventListener("change", (event) => {
        this.state.tag = event.target.value.trim();
        this.render();
      });
    this.element.querySelector('select[name="sort-select"]')
      ?.addEventListener("change", (event) => {
        this.state.sort = event.target.value;
        this.render();
      });
```

- [ ] **Step 2: Replace `templates/hub/index.hbs`**

```hbs
<section class="tab hub-index" data-group="primary" data-tab="index">
  <div class="index-controls">
    <span class="type-chips">
      {{#each typeChips}}
      <button type="button" class="type-chip {{#if this.active}}active{{/if}}"
              data-action="filterType" data-type="{{this.type}}">{{this.label}}</button>
      {{/each}}
    </span>
    <input type="text" name="tag-filter" value="{{state.tag}}"
           placeholder="{{localize "CAMPAIGNRECORD.Hub.FilterTag"}}">
    <select name="sort-select">
      {{#each sortOptions}}
      <option value="{{this.value}}" {{#if this.selected}}selected{{/if}}>{{this.label}}</option>
      {{/each}}
    </select>
    {{#if isGM}}
    <button type="button" class="hidden-toggle {{#if state.hiddenOnly}}active{{/if}}"
            data-action="toggleHiddenOnly" data-tooltip="CAMPAIGNRECORD.Hub.HiddenOnly">
      <i class="fa-solid fa-eye-slash"></i>
    </button>
    {{/if}}
    <button type="button" data-action="newRecord">
      <i class="fa-solid fa-plus"></i> {{localize "CAMPAIGNRECORD.Hub.NewRecord"}}
    </button>
  </div>
  <ol class="record-list">
    {{#each records}}
    <li class="record-row" data-uuid="{{this.uuid}}" data-drag-record draggable="true"
        data-action="openRecord">
      {{#if this.image}}<img src="{{this.image}}" alt="">{{else}}<i class="fa-solid fa-file-lines"></i>{{/if}}
      <span class="record-name">{{this.name}}
        {{#if this.hidden}}<i class="fa-solid fa-eye-slash" data-tooltip="CAMPAIGNRECORD.Hidden"></i>{{/if}}
      </span>
      <span class="record-subtitle">{{this.subtitle}}</span>
      <span class="record-type">{{this.shortType}}</span>
      <span class="record-group">{{this.groupName}}</span>
    </li>
    {{else}}
    <li class="hint">{{localize "CAMPAIGNRECORD.Hub.NoRecords"}}</li>
    {{/each}}
  </ol>
</section>
```

- [ ] **Step 3: Add i18n and styles**

In `lang/en.json` inside `CAMPAIGNRECORD.Hub`, add:

```json
"NewRecord": "New Record",
"RecordName": "Name",
"RecordType": "Type",
"JournalPage": "Journal",
"NoGroups": "Create a campaign group first.",
"NoRecords": "No records match the current filters.",
"FilterTag": "Filter by tag…",
"HiddenOnly": "Show hidden records only",
"Sort": { "name": "Name", "type": "Type", "updated": "Recently updated" }
```

Append to `styles/campaign-record.css`:

```css
.campaign-hub .index-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.5rem;
}

.campaign-hub .type-chip.active,
.campaign-hub .hidden-toggle.active {
  background: var(--color-warm-2, #c9593f);
  color: #fff;
}

.campaign-hub .record-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.campaign-hub .record-row {
  display: grid;
  grid-template-columns: 2rem 1fr auto auto auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
}

.campaign-hub .record-row:hover {
  background: var(--color-hover-bg, rgba(255, 255, 240, 0.1));
}

.campaign-hub .record-row img {
  width: 2rem;
  height: 2rem;
  object-fit: cover;
  border: none;
}

.campaign-hub .record-subtitle,
.campaign-hub .record-type,
.campaign-hub .record-group {
  font-size: var(--font-size-12, 12px);
  opacity: 0.8;
}
```

- [ ] **Step 4: Write the index e2e spec**

`tests/e2e/06-hub-index.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("hub index", () => {
  let gmPage, ids;

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    ids = await createGroupWithPage(gmPage, "E2E Index Group", "E2E Index NPC", "campaign-record.npc");
    await gmPage.evaluate(async ({ groupId }) => {
      const g = game.journal.get(groupId);
      await g.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Index Quest", type: "campaign-record.quest" }
      ]);
    }, ids);
    await gmPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    await gmPage.locator("#campaign-hub").waitFor({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(gmPage, "E2E Index");
    await gmPage.close();
  });

  test("lists records and filters by type chip", async () => {
    const hub = gmPage.locator("#campaign-hub");
    await expect(hub.locator('.record-row', { hasText: "E2E Index NPC" })).toBeVisible();
    await expect(hub.locator('.record-row', { hasText: "E2E Index Quest" })).toBeVisible();

    await hub.locator('.type-chip[data-type="quest"]').click();
    await expect(hub.locator('.record-row', { hasText: "E2E Index Quest" })).toBeVisible();
    await expect(hub.locator('.record-row', { hasText: "E2E Index NPC" })).toHaveCount(0);
    await hub.locator('.type-chip[data-type="quest"]').click(); // reset
  });

  test("re-renders live when a record is created elsewhere", async () => {
    const hub = gmPage.locator("#campaign-hub");
    await gmPage.evaluate(async ({ groupId }) => {
      await game.journal.get(groupId).createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Index Live Place", type: "campaign-record.place" }
      ]);
    }, ids);
    await expect(hub.locator('.record-row', { hasText: "E2E Index Live Place" }))
      .toBeVisible({ timeout: 10_000 });
  });

  test("players never see hidden records; GM hidden-only filter shows them", async ({ browser }) => {
    await gmPage.evaluate(async ({ groupId }) => {
      const { setRecordHidden } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const page = game.journal.get(groupId).pages.getName("E2E Index Quest");
      await setRecordHidden(page, true);
    }, ids);

    const hub = gmPage.locator("#campaign-hub");
    await hub.locator(".hidden-toggle").click();
    await expect(hub.locator(".record-row", { hasText: "E2E Index Quest" })).toBeVisible();
    await hub.locator(".hidden-toggle").click();

    const ctx = await browser.newContext();
    const playerPage = await ctx.newPage();
    await login(playerPage, "User 1");
    await playerPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const playerHub = playerPage.locator("#campaign-hub");
    await playerHub.waitFor({ timeout: 15_000 });
    await expect(playerHub.locator(".record-row", { hasText: "E2E Index NPC" })).toBeVisible();
    await expect(playerHub.locator(".record-row", { hasText: "E2E Index Quest" })).toHaveCount(0);
    await expect(playerHub.locator(".hidden-toggle")).toHaveCount(0);
    await ctx.close();
  });
});
```

- [ ] **Step 5: Verify**

Run: `node --check scripts/apps/hub/campaign-hub.mjs` (clean); `npm test` (PASS);
`npx playwright test tests/e2e/05-hub.spec.mjs tests/e2e/06-hub-index.spec.mjs`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add scripts/apps/hub/campaign-hub.mjs templates/hub/index.hbs lang/en.json styles/campaign-record.css tests/e2e/06-hub-index.spec.mjs
git commit -m "feat: add hub index view with filters, sorting, and live updates"
```

---

### Task 7: Search view — lazy index, incremental patching, scoping

**Files:**
- Modify: `scripts/apps/hub/campaign-hub.mjs`
- Modify: `templates/hub/search.hbs` (replace placeholder)
- Modify: `lang/en.json`
- Modify: `styles/campaign-record.css`
- Test: `tests/e2e/07-hub-search.spec.mjs`

**Interfaces:**
- Consumes: `createIndex`, `indexRecord`, `removeRecord`, `search` from Task 2; `toSearchRecord`, `isIndexablePage`, `getScopedGroups`, `collectRecords` from Task 4; `_onDocumentChanged` pipeline from Task 6.
- Produces: search tab UI with results grouped by type; `openRecord` action reused from Task 6.

- [ ] **Step 1: Extend `CampaignHub` with the search index**

Add imports to `scripts/apps/hub/campaign-hub.mjs`:

```js
import { createIndex, indexRecord, removeRecord, search } from "../../logic/search-index.mjs";
import { getScopedGroups, toSearchRecord } from "./hub-data.mjs";
```

Add class members:

```js
  #searchIndex = null;

  #ensureSearchIndex() {
    if (this.#searchIndex) return this.#searchIndex;
    this.#searchIndex = createIndex();
    for (const group of getScopedGroups("all")) {
      for (const page of group.pages) {
        if (isIndexablePage(page)) indexRecord(this.#searchIndex, toSearchRecord(page));
      }
    }
    return this.#searchIndex;
  }

  #searchResults() {
    if (!this.state.query || this.state.query.length < 2) return [];
    const index = this.#ensureSearchIndex();
    const visible = new Map(
      collectRecords({ groupId: this.state.groupId, user: game.user }).map((r) => [r.uuid, r])
    );
    const hits = search(index, this.state.query, { gm: game.user.isGM })
      .filter((h) => visible.has(h.uuid))
      .map((h) => ({ ...h, entry: visible.get(h.uuid) }));
    const byType = new Map();
    for (const hit of hits) {
      const key = hit.entry.shortType;
      if (!byType.has(key)) byType.set(key, { type: key, hits: [] });
      byType.get(key).hits.push(hit);
    }
    return [...byType.values()];
  }
```

Replace the Task 6 `_onDocumentChanged` implementation with:

```js
  _onDocumentChanged(hook, doc) {
    if (this.#searchIndex && doc.documentName === "JournalEntryPage" && isIndexablePage(doc)) {
      if (hook === "deleteJournalEntryPage") removeRecord(this.#searchIndex, doc.uuid);
      else indexRecord(this.#searchIndex, toSearchRecord(doc));
    }
    if (hook === "deleteJournalEntry") this.#searchIndex = null; // groups carry many pages; rebuild lazily
    this.#debouncedRender();
  }
```

In `_prepareContext`, add before `return context`:

```js
    context.searchGroups = this.#searchResults();
```

In `_onRender`, add the query listener (input events re-render only the search part, then restore focus):

```js
    const searchInput = this.element.querySelector('input[name="search-query"]');
    searchInput?.addEventListener("input", foundry.utils.debounce(async (event) => {
      this.state.query = event.target.value;
      await this.render({ parts: ["search"] });
      const restored = this.element.querySelector('input[name="search-query"]');
      restored?.focus();
      restored?.setSelectionRange(restored.value.length, restored.value.length);
    }, 250));
```

- [ ] **Step 2: Replace `templates/hub/search.hbs`**

```hbs
<section class="tab hub-search" data-group="primary" data-tab="search">
  <input type="search" name="search-query" value="{{state.query}}"
         placeholder="{{localize "CAMPAIGNRECORD.Hub.SearchPlaceholder"}}" autocomplete="off">
  <div class="search-results">
    {{#each searchGroups}}
    <section class="result-type">
      <h3>{{this.type}}</h3>
      <ol>
        {{#each this.hits}}
        <li class="search-hit" data-uuid="{{this.uuid}}" data-action="openRecord">
          <span class="hit-name">{{this.name}}</span>
          {{#each this.matches}}
          <span class="hit-snippet"><strong>{{this.field}}:</strong> {{this.snippet}}</span>
          {{/each}}
        </li>
        {{/each}}
      </ol>
    </section>
    {{else}}
    <p class="hint">{{#if state.query}}{{localize "CAMPAIGNRECORD.Hub.NoResults"}}{{else}}{{localize "CAMPAIGNRECORD.Hub.SearchHint"}}{{/if}}</p>
    {{/each}}
  </div>
</section>
```

- [ ] **Step 3: Add i18n and styles**

In `lang/en.json` inside `CAMPAIGNRECORD.Hub`, add:

```json
"SearchPlaceholder": "Search all records…",
"SearchHint": "Type at least two characters to search.",
"NoResults": "No records match."
```

Append to `styles/campaign-record.css`:

```css
.campaign-hub .hub-search input[name="search-query"] {
  width: 100%;
  margin-bottom: 0.5rem;
}

.campaign-hub .search-hit {
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
}

.campaign-hub .search-hit:hover {
  background: var(--color-hover-bg, rgba(255, 255, 240, 0.1));
}

.campaign-hub .hit-snippet {
  font-size: var(--font-size-12, 12px);
  opacity: 0.8;
}
```

- [ ] **Step 4: Write the search e2e spec**

`tests/e2e/07-hub-search.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("hub search", () => {
  let gmPage, ids;

  const openHubAndSearch = async (p, query) => {
    await p.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = p.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    await hub.locator('[data-action="tab"][data-tab="search"]').click();
    const input = hub.locator('input[name="search-query"]');
    await input.fill(query);
    await input.dispatchEvent("input");
    return hub;
  };

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    ids = await createGroupWithPage(gmPage, "E2E Search Group", "E2E Search NPC", "campaign-record.npc");
    await gmPage.evaluate(async ({ groupId, pageId }) => {
      const page = game.journal.get(groupId).pages.get(pageId);
      await page.update({
        "system.role": "Lighthouse keeper",
        "system.gmNotes": "<p>Actually a XANATHIAN spy.</p>"
      });
    }, ids);
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(gmPage, "E2E Search");
    await gmPage.close();
  });

  test("GM finds records by structured field with prefix matching and snippet", async () => {
    const hub = await openHubAndSearch(gmPage, "lighthou");
    const hit = hub.locator(".search-hit", { hasText: "E2E Search NPC" });
    await expect(hit).toBeVisible({ timeout: 10_000 });
    await expect(hit.locator(".hit-snippet").first()).toContainText(/lighthouse/i);
  });

  test("GM-only content is searchable by the GM but never by players", async ({ browser }) => {
    const hub = await openHubAndSearch(gmPage, "xanathian");
    await expect(hub.locator(".search-hit", { hasText: "E2E Search NPC" }))
      .toBeVisible({ timeout: 10_000 });

    const ctx = await browser.newContext();
    const playerPage = await ctx.newPage();
    await login(playerPage, "User 1");
    const playerHub = await openHubAndSearch(playerPage, "xanathian");
    await expect(playerHub.locator(".search-results .hint")).toBeVisible({ timeout: 10_000 });
    await expect(playerHub.locator(".search-hit")).toHaveCount(0);

    // but public fields are searchable for players
    const input = playerHub.locator('input[name="search-query"]');
    await input.fill("lighthouse");
    await input.dispatchEvent("input");
    await expect(playerHub.locator(".search-hit", { hasText: "E2E Search NPC" }))
      .toBeVisible({ timeout: 10_000 });
    await ctx.close();
  });

  test("search index patches incrementally when a record changes", async () => {
    const hub = await openHubAndSearch(gmPage, "chimera");
    await expect(hub.locator(".search-hit")).toHaveCount(0);
    await gmPage.evaluate(async ({ groupId, pageId }) => {
      await game.journal.get(groupId).pages.get(pageId).update({ "system.faction": "Chimera Cult" });
    }, ids);
    const input = hub.locator('input[name="search-query"]');
    await input.fill("chimera");
    await input.dispatchEvent("input");
    await expect(hub.locator(".search-hit", { hasText: "E2E Search NPC" }))
      .toBeVisible({ timeout: 10_000 });
  });
});
```

- [ ] **Step 5: Verify**

Run: `npm test` (PASS); `npx playwright test tests/e2e/07-hub-search.spec.mjs`
Expected: 3 passed. Then run the whole e2e suite (`npm run test:e2e`) — everything green.

- [ ] **Step 6: Commit**

```bash
git add scripts/apps/hub/campaign-hub.mjs templates/hub/search.hbs lang/en.json styles/campaign-record.css tests/e2e/07-hub-search.spec.mjs
git commit -m "feat: add hub cross-document search with GM-only scoping"
```

---

### Task 8: Timeline view — timepoints, reorder, record attachment

**Files:**
- Modify: `scripts/apps/hub/campaign-hub.mjs`
- Modify: `templates/hub/timeline.hbs` (replace placeholder)
- Modify: `lang/en.json`
- Modify: `styles/campaign-record.css`
- Test: `tests/e2e/08-hub-timeline.spec.mjs`

**Interfaces:**
- Consumes: everything from `scripts/data/timepoints.mjs` (Task 3); `getScopedGroups` (Task 4); index rows carry `data-drag-record` + `data-uuid` (Task 6).
- Produces: actions `addTimepoint`, `renameTimepoint`, `deleteTimepoint`, `detachRecord`; drag-reorder of timepoints and drag-attach of records via `DragDrop` (`[data-drag-record]`/`[data-drag-timepoint]` → `[data-drop-timepoint]`).

- [ ] **Step 1: Extend `CampaignHub` with timeline data and actions**

Add import to `scripts/apps/hub/campaign-hub.mjs`:

```js
import * as Timepoints from "../../data/timepoints.mjs";
```

Add to `DEFAULT_OPTIONS.actions`:

```js
      addTimepoint: CampaignHub.#onAddTimepoint,
      renameTimepoint: CampaignHub.#onRenameTimepoint,
      deleteTimepoint: CampaignHub.#onDeleteTimepoint,
      detachRecord: CampaignHub.#onDetachRecord
```

Add class members:

```js
  #timelineGroups() {
    return getScopedGroups(this.state.groupId).map((group) => {
      const canEdit = group.canUserModify(game.user, "update");
      return {
        id: group.id,
        name: group.name,
        canEdit,
        timepoints: Timepoints.getTimepoints(group).map((tp, i) => ({
          ...tp,
          position: i,
          canEdit,
          records: Timepoints.recordsAtTimepoint(group, tp.id, game.user).map((p) => ({
            uuid: p.uuid, name: p.name
          }))
        }))
      };
    });
  }

  static async #promptLabel(titleKey, initial = "") {
    return foundry.applications.api.DialogV2.prompt({
      window: { title: titleKey },
      content: `<div class="form-group">
        <label>${game.i18n.localize("CAMPAIGNRECORD.Hub.TimepointLabel")}</label>
        <input type="text" name="label" value="${foundry.utils.escapeHTML(initial)}" required autofocus>
      </div>`,
      ok: {
        label: "CAMPAIGNRECORD.Create",
        callback: (event, button) => button.form.elements.label.value.trim()
      },
      rejectClose: false
    });
  }

  static async #onAddTimepoint(event, target) {
    const group = game.journal.get(target.closest("[data-group-id]").dataset.groupId);
    const position = target.dataset.position ? Number(target.dataset.position) : null;
    const label = await CampaignHub.#promptLabel("CAMPAIGNRECORD.Hub.AddTimepoint");
    if (!label) return;
    await Timepoints.addTimepoint(group, label, position);
  }

  static async #onRenameTimepoint(event, target) {
    const group = game.journal.get(target.closest("[data-group-id]").dataset.groupId);
    const id = target.closest("[data-timepoint-id]").dataset.timepointId;
    const current = Timepoints.getTimepoints(group).find((t) => t.id === id)?.label ?? "";
    const label = await CampaignHub.#promptLabel("CAMPAIGNRECORD.Hub.RenameTimepoint", current);
    if (!label) return;
    await Timepoints.renameTimepoint(group, id, label);
  }

  static async #onDeleteTimepoint(event, target) {
    const group = game.journal.get(target.closest("[data-group-id]").dataset.groupId);
    const id = target.closest("[data-timepoint-id]").dataset.timepointId;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "CAMPAIGNRECORD.Hub.DeleteTimepoint" },
      content: `<p>${game.i18n.localize("CAMPAIGNRECORD.Hub.DeleteTimepointConfirm")}</p>`
    });
    if (confirmed) await Timepoints.deleteTimepoint(group, id);
  }

  static async #onDetachRecord(event, target) {
    event.stopPropagation();
    const id = target.closest("[data-timepoint-id]").dataset.timepointId;
    const page = await fromUuid(target.closest("[data-record-uuid]").dataset.recordUuid);
    if (page) await Timepoints.detachRecord(page, id);
  }

  #onTimelineDragStart(event) {
    const tpRow = event.target.closest("[data-drag-timepoint]");
    const recordRow = event.target.closest("[data-drag-record]");
    if (tpRow) {
      event.dataTransfer.setData("text/plain", JSON.stringify({
        kind: "campaign-record.timepoint",
        id: tpRow.dataset.timepointId,
        groupId: tpRow.closest("[data-group-id]").dataset.groupId
      }));
    } else if (recordRow) {
      event.dataTransfer.setData("text/plain", JSON.stringify({
        kind: "campaign-record.record",
        uuid: recordRow.dataset.uuid
      }));
    }
  }

  async #onTimelineDrop(event) {
    const target = event.target.closest("[data-drop-timepoint]");
    if (!target) return;
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    const groupId = target.closest("[data-group-id]").dataset.groupId;
    const group = game.journal.get(groupId);
    if (data.kind === "campaign-record.timepoint") {
      if (data.groupId !== groupId) return; // no cross-group reordering
      await Timepoints.moveTimepoint(group, data.id, Number(target.dataset.position));
    } else if (data.kind === "campaign-record.record") {
      const page = await fromUuid(data.uuid);
      if (!page || page.parent.id !== groupId) {
        return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.WrongGroup"));
      }
      await Timepoints.attachRecord(page, target.dataset.timepointId);
    }
  }
```

In `_prepareContext`, add before `return context`:

```js
    context.timelineGroups = this.#timelineGroups();
```

In `_onRender`, add the drag-drop binding at the end:

```js
    new foundry.applications.ux.DragDrop.implementation({
      dragSelector: "[data-drag-record], [data-drag-timepoint]",
      dropSelector: "[data-drop-timepoint]",
      callbacks: {
        dragstart: this.#onTimelineDragStart.bind(this),
        drop: this.#onTimelineDrop.bind(this)
      }
    }).bind(this.element);
```

- [ ] **Step 2: Replace `templates/hub/timeline.hbs`**

```hbs
<section class="tab hub-timeline" data-group="primary" data-tab="timeline">
  {{#each timelineGroups}}
  <section class="timeline-group" data-group-id="{{this.id}}">
    {{#if @root.allSelected}}<h3>{{this.name}}</h3>{{/if}}
    <ol class="timepoints">
      {{#each this.timepoints}}
      <li class="timepoint" data-timepoint-id="{{this.id}}" data-position="{{this.position}}"
          data-drag-timepoint data-drop-timepoint draggable="true">
        <div class="timepoint-head">
          <span class="timepoint-label">{{this.label}}</span>
          {{#if this.canEdit}}
          <button type="button" data-action="addTimepoint" data-position="{{this.position}}"
                  data-tooltip="CAMPAIGNRECORD.Hub.InsertBefore"><i class="fa-solid fa-arrow-up"></i></button>
          <button type="button" data-action="renameTimepoint"
                  data-tooltip="CAMPAIGNRECORD.Hub.RenameTimepoint"><i class="fa-solid fa-pen"></i></button>
          <button type="button" data-action="deleteTimepoint"
                  data-tooltip="CAMPAIGNRECORD.Hub.DeleteTimepoint"><i class="fa-solid fa-trash"></i></button>
          {{/if}}
        </div>
        <div class="timepoint-records">
          {{#each this.records}}
          <span class="record-chip" data-record-uuid="{{this.uuid}}" data-uuid="{{this.uuid}}"
                data-action="openRecord">{{this.name}}
            {{#if ../canEdit}}
            <a data-action="detachRecord" data-tooltip="CAMPAIGNRECORD.Hub.Detach"><i class="fa-solid fa-xmark"></i></a>
            {{/if}}
          </span>
          {{/each}}
        </div>
      </li>
      {{else}}
      <li class="hint">{{localize "CAMPAIGNRECORD.Hub.NoTimepoints"}}</li>
      {{/each}}
    </ol>
    {{#if this.canEdit}}
    <button type="button" data-action="addTimepoint">
      <i class="fa-solid fa-plus"></i> {{localize "CAMPAIGNRECORD.Hub.AddTimepoint"}}
    </button>
    {{/if}}
  </section>
  {{/each}}
</section>
```

*(Note: `canEdit` is hoisted onto each timepoint object in `#timelineGroups()` so
templates never need multi-level `../` parent paths; record chips reach it as
`{{#if ../canEdit}}` — one level up to the timepoint.)*

- [ ] **Step 3: Add i18n and styles**

In `lang/en.json` inside `CAMPAIGNRECORD.Hub`, add:

```json
"AddTimepoint": "Add Timepoint",
"InsertBefore": "Insert a timepoint before this one",
"RenameTimepoint": "Rename Timepoint",
"DeleteTimepoint": "Delete Timepoint",
"DeleteTimepointConfirm": "Delete this timepoint? Attached records stay; only the timepoint is removed.",
"TimepointLabel": "Label",
"NoTimepoints": "No timepoints yet.",
"Detach": "Detach from this timepoint",
"WrongGroup": "Records can only attach to timepoints in their own group."
```

Append to `styles/campaign-record.css`:

```css
.campaign-hub .timepoints {
  list-style: none;
  margin: 0;
  padding: 0;
  border-left: 2px solid var(--color-border-light-primary, #7a7971);
}

.campaign-hub .timepoint {
  margin: 0 0 0.5rem 0.75rem;
  padding: 0.25rem 0.5rem;
}

.campaign-hub .timepoint-head {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.campaign-hub .timepoint-head .timepoint-label {
  font-weight: bold;
  flex: 1;
}

.campaign-hub .timepoint-head button {
  width: auto;
  line-height: 1;
  padding: 0.15rem 0.35rem;
}

.campaign-hub .record-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border: 1px solid var(--color-border-light-primary, #7a7971);
  border-radius: 1rem;
  padding: 0 0.5rem;
  margin: 0.15rem 0.25rem 0 0;
  cursor: pointer;
  font-size: var(--font-size-12, 12px);
}
```

- [ ] **Step 4: Write the timeline e2e spec (multi-client)**

`tests/e2e/08-hub-timeline.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("hub timeline", () => {
  let gmPage, playerCtx, playerPage, ids;

  const openTimeline = async (p) => {
    await p.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = p.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    await hub.locator('[data-action="tab"][data-tab="timeline"]').click();
    return hub;
  };

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    ids = await createGroupWithPage(gmPage, "E2E Timeline Group", "E2E Timeline NPC", "campaign-record.npc");
    playerCtx = await browser.newContext();
    playerPage = await playerCtx.newPage();
    await login(playerPage, "User 1");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(gmPage, "E2E Timeline");
    await playerCtx.close();
    await gmPage.close();
  });

  test("GM adds a timepoint through the dialog; player sees it live", async () => {
    const gmHub = await openTimeline(gmPage);
    const playerHub = await openTimeline(playerPage);

    await gmHub.locator('.timeline-group button[data-action="addTimepoint"]').last().click();
    const dialogInput = gmPage.locator('dialog input[name="label"], .application.dialog input[name="label"]');
    await dialogInput.waitFor({ timeout: 10_000 });
    await dialogInput.fill("Session 1: The Hook");
    await gmPage.locator('dialog button[data-action="ok"], .application.dialog button[data-action="ok"]').click();

    await expect(gmHub.locator(".timepoint-label", { hasText: "Session 1: The Hook" }))
      .toBeVisible({ timeout: 10_000 });
    await expect(playerHub.locator(".timepoint-label", { hasText: "Session 1: The Hook" }))
      .toBeVisible({ timeout: 10_000 });
  });

  test("player can add and rename timepoints (collaborative by default)", async () => {
    const playerHub = playerPage.locator("#campaign-hub");
    await playerHub.locator('.timeline-group button[data-action="addTimepoint"]').last().click();
    const input = playerPage.locator('dialog input[name="label"], .application.dialog input[name="label"]');
    await input.waitFor({ timeout: 10_000 });
    await input.fill("Session 2");
    await playerPage.locator('dialog button[data-action="ok"], .application.dialog button[data-action="ok"]').click();
    await expect(playerHub.locator(".timepoint-label", { hasText: "Session 2" }))
      .toBeVisible({ timeout: 10_000 });
    await expect(gmPage.locator("#campaign-hub .timepoint-label", { hasText: "Session 2" }))
      .toBeVisible({ timeout: 10_000 });
  });

  test("reordering via moveTimepoint updates both clients", async () => {
    const order = () =>
      gmPage.evaluate(async ({ groupId }) => {
        const { getTimepoints } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
        return getTimepoints(game.journal.get(groupId)).map((t) => t.label);
      }, ids);
    expect(await order()).toEqual(["Session 1: The Hook", "Session 2"]);

    await gmPage.evaluate(async ({ groupId }) => {
      const { getTimepoints, moveTimepoint } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = game.journal.get(groupId);
      const second = getTimepoints(group)[1];
      await moveTimepoint(group, second.id, 0);
    }, ids);
    expect(await order()).toEqual(["Session 2", "Session 1: The Hook"]);

    const labels = playerPage.locator("#campaign-hub .timepoint-label");
    await expect(labels.first()).toHaveText("Session 2", { timeout: 10_000 });
  });

  test("attaching a record shows its chip on both clients; detach removes it", async () => {
    await gmPage.evaluate(async ({ groupId, pageId }) => {
      const { getTimepoints, attachRecord } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = game.journal.get(groupId);
      await attachRecord(group.pages.get(pageId), getTimepoints(group)[0].id);
    }, ids);

    await expect(gmPage.locator("#campaign-hub .record-chip", { hasText: "E2E Timeline NPC" }))
      .toBeVisible({ timeout: 10_000 });
    await expect(playerPage.locator("#campaign-hub .record-chip", { hasText: "E2E Timeline NPC" }))
      .toBeVisible({ timeout: 10_000 });

    await gmPage.locator('#campaign-hub .record-chip [data-action="detachRecord"]').click();
    await expect(gmPage.locator("#campaign-hub .record-chip", { hasText: "E2E Timeline NPC" }))
      .toHaveCount(0, { timeout: 10_000 });
  });
});
```

- [ ] **Step 5: Verify**

Run: `node --check scripts/apps/hub/campaign-hub.mjs` (clean); `npm test` (PASS);
`npx playwright test tests/e2e/08-hub-timeline.spec.mjs` — Expected: 4 passed.
Then the full suite: `npm run test:e2e` — everything green.

- [ ] **Step 6: Commit**

```bash
git add scripts/apps/hub/campaign-hub.mjs templates/hub/timeline.hbs lang/en.json styles/campaign-record.css tests/e2e/08-hub-timeline.spec.mjs
git commit -m "feat: add hub timeline with timepoints, reordering, and record chips"
```

---

### Task 9: Phase close-out — docs and version bump

**Files:**
- Modify: `README.md`
- Modify: `docs/manual-test-checklist.md`
- Modify: `module.json` (version `0.2.0`)

**Interfaces:**
- Consumes: everything shipped in Tasks 1–8.
- Produces: updated user/release documentation.

- [ ] **Step 1: Update `README.md`**

Replace the **Status** paragraph with:

```markdown
**Status:** Phase 2 (Campaign Hub) — groups, NPC/Place/Quest record types,
collaborative sheets, GM-only content, and the Campaign Hub: a filterable
record index, cross-document search, and a free-form timeline. Further record
types, the media presenter, and deeper dnd5e integration are planned; see
`docs/superpowers/specs/2026-07-07-campaign-record-design.md`.
```

In the **Usage** section, add:

```markdown
- Open the **Campaign Hub** from the Journal sidebar button (or Ctrl+Shift+H):
  browse and filter all records in the Index, search everything in Search,
  and organize events on the Timeline — drag records from the Index onto a
  timepoint to attach them.
```

- [ ] **Step 2: Update `docs/manual-test-checklist.md`**

In the **Automated** section, append:

```markdown
- [x] Hub opens from the sidebar for GM and players; tabs switch *(05-hub)*
- [x] Index lists records, filters by type chip, live-updates, and hides
      hidden records from players *(06-hub-index)*
- [x] Search matches structured fields with prefixes and snippets; GM-only
      content is searchable only by GMs *(07-hub-search)*
- [x] Timepoints: GM and player add/rename via dialog, reorder persists,
      record chips attach/detach across clients *(08-hub-timeline)*
```

In the **Manual** section, append:

```markdown
- [ ] Quench "Campaign Record: Hub" batch passes.
- [ ] Drag a record row from the Hub index onto a timeline timepoint — the
      chip appears (pointer-driven drag is not automated).
- [ ] Drag a timepoint onto another timepoint to reorder it.
- [ ] The scene-controls journal group shows an "Open Campaign Hub" tool.
```

- [ ] **Step 3: Bump the module version**

In `module.json`, change `"version": "0.1.0"` to `"version": "0.2.0"`.

- [ ] **Step 4: Final verification**

Run: `npm test` (PASS) and `npm run test:e2e` (all specs pass, including
Phase 1's). Validate `module.json` and `lang/en.json` parse:
`node -e "['module.json','lang/en.json'].forEach(f => JSON.parse(require('fs').readFileSync(f,'utf8'))); console.log('ok')"`.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/manual-test-checklist.md module.json
git commit -m "docs: document the Campaign Hub and bump version to 0.2.0"
```

---

## Out of Scope for This Plan (later phases)

- **Plan 3 — Remaining record types:** PC, Item, Encounter, Shop, Loot, Checklist, Media (sheet only) — each with an e2e sheet spec.
- **Plan 4 — Presenter + dnd5e integration:** slideshow sockets with player-context e2e; 5e item/actor/currency integration.
- **Plan 5 — Release polish:** migration runner + migration e2e, localization sweep, package listing.
