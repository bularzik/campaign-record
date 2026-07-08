# Campaign Record Phase 3 — Remaining Record Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the seven remaining record types (PC, Item, Encounter, Checklist, Shop, Loot, Media — sheet only, no presenter) with sheets, Hub integration, and Playwright e2e coverage, and clear the Phases 1–2 polish backlog.

**Architecture:** Each type follows the established pattern: a `TypeDataModel` extending `BaseRecordModel` (`scripts/data/`), an ApplicationV2 sheet extending `BaseRecordSheet` (`scripts/sheets/`), single-root Handlebars edit/view templates (`templates/<type>/`), and registration in constants / `module.json` / lang / data-model / sheet registries. List-row types (Encounter combatants, Checklist items, Shop inventory, Loot items, Media images) share new id-based row helpers added to `BaseRecordSheet` (extracted from the proven Quest objectives pattern). The Hub picks up new types automatically from `RECORD_TYPES`; each task adds only its `recordSubtitle` case.

**Tech Stack:** Foundry VTT v13 (13.351), plain JS ES modules, Handlebars, Vitest (unit), Playwright (e2e against local Foundry, world-b).

## Global Constraints

- Foundry v13+ (`compatibility.minimum: "13"`); plain JavaScript ES modules, **no build step**, no dependencies.
- All user-facing strings via `game.i18n` with keys in `lang/en.json` — never hardcoded English in JS or templates.
- ApplicationV2 part templates must render **exactly one root element** (v13 throws "Template part must render a single HTML element" otherwise).
- Collaborative editors: `<prose-mirror name="system.X" toggled collaborate data-document-uuid="{{page.uuid}}">…</prose-mirror>` — the UUID must be the `data-document-uuid` dataset attribute, never a bare `document-uuid` attribute.
- List rows (objectives, combatants, inventory, checklist items, images): **id-based targeted array updates** written immediately on action. Row text inputs carry `data-row-field` (no `name=` attribute — form serialization corrupts ArrayFields) and persist via change listeners.
- Every new page type needs ALL of: entry in `RECORD_TYPES` (`scripts/constants.mjs`), sub-type in `module.json` `documentTypes.JournalEntryPage`, `TYPES.JournalEntryPage.campaign-record.<type>` label in `lang/en.json`, data-model registration (`scripts/data/registration.mjs`), sheet registration with `makeDefault: true` (`scripts/sheets/registration.mjs`).
- **After editing `module.json`, restart the Foundry test server** before running e2e (Foundry reads `documentTypes` at server start): `lsof -ti :30000 | xargs kill; sleep 2` then run playwright — `global-setup.mjs` boots world-b automatically.
- Test commands: `npm test` (Vitest, `tests/*.test.js`) and `npx playwright test` (live Foundry, workers=1). Baselines entering this phase: **25 unit / 26 e2e, all green** — the full suites must stay green after every task.
- GM-only content (`gmNotes`, hidden records) is stripped at render time; players must never see it in sheets, index, timeline, or search.
- Commit after each green test cycle with a conventional message (`feat:`, `fix:`, `refactor:`, `test:`).

---

### Task 1: Search & index polish (Phase 1–2 backlog)

Fixes the deferred search-index minors: O(vocabulary) `removeRecord`, duplicate match labels, UUID noise tokens, and non-group pages leaking into the search index.

**Files:**
- Modify: `scripts/logic/search-index.mjs`
- Modify: `scripts/apps/hub/hub-data.mjs` (`toSearchRecord`)
- Modify: `scripts/apps/hub/campaign-hub.mjs` (`_onDocumentChanged`)
- Test: `tests/search-index.test.js` (extend existing suite)

**Interfaces:**
- Consumes: existing `createIndex/indexRecord/removeRecord/search` API (unchanged signatures); `hasGroupFlag(flags)` from `scripts/logic/visibility.mjs`.
- Produces: `toSearchRecord(page)` additionally emits joined text for array-of-rows fields under the field's own key (e.g. `fields.inventory = "Longsword 15 gp Potion"`); UUID-link fields are never indexed. Tasks 5–9 rely on this: **their list fields are searchable with no further search code.**

- [ ] **Step 1: Write failing unit tests**

Append to `tests/search-index.test.js`:

```js
describe("phase 3 polish", () => {
  it("removeRecord only touches the record's own tokens (per-record token set)", () => {
    const index = createIndex();
    indexRecord(index, { uuid: "u1", name: "Alpha", type: "t", fields: { role: "wizard" } });
    indexRecord(index, { uuid: "u2", name: "Beta", type: "t", fields: { role: "warrior" } });
    removeRecord(index, "u1");
    expect(index.records.has("u1")).toBe(false);
    expect(index.records.get("u2").tokens).toBeInstanceOf(Set);
    expect(search(index, "warrior")).toHaveLength(1);
    expect(search(index, "wizard")).toHaveLength(0);
  });

  it("dedupes matches that collapse to the same display field name", () => {
    const index = createIndex();
    indexRecord(index, {
      uuid: "u1", name: "Gamma", type: "t",
      fields: { notes: "secret plan" }, gmFields: { notes: "secret gm plan" }
    });
    const [hit] = search(index, "secret", { gm: true });
    const labels = hit.matches.map((m) => m.field);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `index.records.get("u2").tokens` undefined; duplicate `notes` labels.

- [ ] **Step 3: Implement in `scripts/logic/search-index.mjs`**

In `indexRecord`, collect the record's tokens and store them; rewrite `removeRecord`:

```js
  const gmOnly = new Set(Object.keys(gmFields).map((field) => `${GM_PREFIX}${field}`));
  const texts = {};
  const tokens = new Set();
  for (const [field, raw] of Object.entries(fields)) {
    const text = stripHtml(raw).replace(/\s+/g, " ").trim();
    if (!text) continue;
    texts[field] = text;
    for (const token of tokenize(text)) {
      tokens.add(token);
      let byUuid = index.tokens.get(token);
      if (!byUuid) index.tokens.set(token, (byUuid = new Map()));
      let fieldSet = byUuid.get(record.uuid);
      if (!fieldSet) byUuid.set(record.uuid, (fieldSet = new Set()));
      fieldSet.add(field);
    }
  }
  index.records.set(record.uuid, {
    uuid: record.uuid, name: record.name, type: record.type, texts, gmOnly, tokens
  });
```

```js
export function removeRecord(index, uuid) {
  const rec = index.records.get(uuid);
  if (!rec) return;
  index.records.delete(uuid);
  for (const token of rec.tokens ?? []) {
    const byUuid = index.tokens.get(token);
    if (!byUuid) continue;
    byUuid.delete(uuid);
    if (!byUuid.size) index.tokens.delete(token);
  }
}
```

In `search`, dedupe by display field name (replace the `matches:` mapping):

```js
    const seenLabels = new Set();
    const matches = [];
    for (const f of fields) {
      const label = f.startsWith(GM_PREFIX) ? f.slice(GM_PREFIX.length) : f;
      if (seenLabels.has(label)) continue;
      seenLabels.add(label);
      matches.push({ field: label, snippet: snippetFor(rec.texts[f], terms) });
    }
    results.push({ uuid, name: rec.name, type: rec.type, matches });
```

- [ ] **Step 4: Run unit tests to verify pass**

Run: `npm test`
Expected: PASS (27 tests).

- [ ] **Step 5: Extend `toSearchRecord` in `scripts/apps/hub/hub-data.mjs`**

Replace the record branch of `toSearchRecord` (keep the `text`-page branch and the objectives block as-is):

```js
  } else {
    const s = page.system.toObject();
    const schemaFields = page.system.schema.fields;
    tags = s.tags ?? [];
    for (const [key, value] of Object.entries(s)) {
      // UUID links are noise tokens, not content.
      if (schemaFields[key] instanceof foundry.data.fields.DocumentUUIDField) continue;
      if (typeof value !== "string" || !value || key === "image") continue;
      if (key === "gmNotes") gmFields[key] = value;
      else fields[key] = value;
    }
    // Rows of list fields (combatants, inventory, checklist items, loot items,
    // media captions) contribute their text-ish props under the field's key.
    for (const [key, value] of Object.entries(s)) {
      if (key === "tags" || key === "timepoints" || key === "objectives") continue;
      if (!Array.isArray(value)) continue;
      const text = value
        .map((row) =>
          [row?.name, row?.text, row?.caption, row?.price]
            .filter((v) => typeof v === "string" && v)
            .join(" ")
        )
        .filter(Boolean)
        .join(" ");
      if (text) fields[key] = text;
    }
    if (Array.isArray(s.objectives)) {
```

- [ ] **Step 6: Stop indexing non-group pages in `scripts/apps/hub/campaign-hub.mjs`**

Add the import and guard `_onDocumentChanged` — pages of journals without the group flag were being patched into the index:

```js
import { hasGroupFlag } from "../../logic/visibility.mjs";
```

```js
  _onDocumentChanged(hook, doc) {
    if (
      this.#searchIndex &&
      doc.documentName === "JournalEntryPage" &&
      isIndexablePage(doc) &&
      hasGroupFlag(doc.parent?.flags)
    ) {
```

- [ ] **Step 7: Extend the search e2e spec**

In `tests/e2e/07-hub-search.spec.mjs`, add to the existing describe block (reuse its logged-in GM page and group; adapt the fixture names to the file's existing helpers):

```js
  test("UUID link values are not searchable; non-group pages stay out of the index", async () => {
    // Link an actor-shaped UUID onto the NPC, then search for its id fragment.
    await gmPage.evaluate(async ({ groupId, pageId }) => {
      const page = game.journal.get(groupId).pages.get(pageId);
      await page.update({ "system.actor": "Actor.abcdef0123456789" });
    }, { groupId: ids.groupId, pageId: ids.pageId });
    // A text page in a NON-group journal must never appear in results.
    await gmPage.evaluate(async () => {
      const entry = await JournalEntry.create({ name: "E2E Search Plain Journal" });
      await entry.createEmbeddedDocuments("JournalEntryPage", [
        { name: "Plain Page", type: "text", text: { content: "zanzibar contraband" } }
      ]);
    });
    const search = async (q) =>
      gmPage.evaluate(async (q) => {
        const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
        const hub = CampaignHub.open();
        hub.state.query = q;
        await hub.render(true);
        return hub.element.querySelectorAll(".search-result").length;
      }, q);
    expect(await search("abcdef0123456789")).toBe(0);
    expect(await search("zanzibar")).toBe(0);
    await gmPage.evaluate(() => game.journal.getName("E2E Search Plain Journal")?.delete());
  });
```

Adjust the `.search-result` selector to whatever class `templates/hub/search.hbs` gives result rows (check the template; use its actual hit-row selector).

- [ ] **Step 8: Run the gates**

Run: `npm test` → 27 passed. Then `npx playwright test tests/e2e/07-hub-search.spec.mjs` → all passing, and `npx playwright test` → full suite green.

- [ ] **Step 9: Commit**

```bash
git add scripts/logic/search-index.mjs scripts/apps/hub/hub-data.mjs scripts/apps/hub/campaign-hub.mjs tests/search-index.test.js tests/e2e/07-hub-search.spec.mjs
git commit -m "fix: search-index polish — per-record token sets, match dedupe, UUID/non-group noise"
```

---

### Task 2: Timeline & Hub UI polish (Phase 1–2 backlog)

Clears the remaining deferred minors: batched timepoint detach, NaN position guard, rename-dialog OK label, tag-filter clobber while typing, redundant chip attribute, dead `stopPropagation`, and documentation comments for accepted trade-offs.

**Files:**
- Modify: `scripts/data/timepoints.mjs`
- Modify: `scripts/logic/timeline-sort.mjs` (comment only)
- Modify: `scripts/apps/hub/campaign-hub.mjs`
- Modify: `templates/hub/timeline.hbs`
- Modify: `lang/en.json` (add `CAMPAIGNRECORD.Hub.Rename`)
- Modify: `tests/e2e/helpers/foundry.mjs`, `tests/e2e/08-hub-timeline.spec.mjs`

**Interfaces:**
- Consumes: existing Timepoints API (signatures unchanged).
- Produces: `#promptLabel(titleKey, initial, okKey)` (private, Hub-internal); `settle(page, ms)` helper exported from `tests/e2e/helpers/foundry.mjs` for later specs asserting no-ops.

- [ ] **Step 1: `deleteTimepoint` — one batched embedded update instead of sequential per-page awaits**

Replace the loop in `scripts/data/timepoints.mjs`:

```js
export async function deleteTimepoint(group, id) {
  await setTimepoints(group, getTimepoints(group).filter((t) => t.id !== id));
  const updates = group.pages
    .filter((p) => p.system?.timepoints?.has?.(id) && p.canUserModify(game.user, "update"))
    .map((p) => ({ _id: p.id, "system.timepoints": [...p.system.timepoints].filter((t) => t !== id) }));
  if (!updates.length) return;
  try {
    await group.updateEmbeddedDocuments("JournalEntryPage", updates);
  } catch (error) {
    console.warn("campaign-record | failed to detach deleted timepoint from pages", group.uuid, error);
  }
}
```

- [ ] **Step 2: `addTimepoint` — position sanity + concurrency comment**

```js
export async function addTimepoint(group, label, position = null) {
  // Concurrent edits to a group's timepoints are last-write-wins on the whole
  // flag array (accepted: the array is small and edits are rare).
  if (!Number.isInteger(position)) position = null;
  const tps = getTimepoints(group);
```

- [ ] **Step 3: `sortKeyBetween` precision comment in `scripts/logic/timeline-sort.mjs`**

Above `sortKeyBetween`:

```js
// Repeated midpoint inserts at the same spot halve the gap each time; float
// precision exhausts after ~50 such inserts. Accepted for hand-edited
// timelines — no rebalancing pass.
```

- [ ] **Step 4: Hub fixes in `scripts/apps/hub/campaign-hub.mjs`**

(a) `#promptLabel` gains an OK-label parameter (rename no longer says "Create"):

```js
  static async #promptLabel(titleKey, initial = "", okKey = "CAMPAIGNRECORD.Create") {
    ...
      ok: {
        label: okKey,
```

In `#onRenameTimepoint`:

```js
    const label = await CampaignHub.#promptLabel(
      "CAMPAIGNRECORD.Hub.RenameTimepoint", current, "CAMPAIGNRECORD.Hub.Rename"
    );
```

Add to `lang/en.json` under `Hub`: `"Rename": "Rename",`

(b) NaN guard in `#onAddTimepoint`:

```js
    const raw = Number(target.dataset.position);
    const position = Number.isInteger(raw) && target.dataset.position !== "" && target.dataset.position != null
      ? raw
      : null;
```

(simplify to `const raw = Number(target.dataset.position); const position = target.dataset.position != null && Number.isInteger(raw) ? raw : null;`)

(c) Tag filter — switch from `change` to debounced `input` with focus restore, so a document-hook re-render mid-typing no longer clobbers uncommitted text:

```js
    const tagFilter = this.element.querySelector('input[name="tag-filter"]');
    if (tagFilter && !tagFilter.dataset.crBound) {
      tagFilter.dataset.crBound = "1";
      tagFilter.addEventListener("input", foundry.utils.debounce(async (event) => {
        this.state.tag = event.target.value.trim();
        await this.render({ parts: ["index"] });
        // render({parts}) replaces this part's DOM — restore focus to keep typing.
        const restored = this.element.querySelector('input[name="tag-filter"]');
        restored?.focus();
        restored?.setSelectionRange(restored.value.length, restored.value.length);
      }, 250));
    }
```

(d) `#onDetachRecord` — drop the dead `event.stopPropagation()` (ApplicationV2 dispatches only the innermost `data-action`), and read the consolidated attribute:

```js
  static async #onDetachRecord(event, target) {
    const id = target.closest("[data-timepoint-id]").dataset.timepointId;
    const page = await fromUuid(target.closest("[data-uuid]").dataset.uuid);
    if (page) await Timepoints.detachRecord(page, id);
  }
```

(e) Search-input focus restore: **keep** (it is not redundant — the partial render replaces the input); add the same one-line comment as (c) above the restore.

- [ ] **Step 5: Remove the redundant chip attribute in `templates/hub/timeline.hbs`**

```hbs
          <span class="record-chip" data-uuid="{{this.uuid}}"
                data-action="openRecord">{{this.name}}
```

(delete `data-record-uuid="{{this.uuid}}"`; Step 4d already switched the reader.)

- [ ] **Step 6: Named settle helper for no-op e2e assertions**

In `tests/e2e/helpers/foundry.mjs`:

```js
/**
 * Bounded settle for asserting a change did NOT happen: a no-op has no
 * observable completion signal to await, so we wait out the round-trip window.
 */
export async function settle(page, ms = 300) {
  await page.waitForTimeout(ms);
}
```

In `tests/e2e/08-hub-timeline.spec.mjs`, import `settle` and replace the bare sleep at the cross-group-reorder no-op:

```js
    await settle(gmPage);
```

- [ ] **Step 7: Run the gates**

Run: `npm test` → all passing (timeline-sort suite unchanged). Then `npx playwright test` → full suite green (08-hub-timeline exercises add/rename/delete/reorder and detach paths changed here).

- [ ] **Step 8: Commit**

```bash
git add scripts/data/timepoints.mjs scripts/logic/timeline-sort.mjs scripts/apps/hub/campaign-hub.mjs templates/hub/timeline.hbs lang/en.json tests/e2e/helpers/foundry.mjs tests/e2e/08-hub-timeline.spec.mjs
git commit -m "fix: timeline & hub polish — batched detach, rename label, tag-filter typing, chip attrs"
```

---

### Task 3: Shared list-row helpers + Quest refactor

Five Phase 3 types need id-based row CRUD. Extract the proven Quest-objectives pattern into `BaseRecordSheet` helpers and refactor Quest onto them, gated by the existing quest e2e spec.

**Files:**
- Modify: `scripts/sheets/base-record-sheet.mjs`
- Modify: `scripts/sheets/quest-sheet.mjs`
- Modify: `templates/quest/edit.hbs`, `templates/quest/view.hbs`
- Test: `tests/e2e/03-quest.spec.mjs` (update selectors; regression gate)

**Interfaces:**
- Produces (used by Tasks 5–9):
  - `BaseRecordSheet#updateRows(field, mutate)` — reads `system.toObject()[field]`, applies `mutate(rows)`, writes one targeted `system.<field>` update.
  - `BaseRecordSheet#bindRowInputs(field)` — binds change listeners on `[data-rows="<field>"] [data-row-field]` inputs; each writes `rows.find(r => r.id === rowId)[dataset.rowField] = value` (numbers coerced for `type="number"`). Call from `_onRender`.
  - Template contract: container `data-rows="<field>"`, each row `data-row-id="{{this.id}}"`, editable inputs `data-row-field="<key>"` (no `name=`), action buttons resolve their row via `target.closest("[data-row-id]")`.

- [ ] **Step 1: Add helpers to `scripts/sheets/base-record-sheet.mjs`**

```js
  /** Read, mutate, and write an array field as one targeted update. */
  async updateRows(field, mutate) {
    const rows = this.document.system.toObject()[field];
    mutate(rows);
    await this.document.update({ [`system.${field}`]: rows });
  }

  /**
   * Persist edits from inputs marked data-row-field inside [data-row-id] rows.
   * Inputs carry no name= — form serialization would corrupt the ArrayField.
   */
  bindRowInputs(field) {
    for (const input of this.element.querySelectorAll(`[data-rows="${field}"] [data-row-field]`)) {
      input.addEventListener("change", (event) => {
        event.stopPropagation();
        const id = event.currentTarget.closest("[data-row-id]").dataset.rowId;
        const key = event.currentTarget.dataset.rowField;
        const value = event.currentTarget.type === "number"
          ? Number(event.currentTarget.value)
          : event.currentTarget.value;
        this.updateRows(field, (rows) => {
          const row = rows.find((r) => r.id === id);
          if (row) row[key] = value;
        });
      });
    }
  }
```

- [ ] **Step 2: Refactor `scripts/sheets/quest-sheet.mjs` onto the helpers**

Delete `#updateObjectives`, `#updateObjectiveText`, and the manual `_onRender` listener loop. Replace with:

```js
  _onRender(context, options) {
    super._onRender(context, options);
    this.bindRowInputs("objectives");
  }

  static async #onAddObjective() {
    await this.updateRows("objectives", (rows) =>
      rows.push({ id: foundry.utils.randomID(), text: "", done: false, gmOnly: false })
    );
  }

  static async #onDeleteObjective(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("objectives", (rows) => {
      const i = rows.findIndex((o) => o.id === id);
      if (i >= 0) rows.splice(i, 1);
    });
  }

  static async #onToggleObjective(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("objectives", (rows) => {
      const o = rows.find((x) => x.id === id);
      if (o) o.done = !o.done;
    });
  }

  static async #onToggleObjectiveGmOnly(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("objectives", (rows) => {
      const o = rows.find((x) => x.id === id);
      if (o) o.gmOnly = !o.gmOnly;
    });
  }
```

- [ ] **Step 3: Update quest templates to the row contract**

`templates/quest/edit.hbs` — objective list becomes:

```hbs
  <ol data-rows="objectives">
    {{#each objectives}}
    <li data-row-id="{{this.id}}" class="{{#if this.gmOnly}}gm-only{{/if}}">
      <input type="checkbox" data-action="toggleObjective" {{#if this.done}}checked{{/if}}>
      <input type="text" data-row-field="text" value="{{this.text}}">
```

(rest of the row unchanged). `templates/quest/view.hbs` — `data-objective-id` → `data-row-id` on the `<li>`.

- [ ] **Step 4: Update `tests/e2e/03-quest.spec.mjs` selectors**

`input[data-objective-text]` → `input[data-row-field="text"]`. (The `data-action` selectors are unchanged.)

- [ ] **Step 5: Run the regression gate**

Run: `npx playwright test tests/e2e/03-quest.spec.mjs` → 2 passed (add/edit/toggle/structured-edit survival + GM-only filtering & player toggle). Then `npx playwright test` → full suite green, and `npm test` → all passing.

- [ ] **Step 6: Commit**

```bash
git add scripts/sheets/base-record-sheet.mjs scripts/sheets/quest-sheet.mjs templates/quest/edit.hbs templates/quest/view.hbs tests/e2e/03-quest.spec.mjs
git commit -m "refactor: extract id-based list-row helpers into BaseRecordSheet"
```

---

### Task 4: PC and Item record types

Two simple structured-field types following the NPC/Place pattern exactly.

**Files:**
- Create: `scripts/data/pc.mjs`, `scripts/data/item.mjs`
- Create: `scripts/sheets/pc-sheet.mjs`, `scripts/sheets/item-record-sheet.mjs`
- Create: `templates/pc/edit.hbs`, `templates/pc/view.hbs`, `templates/item/edit.hbs`, `templates/item/view.hbs`
- Modify: `scripts/constants.mjs`, `scripts/data/registration.mjs`, `scripts/sheets/registration.mjs`, `module.json`, `lang/en.json`, `scripts/apps/hub/hub-data.mjs`
- Test: `tests/e2e/09-pc-item.spec.mjs`

**Interfaces:**
- Consumes: `BaseRecordModel`, `BaseRecordSheet` (incl. `_onDropDocument`), common partials `campaign-record.common-edit/view`.
- Produces: page types `campaign-record.pc` (fields `playerName`, `classLevel`, `faction`, `actor`) and `campaign-record.item` (fields `itemType`, `rarity`, `attunement`, `item`).

- [ ] **Step 1: Data models**

`scripts/data/pc.mjs`:

```js
import { BaseRecordModel } from "./base-record.mjs";

const { StringField, DocumentUUIDField } = foundry.data.fields;

export class PcModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Pc"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      playerName: new StringField(),
      classLevel: new StringField(),
      faction: new StringField(),
      actor: new DocumentUUIDField({ type: "Actor" })
    };
  }
}
```

`scripts/data/item.mjs`:

```js
import { BaseRecordModel } from "./base-record.mjs";

const { StringField, DocumentUUIDField } = foundry.data.fields;

export class ItemRecordModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Item"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      itemType: new StringField(),
      rarity: new StringField(),
      attunement: new StringField(),
      item: new DocumentUUIDField({ type: "Item" })
    };
  }
}
```

- [ ] **Step 2: Sheets**

`scripts/sheets/pc-sheet.mjs`:

```js
import { BaseRecordSheet } from "./base-record-sheet.mjs";

const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

export class PcSheet extends BaseRecordSheet {
  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/pc/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/pc/view.hbs" }
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

`scripts/sheets/item-record-sheet.mjs` (identical shape; Item drop, `templates/item/`):

```js
import { BaseRecordSheet } from "./base-record-sheet.mjs";

const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

export class ItemRecordSheet extends BaseRecordSheet {
  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/item/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/item/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.enriched.itemLink = this.document.system.item
      ? await TextEditorImpl.enrichHTML(`@UUID[${this.document.system.item}]`)
      : "";
    return context;
  }

  async _onDropDocument(data) {
    if (data.type !== "Item") return;
    await this.document.update({ "system.item": data.uuid });
  }
}
```

- [ ] **Step 3: Templates (single root element each)**

`templates/pc/edit.hbs`:

```hbs
<section class="campaign-record-content record-edit">
<div class="form-fields-grid">
  {{formGroup systemFields.playerName value=system.playerName localize=true}}
  {{formGroup systemFields.classLevel value=system.classLevel localize=true}}
  {{formGroup systemFields.faction value=system.faction localize=true}}
</div>
<div class="form-group campaign-record-drop">
  <label>{{localize "CAMPAIGNRECORD.Pc.FIELDS.actor.label"}}</label>
  {{#if enriched.actorLink}}{{{enriched.actorLink}}}{{else}}
    <span class="hint">{{localize "CAMPAIGNRECORD.DropActorHint"}}</span>
  {{/if}}
</div>
{{> campaign-record.common-edit}}
</section>
```

`templates/pc/view.hbs`:

```hbs
<section class="campaign-record-content record-view">
<dl class="record-facts">
  {{#if system.playerName}}<dt>{{localize "CAMPAIGNRECORD.Pc.FIELDS.playerName.label"}}</dt><dd>{{system.playerName}}</dd>{{/if}}
  {{#if system.classLevel}}<dt>{{localize "CAMPAIGNRECORD.Pc.FIELDS.classLevel.label"}}</dt><dd>{{system.classLevel}}</dd>{{/if}}
  {{#if system.faction}}<dt>{{localize "CAMPAIGNRECORD.Pc.FIELDS.faction.label"}}</dt><dd>{{system.faction}}</dd>{{/if}}
  {{#if enriched.actorLink}}<dt>{{localize "CAMPAIGNRECORD.Pc.FIELDS.actor.label"}}</dt><dd>{{{enriched.actorLink}}}</dd>{{/if}}
</dl>
{{> campaign-record.common-view}}
</section>
```

`templates/item/edit.hbs`:

```hbs
<section class="campaign-record-content record-edit">
<div class="form-fields-grid">
  {{formGroup systemFields.itemType value=system.itemType localize=true}}
  {{formGroup systemFields.rarity value=system.rarity localize=true}}
  {{formGroup systemFields.attunement value=system.attunement localize=true}}
</div>
<div class="form-group campaign-record-drop">
  <label>{{localize "CAMPAIGNRECORD.Item.FIELDS.item.label"}}</label>
  {{#if enriched.itemLink}}{{{enriched.itemLink}}}{{else}}
    <span class="hint">{{localize "CAMPAIGNRECORD.DropItemHint"}}</span>
  {{/if}}
</div>
{{> campaign-record.common-edit}}
</section>
```

`templates/item/view.hbs`:

```hbs
<section class="campaign-record-content record-view">
<dl class="record-facts">
  {{#if system.itemType}}<dt>{{localize "CAMPAIGNRECORD.Item.FIELDS.itemType.label"}}</dt><dd>{{system.itemType}}</dd>{{/if}}
  {{#if system.rarity}}<dt>{{localize "CAMPAIGNRECORD.Item.FIELDS.rarity.label"}}</dt><dd>{{system.rarity}}</dd>{{/if}}
  {{#if system.attunement}}<dt>{{localize "CAMPAIGNRECORD.Item.FIELDS.attunement.label"}}</dt><dd>{{system.attunement}}</dd>{{/if}}
  {{#if enriched.itemLink}}<dt>{{localize "CAMPAIGNRECORD.Item.FIELDS.item.label"}}</dt><dd>{{{enriched.itemLink}}}</dd>{{/if}}
</dl>
{{> campaign-record.common-view}}
</section>
```

- [ ] **Step 4: Registration wiring**

`scripts/constants.mjs`: `RECORD_TYPES = ["npc", "place", "quest", "pc", "item"];`

`scripts/data/registration.mjs` — add imports and entries:

```js
import { PcModel } from "./pc.mjs";
import { ItemRecordModel } from "./item.mjs";
    [typeId("pc")]: PcModel,
    [typeId("item")]: ItemRecordModel
```

`scripts/sheets/registration.mjs` — add imports and:

```js
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, PcSheet, {
    types: [typeId("pc")], makeDefault: true, label: "CAMPAIGNRECORD.Sheets.Pc"
  });
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, ItemRecordSheet, {
    types: [typeId("item")], makeDefault: true, label: "CAMPAIGNRECORD.Sheets.Item"
  });
```

`module.json` `documentTypes.JournalEntryPage`: add `"pc": {}, "item": {}`.

`lang/en.json` — under `TYPES.JournalEntryPage`: `"campaign-record.pc": "Player Character", "campaign-record.item": "Item"`. Under `CAMPAIGNRECORD`: `"DropItemHint": "Drop an Item here to link it.",` and under `Sheets`: `"Pc": "Campaign Record PC Sheet", "Item": "Campaign Record Item Sheet"`. New sections:

```json
    "Pc": {
      "FIELDS": {
        "playerName": { "label": "Player" },
        "classLevel": { "label": "Class & Level" },
        "faction": { "label": "Faction" },
        "actor": { "label": "Linked Actor" }
      }
    },
    "Item": {
      "FIELDS": {
        "itemType": { "label": "Item Type" },
        "rarity": { "label": "Rarity" },
        "attunement": { "label": "Attunement" },
        "item": { "label": "Linked Item" }
      }
    },
```

- [ ] **Step 5: Hub subtitles in `scripts/apps/hub/hub-data.mjs`**

Add cases to `recordSubtitle`:

```js
    case `${TYPE_PREFIX}pc`:
      return [s.playerName, s.classLevel].filter(Boolean).join(" — ");
    case `${TYPE_PREFIX}item`:
      return [s.itemType, s.rarity].filter(Boolean).join(" — ");
```

- [ ] **Step 6: E2E spec `tests/e2e/09-pc-item.spec.mjs`**

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("PC and Item record sheets", () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(page, "E2E PcItem");
    await page.close();
  });

  test("PC edit sheet renders, persists, and view mode shows the facts", async () => {
    const { groupId, pageId } = await createGroupWithPage(
      page, "E2E PcItem Group", "E2E PC", "campaign-record.pc"
    );
    await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId, pageId }
    );
    const sheet = page.locator(".campaign-record.record-sheet").last();
    const player = sheet.locator('[name="system.playerName"]');
    await player.waitFor({ timeout: 15_000 });
    await player.fill("Dan");
    await player.dispatchEvent("change");
    const cls = sheet.locator('[name="system.classLevel"]');
    await cls.fill("Wizard 5");
    await cls.dispatchEvent("change");
    await expect
      .poll(() =>
        page.evaluate(
          ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.classLevel,
          { groupId, pageId }
        )
      )
      .toBe("Wizard 5");
    await page.evaluate(
      async ({ groupId, pageId }) => {
        const g = game.journal.get(groupId);
        await g.pages.get(pageId).sheet.close();
        await g.sheet.render(true);
        await g.sheet.goToPage(pageId);
      },
      { groupId, pageId }
    );
    const facts = page.locator(".journal-entry-page dl.record-facts");
    await facts.waitFor({ timeout: 15_000 });
    await expect(facts).toContainText("Dan");
    await expect(facts).toContainText("Wizard 5");
    await page.evaluate(({ groupId }) => game.journal.get(groupId).sheet.close(), { groupId, pageId });
  });

  test("Item edit sheet renders and persists rarity", async () => {
    const { groupId, pageId } = await page.evaluate(async () => {
      const g = game.journal.getName("E2E PcItem Group");
      const [p] = await g.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Item", type: "campaign-record.item" }
      ]);
      await p.sheet.render(true);
      return { groupId: g.id, pageId: p.id };
    });
    const sheet = page.locator(".campaign-record.record-sheet").last();
    const rarity = sheet.locator('[name="system.rarity"]');
    await rarity.waitFor({ timeout: 15_000 });
    await rarity.fill("Very Rare");
    await rarity.dispatchEvent("change");
    await expect
      .poll(() =>
        page.evaluate(
          ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.rarity,
          { groupId, pageId }
        )
      )
      .toBe("Very Rare");
    await expect(sheet.locator("prose-mirror")).toHaveCount(2);
    await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.close(),
      { groupId, pageId }
    );
  });
});
```

- [ ] **Step 7: Restart server, run gates**

```bash
lsof -ti :30000 | xargs kill; sleep 2
npx playwright test tests/e2e/09-pc-item.spec.mjs
npx playwright test
npm test
```

Expected: new spec 2 passed; full e2e + unit suites green.

- [ ] **Step 8: Commit**

```bash
git add scripts/data/pc.mjs scripts/data/item.mjs scripts/sheets/pc-sheet.mjs scripts/sheets/item-record-sheet.mjs templates/pc templates/item scripts/constants.mjs scripts/data/registration.mjs scripts/sheets/registration.mjs module.json lang/en.json scripts/apps/hub/hub-data.mjs tests/e2e/09-pc-item.spec.mjs
git commit -m "feat: PC and Item record types"
```

---

### Task 5: Encounter record type

Structured fields plus a combatants row list (first consumer of the Task 3 helpers) with Actor-drop-to-add and Scene link.

**Files:**
- Create: `scripts/data/encounter.mjs`, `scripts/sheets/encounter-sheet.mjs`, `templates/encounter/edit.hbs`, `templates/encounter/view.hbs`
- Modify: `scripts/constants.mjs`, `scripts/data/registration.mjs`, `scripts/sheets/registration.mjs`, `module.json`, `lang/en.json`, `scripts/apps/hub/hub-data.mjs`
- Test: `tests/e2e/10-encounter.spec.mjs`

**Interfaces:**
- Consumes: `updateRows`/`bindRowInputs` (Task 3), `BaseRecordSheet._onDropDocument`.
- Produces: page type `campaign-record.encounter` — fields `location`, `difficulty`, `outcome`, `combatants: [{id, name, count, actor}]`, `scene`.

- [ ] **Step 1: Model `scripts/data/encounter.mjs`**

```js
import { BaseRecordModel } from "./base-record.mjs";

const { StringField, NumberField, ArrayField, SchemaField, DocumentUUIDField } =
  foundry.data.fields;

export class EncounterModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Encounter"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      location: new StringField(),
      difficulty: new StringField(),
      outcome: new StringField(),
      combatants: new ArrayField(
        new SchemaField({
          id: new StringField({ required: true, blank: false }),
          name: new StringField(),
          count: new NumberField({ required: true, integer: true, min: 1, initial: 1 }),
          actor: new DocumentUUIDField({ type: "Actor" })
        })
      ),
      scene: new DocumentUUIDField({ type: "Scene" })
    };
  }
}
```

- [ ] **Step 2: Sheet `scripts/sheets/encounter-sheet.mjs`**

```js
import { BaseRecordSheet } from "./base-record-sheet.mjs";

const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

export class EncounterSheet extends BaseRecordSheet {
  static DEFAULT_OPTIONS = {
    actions: {
      addCombatant: EncounterSheet.#onAddCombatant,
      deleteCombatant: EncounterSheet.#onDeleteCombatant
    }
  };

  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/encounter/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/encounter/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.enriched.sceneLink = this.document.system.scene
      ? await TextEditorImpl.enrichHTML(`@UUID[${this.document.system.scene}]`)
      : "";
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.bindRowInputs("combatants");
  }

  static async #onAddCombatant() {
    await this.updateRows("combatants", (rows) =>
      rows.push({ id: foundry.utils.randomID(), name: "", count: 1, actor: null })
    );
  }

  static async #onDeleteCombatant(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("combatants", (rows) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    });
  }

  async _onDropDocument(data) {
    if (data.type === "Scene") return this.document.update({ "system.scene": data.uuid });
    if (data.type === "Actor") {
      const actor = await fromUuid(data.uuid);
      return this.updateRows("combatants", (rows) =>
        rows.push({ id: foundry.utils.randomID(), name: actor?.name ?? "", count: 1, actor: data.uuid })
      );
    }
  }
}
```

- [ ] **Step 3: Templates**

`templates/encounter/edit.hbs`:

```hbs
<section class="campaign-record-content record-edit">
<div class="form-fields-grid">
  {{formGroup systemFields.location value=system.location localize=true}}
  {{formGroup systemFields.difficulty value=system.difficulty localize=true}}
  {{formGroup systemFields.outcome value=system.outcome localize=true}}
</div>
<fieldset class="encounter-combatants campaign-record-drop">
  <legend>{{localize "CAMPAIGNRECORD.Encounter.FIELDS.combatants.label"}}</legend>
  <ol data-rows="combatants">
    {{#each system.combatants}}
    <li data-row-id="{{this.id}}">
      <input type="text" data-row-field="name" value="{{this.name}}">
      <input type="number" data-row-field="count" value="{{this.count}}" min="1" step="1">
      <button type="button" data-action="deleteCombatant"
              aria-label="{{localize "CAMPAIGNRECORD.DeleteRow"}}"><i class="fa-solid fa-trash"></i></button>
    </li>
    {{/each}}
  </ol>
  <button type="button" data-action="addCombatant">
    <i class="fa-solid fa-plus"></i> {{localize "CAMPAIGNRECORD.Encounter.AddCombatant"}}
  </button>
  <p class="hint">{{localize "CAMPAIGNRECORD.DropActorHint"}}</p>
</fieldset>
<div class="form-group campaign-record-drop">
  <label>{{localize "CAMPAIGNRECORD.Encounter.FIELDS.scene.label"}}</label>
  {{#if enriched.sceneLink}}{{{enriched.sceneLink}}}{{else}}
    <span class="hint">{{localize "CAMPAIGNRECORD.DropSceneHint"}}</span>
  {{/if}}
</div>
{{> campaign-record.common-edit}}
</section>
```

`templates/encounter/view.hbs`:

```hbs
<section class="campaign-record-content record-view">
<dl class="record-facts">
  {{#if system.location}}<dt>{{localize "CAMPAIGNRECORD.Encounter.FIELDS.location.label"}}</dt><dd>{{system.location}}</dd>{{/if}}
  {{#if system.difficulty}}<dt>{{localize "CAMPAIGNRECORD.Encounter.FIELDS.difficulty.label"}}</dt><dd>{{system.difficulty}}</dd>{{/if}}
  {{#if system.outcome}}<dt>{{localize "CAMPAIGNRECORD.Encounter.FIELDS.outcome.label"}}</dt><dd>{{system.outcome}}</dd>{{/if}}
  {{#if enriched.sceneLink}}<dt>{{localize "CAMPAIGNRECORD.Encounter.FIELDS.scene.label"}}</dt><dd>{{{enriched.sceneLink}}}</dd>{{/if}}
</dl>
{{#if system.combatants.length}}
<section class="encounter-combatants">
  <h3>{{localize "CAMPAIGNRECORD.Encounter.FIELDS.combatants.label"}}</h3>
  <ul>
    {{#each system.combatants}}
    <li>{{this.count}} × {{this.name}}</li>
    {{/each}}
  </ul>
</section>
{{/if}}
{{> campaign-record.common-view}}
</section>
```

- [ ] **Step 4: Registration + lang + subtitle**

- `RECORD_TYPES`: append `"encounter"`.
- `scripts/data/registration.mjs`: `[typeId("encounter")]: EncounterModel` (+ import).
- `scripts/sheets/registration.mjs`: register `EncounterSheet` for `typeId("encounter")`, label `CAMPAIGNRECORD.Sheets.Encounter`, `makeDefault: true` (+ import).
- `module.json`: add `"encounter": {}`.
- `lang/en.json`: `TYPES.JournalEntryPage["campaign-record.encounter"]: "Encounter"`; `Sheets.Encounter: "Campaign Record Encounter Sheet"`; top-level `"DeleteRow": "Delete row",` under `CAMPAIGNRECORD`; section:

```json
    "Encounter": {
      "AddCombatant": "Add Combatant",
      "FIELDS": {
        "location": { "label": "Location" },
        "difficulty": { "label": "Difficulty" },
        "outcome": { "label": "Outcome" },
        "combatants": { "label": "Combatants" },
        "scene": { "label": "Linked Scene" }
      }
    },
```

- `recordSubtitle` case:

```js
    case `${TYPE_PREFIX}encounter`:
      return [s.difficulty, s.location].filter(Boolean).join(" — ");
```

- [ ] **Step 5: E2E spec `tests/e2e/10-encounter.spec.mjs`**

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("encounter sheet", () => {
  let page, ids;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
    ids = await createGroupWithPage(page, "E2E Encounter Group", "E2E Encounter", "campaign-record.encounter");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(page, "E2E Encounter");
    await page.close();
  });

  const system = () =>
    page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.toObject(),
      { groupId: ids.groupId, pageId: ids.pageId }
    );

  test("combatant rows: add, edit name and count, delete; fields persist", async () => {
    await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = page.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[data-action="addCombatant"]').waitFor({ timeout: 15_000 });

    await sheet.locator('[name="system.difficulty"]').fill("Deadly");
    await sheet.locator('[name="system.difficulty"]').dispatchEvent("change");
    await expect.poll(async () => (await system()).difficulty).toBe("Deadly");

    await sheet.locator('[data-action="addCombatant"]').click();
    await expect.poll(async () => (await system()).combatants.length).toBe(1);

    const name = sheet.locator('[data-rows="combatants"] [data-row-field="name"]').first();
    await name.fill("Goblin");
    await name.dispatchEvent("change");
    const count = sheet.locator('[data-rows="combatants"] [data-row-field="count"]').first();
    await count.fill("4");
    await count.dispatchEvent("change");
    await expect.poll(async () => (await system()).combatants[0]).toMatchObject({ name: "Goblin", count: 4 });

    await sheet.locator('[data-action="addCombatant"]').click();
    await expect.poll(async () => (await system()).combatants.length).toBe(2);
    await sheet.locator('[data-action="deleteCombatant"]').last().click();
    await expect.poll(async () => (await system()).combatants.length).toBe(1);
    expect((await system()).combatants[0].name).toBe("Goblin");
  });

  test("view mode lists combatants with counts", async () => {
    await page.evaluate(
      async ({ groupId, pageId }) => {
        const g = game.journal.get(groupId);
        await g.pages.get(pageId).sheet.close();
        await g.sheet.render(true);
        await g.sheet.goToPage(pageId);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const combatants = page.locator(".journal-entry-page .encounter-combatants");
    await combatants.waitFor({ timeout: 15_000 });
    await expect(combatants).toContainText("4 × Goblin");
    await page.evaluate(({ groupId }) => game.journal.get(groupId).sheet.close(), ids);
  });
});
```

- [ ] **Step 6: Restart server, run gates**

```bash
lsof -ti :30000 | xargs kill; sleep 2
npx playwright test tests/e2e/10-encounter.spec.mjs
npx playwright test
npm test
```

Expected: new spec 2 passed; full suites green.

- [ ] **Step 7: Commit**

```bash
git add scripts/data/encounter.mjs scripts/sheets/encounter-sheet.mjs templates/encounter scripts/constants.mjs scripts/data/registration.mjs scripts/sheets/registration.mjs module.json lang/en.json scripts/apps/hub/hub-data.mjs tests/e2e/10-encounter.spec.mjs
git commit -m "feat: Encounter record type with combatant rows"
```

---

### Task 6: Checklist record type

Items list with done flags and optional per-item assignee; toggling works from view mode for players (spec-mandated both-client e2e).

**Files:**
- Create: `scripts/data/checklist.mjs`, `scripts/sheets/checklist-sheet.mjs`, `templates/checklist/edit.hbs`, `templates/checklist/view.hbs`
- Modify: `scripts/constants.mjs`, `scripts/data/registration.mjs`, `scripts/sheets/registration.mjs`, `module.json`, `lang/en.json`, `scripts/apps/hub/hub-data.mjs`
- Test: `tests/e2e/11-checklist.spec.mjs`

**Interfaces:**
- Consumes: `updateRows`/`bindRowInputs`.
- Produces: page type `campaign-record.checklist` — field `items: [{id, text, done, assignee}]` (`assignee` = User id string or `""`).

- [ ] **Step 1: Model `scripts/data/checklist.mjs`**

```js
import { BaseRecordModel } from "./base-record.mjs";

const { StringField, BooleanField, ArrayField, SchemaField } = foundry.data.fields;

export class ChecklistModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Checklist"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      items: new ArrayField(
        new SchemaField({
          id: new StringField({ required: true, blank: false }),
          text: new StringField(),
          done: new BooleanField({ initial: false }),
          assignee: new StringField()
        })
      )
    };
  }
}
```

- [ ] **Step 2: Sheet `scripts/sheets/checklist-sheet.mjs`**

```js
import { BaseRecordSheet } from "./base-record-sheet.mjs";

export class ChecklistSheet extends BaseRecordSheet {
  static DEFAULT_OPTIONS = {
    actions: {
      addItem: ChecklistSheet.#onAddItem,
      deleteItem: ChecklistSheet.#onDeleteItem,
      toggleItem: ChecklistSheet.#onToggleItem
    }
  };

  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/checklist/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/checklist/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.userOptions = Object.fromEntries(game.users.map((u) => [u.id, u.name]));
    context.items = this.document.system.items.map((item) => ({
      ...item,
      assigneeName: item.assignee ? (game.users.get(item.assignee)?.name ?? "") : ""
    }));
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.bindRowInputs("items");
  }

  static async #onAddItem() {
    await this.updateRows("items", (rows) =>
      rows.push({ id: foundry.utils.randomID(), text: "", done: false, assignee: "" })
    );
  }

  static async #onDeleteItem(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("items", (rows) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    });
  }

  static async #onToggleItem(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("items", (rows) => {
      const r = rows.find((x) => x.id === id);
      if (r) r.done = !r.done;
    });
  }
}
```

- [ ] **Step 3: Templates**

`templates/checklist/edit.hbs`:

```hbs
<section class="campaign-record-content record-edit">
<fieldset class="checklist-items">
  <legend>{{localize "CAMPAIGNRECORD.Checklist.FIELDS.items.label"}}</legend>
  <ol data-rows="items">
    {{#each items}}
    <li data-row-id="{{this.id}}">
      <input type="checkbox" data-action="toggleItem" {{#if this.done}}checked{{/if}}>
      <input type="text" data-row-field="text" value="{{this.text}}">
      <select data-row-field="assignee">
        <option value=""></option>
        {{selectOptions @root.userOptions selected=this.assignee}}
      </select>
      <button type="button" data-action="deleteItem"
              aria-label="{{localize "CAMPAIGNRECORD.DeleteRow"}}"><i class="fa-solid fa-trash"></i></button>
    </li>
    {{/each}}
  </ol>
  <button type="button" data-action="addItem">
    <i class="fa-solid fa-plus"></i> {{localize "CAMPAIGNRECORD.Checklist.AddItem"}}
  </button>
</fieldset>
{{> campaign-record.common-edit}}
</section>
```

`templates/checklist/view.hbs`:

```hbs
<section class="campaign-record-content record-view">
<section class="checklist-items">
  <ol data-rows="items">
    {{#each items}}
    <li data-row-id="{{this.id}}">
      <input type="checkbox" data-action="toggleItem" {{#if this.done}}checked{{/if}}>
      <span class="{{#if this.done}}done{{/if}}">{{this.text}}</span>
      {{#if this.assigneeName}}<span class="assignee">{{this.assigneeName}}</span>{{/if}}
    </li>
    {{/each}}
  </ol>
</section>
{{> campaign-record.common-view}}
</section>
```

- [ ] **Step 4: Registration + lang + subtitle**

- `RECORD_TYPES`: append `"checklist"`.
- Data/sheet registration + `module.json` `"checklist": {}` as in prior tasks; sheet label `CAMPAIGNRECORD.Sheets.Checklist`.
- `lang/en.json`: `TYPES.JournalEntryPage["campaign-record.checklist"]: "Checklist"`; `Sheets.Checklist: "Campaign Record Checklist Sheet"`; section:

```json
    "Checklist": {
      "AddItem": "Add Item",
      "Progress": "{done}/{total} done",
      "FIELDS": {
        "items": { "label": "Items" }
      }
    },
```

- `recordSubtitle` case:

```js
    case `${TYPE_PREFIX}checklist`: {
      const items = s.items ?? [];
      return game.i18n.format("CAMPAIGNRECORD.Checklist.Progress", {
        done: items.filter((i) => i.done).length,
        total: items.length
      });
    }
```

- [ ] **Step 5: E2E spec `tests/e2e/11-checklist.spec.mjs`** (both clients, per spec)

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("checklist", () => {
  let gmPage, ids;

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    ids = await createGroupWithPage(gmPage, "E2E Checklist Group", "E2E Checklist", "campaign-record.checklist");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(gmPage, "E2E Checklist");
    await gmPage.close();
  });

  const items = () =>
    gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.toObject().items,
      { groupId: ids.groupId, pageId: ids.pageId }
    );

  test("GM adds items, edits text, assigns a user, toggles done", async () => {
    await gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = gmPage.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[data-action="addItem"]').waitFor({ timeout: 15_000 });
    await sheet.locator('[data-action="addItem"]').click();
    await expect.poll(async () => (await items()).length).toBe(1);

    const text = sheet.locator('[data-rows="items"] [data-row-field="text"]').first();
    await text.fill("Buy rations");
    await text.dispatchEvent("change");
    await expect.poll(async () => (await items())[0].text).toBe("Buy rations");

    const userId = await gmPage.evaluate(() => game.users.getName("User 1").id);
    const assignee = sheet.locator('[data-rows="items"] [data-row-field="assignee"]').first();
    await assignee.selectOption(userId);
    await assignee.dispatchEvent("change");
    await expect.poll(async () => (await items())[0].assignee).toBe(userId);

    await sheet.locator('[data-action="toggleItem"]').first().click();
    await expect.poll(async () => (await items())[0].done).toBe(true);
    await gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.close(),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
  });

  test("player toggles an item from view mode; GM sees the change", async ({ browser }) => {
    const ctx = await browser.newContext();
    const playerPage = await ctx.newPage();
    await login(playerPage, "User 1");
    await playerPage.evaluate(
      async ({ groupId, pageId }) => {
        const g = game.journal.get(groupId);
        await g.sheet.render(true);
        await g.sheet.goToPage(pageId);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const view = playerPage.locator(".journal-entry-page .checklist-items");
    await view.waitFor({ timeout: 15_000 });
    await expect(view).toContainText("Buy rations");
    await view.locator('[data-action="toggleItem"]').first().click();
    await expect.poll(async () => (await items())[0].done).toBe(false); // GM toggled it true earlier
    await ctx.close();
  });
});
```

- [ ] **Step 6: Restart server, run gates**

```bash
lsof -ti :30000 | xargs kill; sleep 2
npx playwright test tests/e2e/11-checklist.spec.mjs
npx playwright test
npm test
```

Expected: new spec 2 passed; full suites green.

- [ ] **Step 7: Commit**

```bash
git add scripts/data/checklist.mjs scripts/sheets/checklist-sheet.mjs templates/checklist scripts/constants.mjs scripts/data/registration.mjs scripts/sheets/registration.mjs module.json lang/en.json scripts/apps/hub/hub-data.mjs tests/e2e/11-checklist.spec.mjs
git commit -m "feat: Checklist record type with assignees and both-client toggling"
```

---

### Task 7: Shop record type

Structured fields plus an inventory row list (name/price/quantity/linked Item) with Item-drop-to-add. Spec-mandated e2e: inventory row add/edit/delete.

**Files:**
- Create: `scripts/data/shop.mjs`, `scripts/sheets/shop-sheet.mjs`, `templates/shop/edit.hbs`, `templates/shop/view.hbs`
- Modify: `scripts/constants.mjs`, `scripts/data/registration.mjs`, `scripts/sheets/registration.mjs`, `module.json`, `lang/en.json`, `scripts/apps/hub/hub-data.mjs`
- Test: `tests/e2e/12-shop.spec.mjs`

**Interfaces:**
- Consumes: `updateRows`/`bindRowInputs`.
- Produces: page type `campaign-record.shop` — fields `shopType`, `location`, `owner`, `inventory: [{id, name, price, quantity, item}]`. `price` is a free-text StringField (dnd5e auto-pricing lands in Phase 4).

- [ ] **Step 1: Model `scripts/data/shop.mjs`**

```js
import { BaseRecordModel } from "./base-record.mjs";

const { StringField, NumberField, ArrayField, SchemaField, DocumentUUIDField } =
  foundry.data.fields;

export class ShopModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Shop"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      shopType: new StringField(),
      location: new StringField(),
      owner: new StringField(),
      inventory: new ArrayField(
        new SchemaField({
          id: new StringField({ required: true, blank: false }),
          name: new StringField(),
          price: new StringField(),
          quantity: new NumberField({ required: true, integer: true, min: 0, initial: 1 }),
          item: new DocumentUUIDField({ type: "Item" })
        })
      )
    };
  }
}
```

- [ ] **Step 2: Sheet `scripts/sheets/shop-sheet.mjs`**

```js
import { BaseRecordSheet } from "./base-record-sheet.mjs";

export class ShopSheet extends BaseRecordSheet {
  static DEFAULT_OPTIONS = {
    actions: {
      addInventoryRow: ShopSheet.#onAddInventoryRow,
      deleteInventoryRow: ShopSheet.#onDeleteInventoryRow
    }
  };

  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/shop/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/shop/view.hbs" }
  };

  _onRender(context, options) {
    super._onRender(context, options);
    this.bindRowInputs("inventory");
  }

  static async #onAddInventoryRow() {
    await this.updateRows("inventory", (rows) =>
      rows.push({ id: foundry.utils.randomID(), name: "", price: "", quantity: 1, item: null })
    );
  }

  static async #onDeleteInventoryRow(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("inventory", (rows) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    });
  }

  async _onDropDocument(data) {
    if (data.type !== "Item") return;
    const item = await fromUuid(data.uuid);
    await this.updateRows("inventory", (rows) =>
      rows.push({ id: foundry.utils.randomID(), name: item?.name ?? "", price: "", quantity: 1, item: data.uuid })
    );
  }
}
```

- [ ] **Step 3: Templates**

`templates/shop/edit.hbs`:

```hbs
<section class="campaign-record-content record-edit">
<div class="form-fields-grid">
  {{formGroup systemFields.shopType value=system.shopType localize=true}}
  {{formGroup systemFields.location value=system.location localize=true}}
  {{formGroup systemFields.owner value=system.owner localize=true}}
</div>
<fieldset class="shop-inventory campaign-record-drop">
  <legend>{{localize "CAMPAIGNRECORD.Shop.FIELDS.inventory.label"}}</legend>
  <ol data-rows="inventory">
    {{#each system.inventory}}
    <li data-row-id="{{this.id}}">
      <input type="text" data-row-field="name" value="{{this.name}}">
      <input type="text" data-row-field="price" value="{{this.price}}"
             placeholder="{{localize "CAMPAIGNRECORD.Shop.PricePlaceholder"}}">
      <input type="number" data-row-field="quantity" value="{{this.quantity}}" min="0" step="1">
      <button type="button" data-action="deleteInventoryRow"
              aria-label="{{localize "CAMPAIGNRECORD.DeleteRow"}}"><i class="fa-solid fa-trash"></i></button>
    </li>
    {{/each}}
  </ol>
  <button type="button" data-action="addInventoryRow">
    <i class="fa-solid fa-plus"></i> {{localize "CAMPAIGNRECORD.Shop.AddInventoryRow"}}
  </button>
  <p class="hint">{{localize "CAMPAIGNRECORD.DropItemHint"}}</p>
</fieldset>
{{> campaign-record.common-edit}}
</section>
```

`templates/shop/view.hbs`:

```hbs
<section class="campaign-record-content record-view">
<dl class="record-facts">
  {{#if system.shopType}}<dt>{{localize "CAMPAIGNRECORD.Shop.FIELDS.shopType.label"}}</dt><dd>{{system.shopType}}</dd>{{/if}}
  {{#if system.location}}<dt>{{localize "CAMPAIGNRECORD.Shop.FIELDS.location.label"}}</dt><dd>{{system.location}}</dd>{{/if}}
  {{#if system.owner}}<dt>{{localize "CAMPAIGNRECORD.Shop.FIELDS.owner.label"}}</dt><dd>{{system.owner}}</dd>{{/if}}
</dl>
{{#if system.inventory.length}}
<table class="shop-inventory">
  <thead><tr>
    <th>{{localize "CAMPAIGNRECORD.Shop.ColName"}}</th>
    <th>{{localize "CAMPAIGNRECORD.Shop.ColPrice"}}</th>
    <th>{{localize "CAMPAIGNRECORD.Shop.ColQuantity"}}</th>
  </tr></thead>
  <tbody>
    {{#each system.inventory}}
    <tr><td>{{this.name}}</td><td>{{this.price}}</td><td>{{this.quantity}}</td></tr>
    {{/each}}
  </tbody>
</table>
{{/if}}
{{> campaign-record.common-view}}
</section>
```

- [ ] **Step 4: Registration + lang + subtitle**

- `RECORD_TYPES`: append `"shop"`; registrations + `module.json` `"shop": {}`; sheet label `CAMPAIGNRECORD.Sheets.Shop: "Campaign Record Shop Sheet"`.
- `lang/en.json`: `TYPES.JournalEntryPage["campaign-record.shop"]: "Shop"`; section:

```json
    "Shop": {
      "AddInventoryRow": "Add Item",
      "PricePlaceholder": "e.g. 15 gp",
      "ColName": "Item",
      "ColPrice": "Price",
      "ColQuantity": "Qty",
      "FIELDS": {
        "shopType": { "label": "Shop Type" },
        "location": { "label": "Location" },
        "owner": { "label": "Owner" },
        "inventory": { "label": "Inventory" }
      }
    },
```

- `recordSubtitle` case:

```js
    case `${TYPE_PREFIX}shop`:
      return [s.shopType, s.location].filter(Boolean).join(" — ");
```

- [ ] **Step 5: E2E spec `tests/e2e/12-shop.spec.mjs`**

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("shop inventory", () => {
  let page, ids;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
    ids = await createGroupWithPage(page, "E2E Shop Group", "E2E Shop", "campaign-record.shop");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(page, "E2E Shop");
    await page.close();
  });

  const inventory = () =>
    page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.toObject().inventory,
      { groupId: ids.groupId, pageId: ids.pageId }
    );

  test("inventory rows: add, edit name/price/quantity, delete", async () => {
    await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = page.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[data-action="addInventoryRow"]').waitFor({ timeout: 15_000 });

    // add
    await sheet.locator('[data-action="addInventoryRow"]').click();
    await expect.poll(async () => (await inventory()).length).toBe(1);

    // edit
    const row = sheet.locator('[data-rows="inventory"] [data-row-id]').first();
    await row.locator('[data-row-field="name"]').fill("Longsword");
    await row.locator('[data-row-field="name"]').dispatchEvent("change");
    await row.locator('[data-row-field="price"]').fill("15 gp");
    await row.locator('[data-row-field="price"]').dispatchEvent("change");
    await row.locator('[data-row-field="quantity"]').fill("3");
    await row.locator('[data-row-field="quantity"]').dispatchEvent("change");
    await expect
      .poll(async () => (await inventory())[0])
      .toMatchObject({ name: "Longsword", price: "15 gp", quantity: 3 });

    // second row, then delete it
    await sheet.locator('[data-action="addInventoryRow"]').click();
    await expect.poll(async () => (await inventory()).length).toBe(2);
    await sheet.locator('[data-action="deleteInventoryRow"]').last().click();
    await expect.poll(async () => (await inventory()).length).toBe(1);
    expect((await inventory())[0].name).toBe("Longsword");
  });

  test("view mode renders the inventory table", async () => {
    await page.evaluate(
      async ({ groupId, pageId }) => {
        const g = game.journal.get(groupId);
        await g.pages.get(pageId).sheet.close();
        await g.sheet.render(true);
        await g.sheet.goToPage(pageId);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const table = page.locator(".journal-entry-page table.shop-inventory");
    await table.waitFor({ timeout: 15_000 });
    await expect(table).toContainText("Longsword");
    await expect(table).toContainText("15 gp");
    await page.evaluate(({ groupId }) => game.journal.get(groupId).sheet.close(), ids);
  });
});
```

- [ ] **Step 6: Restart server, run gates**

```bash
lsof -ti :30000 | xargs kill; sleep 2
npx playwright test tests/e2e/12-shop.spec.mjs
npx playwright test
npm test
```

Expected: new spec 2 passed; full suites green.

- [ ] **Step 7: Commit**

```bash
git add scripts/data/shop.mjs scripts/sheets/shop-sheet.mjs templates/shop scripts/constants.mjs scripts/data/registration.mjs scripts/sheets/registration.mjs module.json lang/en.json scripts/apps/hub/hub-data.mjs tests/e2e/12-shop.spec.mjs
git commit -m "feat: Shop record type with inventory rows"
```

---

### Task 8: Loot record type

Currency denominations, item rows, optional source-Encounter link, and rich-text distribution notes.

**Files:**
- Create: `scripts/data/loot.mjs`, `scripts/sheets/loot-sheet.mjs`, `templates/loot/edit.hbs`, `templates/loot/view.hbs`
- Modify: `scripts/constants.mjs`, `scripts/data/registration.mjs`, `scripts/sheets/registration.mjs`, `module.json`, `lang/en.json`, `scripts/apps/hub/hub-data.mjs`
- Test: `tests/e2e/13-loot.spec.mjs`

**Interfaces:**
- Consumes: `updateRows`/`bindRowInputs`; `typeId("encounter")` for source-link validation.
- Produces: page type `campaign-record.loot` — fields `currency: {cp,sp,ep,gp,pp}` (integers ≥ 0), `items: [{id, name, quantity, item}]`, `source` (JournalEntryPage UUID), `distribution` (HTML).

- [ ] **Step 1: Model `scripts/data/loot.mjs`**

```js
import { BaseRecordModel } from "./base-record.mjs";

const { StringField, NumberField, HTMLField, ArrayField, SchemaField, DocumentUUIDField } =
  foundry.data.fields;

const coin = () => new NumberField({ required: true, integer: true, min: 0, initial: 0 });

export class LootModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Loot"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      currency: new SchemaField({ cp: coin(), sp: coin(), ep: coin(), gp: coin(), pp: coin() }),
      items: new ArrayField(
        new SchemaField({
          id: new StringField({ required: true, blank: false }),
          name: new StringField(),
          quantity: new NumberField({ required: true, integer: true, min: 0, initial: 1 }),
          item: new DocumentUUIDField({ type: "Item" })
        })
      ),
      source: new DocumentUUIDField({ type: "JournalEntryPage" }),
      distribution: new HTMLField()
    };
  }
}
```

- [ ] **Step 2: Sheet `scripts/sheets/loot-sheet.mjs`**

```js
import { BaseRecordSheet } from "./base-record-sheet.mjs";
import { typeId } from "../constants.mjs";

const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

export class LootSheet extends BaseRecordSheet {
  static DEFAULT_OPTIONS = {
    actions: {
      addLootItem: LootSheet.#onAddLootItem,
      deleteLootItem: LootSheet.#onDeleteLootItem
    }
  };

  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/loot/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/loot/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    context.enriched.distribution = await TextEditorImpl.enrichHTML(system.distribution, {
      relativeTo: this.document
    });
    context.enriched.sourceLink = system.source
      ? await TextEditorImpl.enrichHTML(`@UUID[${system.source}]`)
      : "";
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.bindRowInputs("items");
  }

  static async #onAddLootItem() {
    await this.updateRows("items", (rows) =>
      rows.push({ id: foundry.utils.randomID(), name: "", quantity: 1, item: null })
    );
  }

  static async #onDeleteLootItem(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("items", (rows) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    });
  }

  async _onDropDocument(data) {
    if (data.type === "Item") {
      const item = await fromUuid(data.uuid);
      return this.updateRows("items", (rows) =>
        rows.push({ id: foundry.utils.randomID(), name: item?.name ?? "", quantity: 1, item: data.uuid })
      );
    }
    if (data.type === "JournalEntryPage") {
      const pageDoc = await fromUuid(data.uuid);
      if (pageDoc?.type === typeId("encounter")) {
        return this.document.update({ "system.source": data.uuid });
      }
    }
  }
}
```

- [ ] **Step 3: Templates**

`templates/loot/edit.hbs`:

```hbs
<section class="campaign-record-content record-edit">
<fieldset class="loot-currency">
  <legend>{{localize "CAMPAIGNRECORD.Loot.FIELDS.currency.label"}}</legend>
  <div class="form-fields-grid">
    {{formGroup systemFields.currency.fields.pp value=system.currency.pp localize=true}}
    {{formGroup systemFields.currency.fields.gp value=system.currency.gp localize=true}}
    {{formGroup systemFields.currency.fields.ep value=system.currency.ep localize=true}}
    {{formGroup systemFields.currency.fields.sp value=system.currency.sp localize=true}}
    {{formGroup systemFields.currency.fields.cp value=system.currency.cp localize=true}}
  </div>
</fieldset>
<fieldset class="loot-items campaign-record-drop">
  <legend>{{localize "CAMPAIGNRECORD.Loot.FIELDS.items.label"}}</legend>
  <ol data-rows="items">
    {{#each system.items}}
    <li data-row-id="{{this.id}}">
      <input type="text" data-row-field="name" value="{{this.name}}">
      <input type="number" data-row-field="quantity" value="{{this.quantity}}" min="0" step="1">
      <button type="button" data-action="deleteLootItem"
              aria-label="{{localize "CAMPAIGNRECORD.DeleteRow"}}"><i class="fa-solid fa-trash"></i></button>
    </li>
    {{/each}}
  </ol>
  <button type="button" data-action="addLootItem">
    <i class="fa-solid fa-plus"></i> {{localize "CAMPAIGNRECORD.Loot.AddItem"}}
  </button>
  <p class="hint">{{localize "CAMPAIGNRECORD.DropItemHint"}}</p>
</fieldset>
<div class="form-group">
  <label>{{localize "CAMPAIGNRECORD.Loot.FIELDS.source.label"}}</label>
  {{#if enriched.sourceLink}}{{{enriched.sourceLink}}}{{else}}
    <span class="hint">{{localize "CAMPAIGNRECORD.Loot.DropEncounterHint"}}</span>
  {{/if}}
</div>
<div class="form-group stacked">
  <label>{{localize "CAMPAIGNRECORD.Loot.FIELDS.distribution.label"}}</label>
  <prose-mirror name="system.distribution" toggled collaborate data-document-uuid="{{page.uuid}}">{{{enriched.distribution}}}</prose-mirror>
</div>
{{> campaign-record.common-edit}}
</section>
```

`templates/loot/view.hbs`:

```hbs
<section class="campaign-record-content record-view">
<dl class="record-facts loot-currency">
  {{#if system.currency.pp}}<dt>{{localize "CAMPAIGNRECORD.Loot.FIELDS.currency.pp.label"}}</dt><dd>{{system.currency.pp}}</dd>{{/if}}
  {{#if system.currency.gp}}<dt>{{localize "CAMPAIGNRECORD.Loot.FIELDS.currency.gp.label"}}</dt><dd>{{system.currency.gp}}</dd>{{/if}}
  {{#if system.currency.ep}}<dt>{{localize "CAMPAIGNRECORD.Loot.FIELDS.currency.ep.label"}}</dt><dd>{{system.currency.ep}}</dd>{{/if}}
  {{#if system.currency.sp}}<dt>{{localize "CAMPAIGNRECORD.Loot.FIELDS.currency.sp.label"}}</dt><dd>{{system.currency.sp}}</dd>{{/if}}
  {{#if system.currency.cp}}<dt>{{localize "CAMPAIGNRECORD.Loot.FIELDS.currency.cp.label"}}</dt><dd>{{system.currency.cp}}</dd>{{/if}}
  {{#if enriched.sourceLink}}<dt>{{localize "CAMPAIGNRECORD.Loot.FIELDS.source.label"}}</dt><dd>{{{enriched.sourceLink}}}</dd>{{/if}}
</dl>
{{#if system.items.length}}
<section class="loot-items">
  <h3>{{localize "CAMPAIGNRECORD.Loot.FIELDS.items.label"}}</h3>
  <ul>
    {{#each system.items}}
    <li>{{this.quantity}} × {{this.name}}</li>
    {{/each}}
  </ul>
</section>
{{/if}}
{{#if enriched.distribution}}
<section class="loot-distribution">
  <h3>{{localize "CAMPAIGNRECORD.Loot.FIELDS.distribution.label"}}</h3>
  {{{enriched.distribution}}}
</section>
{{/if}}
{{> campaign-record.common-view}}
</section>
```

- [ ] **Step 4: Registration + lang + subtitle**

- `RECORD_TYPES`: append `"loot"`; registrations + `module.json` `"loot": {}`; sheet label `CAMPAIGNRECORD.Sheets.Loot: "Campaign Record Loot Sheet"`.
- `lang/en.json`: `TYPES.JournalEntryPage["campaign-record.loot"]: "Loot"`; section:

```json
    "Loot": {
      "AddItem": "Add Item",
      "ItemCount": "{count} items",
      "DropEncounterHint": "Drop an Encounter record here to link it.",
      "FIELDS": {
        "currency": {
          "label": "Currency",
          "cp": { "label": "CP" },
          "sp": { "label": "SP" },
          "ep": { "label": "EP" },
          "gp": { "label": "GP" },
          "pp": { "label": "PP" }
        },
        "items": { "label": "Items" },
        "source": { "label": "Source Encounter" },
        "distribution": { "label": "Distribution Notes" }
      }
    },
```

- `recordSubtitle` case:

```js
    case `${TYPE_PREFIX}loot`:
      return game.i18n.format("CAMPAIGNRECORD.Loot.ItemCount", { count: (s.items ?? []).length });
```

- [ ] **Step 5: E2E spec `tests/e2e/13-loot.spec.mjs`**

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("loot sheet", () => {
  let page, ids;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
    ids = await createGroupWithPage(page, "E2E Loot Group", "E2E Loot", "campaign-record.loot");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(page, "E2E Loot");
    await page.close();
  });

  const system = () =>
    page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.toObject(),
      { groupId: ids.groupId, pageId: ids.pageId }
    );

  test("currency persists; item rows add and edit; view renders", async () => {
    await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = page.locator(".campaign-record.record-sheet").last();
    const gp = sheet.locator('[name="system.currency.gp"]');
    await gp.waitFor({ timeout: 15_000 });
    await gp.fill("250");
    await gp.dispatchEvent("change");
    await expect.poll(async () => (await system()).currency.gp).toBe(250);

    await sheet.locator('[data-action="addLootItem"]').click();
    await expect.poll(async () => (await system()).items.length).toBe(1);
    const name = sheet.locator('[data-rows="items"] [data-row-field="name"]').first();
    await name.fill("Ruby");
    await name.dispatchEvent("change");
    const qty = sheet.locator('[data-rows="items"] [data-row-field="quantity"]').first();
    await qty.fill("2");
    await qty.dispatchEvent("change");
    await expect.poll(async () => (await system()).items[0]).toMatchObject({ name: "Ruby", quantity: 2 });

    await page.evaluate(
      async ({ groupId, pageId }) => {
        const g = game.journal.get(groupId);
        await g.pages.get(pageId).sheet.close();
        await g.sheet.render(true);
        await g.sheet.goToPage(pageId);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const view = page.locator(".journal-entry-page .campaign-record-content");
    await view.waitFor({ timeout: 15_000 });
    await expect(view).toContainText("250");
    await expect(view).toContainText("2 × Ruby");
    await page.evaluate(({ groupId }) => game.journal.get(groupId).sheet.close(), ids);
  });
});
```

- [ ] **Step 6: Restart server, run gates**

```bash
lsof -ti :30000 | xargs kill; sleep 2
npx playwright test tests/e2e/13-loot.spec.mjs
npx playwright test
npm test
```

Expected: new spec 1 passed; full suites green.

- [ ] **Step 7: Commit**

```bash
git add scripts/data/loot.mjs scripts/sheets/loot-sheet.mjs templates/loot scripts/constants.mjs scripts/data/registration.mjs scripts/sheets/registration.mjs module.json lang/en.json scripts/apps/hub/hub-data.mjs tests/e2e/13-loot.spec.mjs
git commit -m "feat: Loot record type with currency and item rows"
```

---

### Task 9: Media record type (sheet only)

Ordered image gallery with captions, add-via-FilePicker, delete, up/down reordering, and an auto-advance interval field. The fullscreen presenter and socket sync are Phase 4 — do NOT build any socket or overlay code.

**Files:**
- Create: `scripts/data/media.mjs`, `scripts/sheets/media-sheet.mjs`, `templates/media/edit.hbs`, `templates/media/view.hbs`
- Modify: `scripts/constants.mjs`, `scripts/data/registration.mjs`, `scripts/sheets/registration.mjs`, `module.json`, `lang/en.json`, `scripts/apps/hub/hub-data.mjs`
- Test: `tests/e2e/14-media.spec.mjs`

**Interfaces:**
- Consumes: `updateRows`/`bindRowInputs`.
- Produces: page type `campaign-record.media` — fields `images: [{id, src, caption}]` (ordered), `slideshowInterval` (integer seconds ≥ 0; 0 = manual advance). Phase 4's presenter reads both.

- [ ] **Step 1: Model `scripts/data/media.mjs`**

```js
import { BaseRecordModel } from "./base-record.mjs";

const { StringField, NumberField, FilePathField, ArrayField, SchemaField } = foundry.data.fields;

export class MediaModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Media"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      images: new ArrayField(
        new SchemaField({
          id: new StringField({ required: true, blank: false }),
          src: new FilePathField({ categories: ["IMAGE"] }),
          caption: new StringField()
        })
      ),
      slideshowInterval: new NumberField({ required: true, integer: true, min: 0, initial: 0 })
    };
  }
}
```

- [ ] **Step 2: Sheet `scripts/sheets/media-sheet.mjs`**

```js
import { BaseRecordSheet } from "./base-record-sheet.mjs";

export class MediaSheet extends BaseRecordSheet {
  static DEFAULT_OPTIONS = {
    actions: {
      addImage: MediaSheet.#onAddImage,
      deleteImage: MediaSheet.#onDeleteImage,
      moveImage: MediaSheet.#onMoveImage
    }
  };

  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/media/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/media/view.hbs" }
  };

  _onRender(context, options) {
    super._onRender(context, options);
    this.bindRowInputs("images");
  }

  static async #onAddImage() {
    const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
    const picker = new FilePickerImpl({
      type: "image",
      callback: (path) =>
        this.updateRows("images", (rows) =>
          rows.push({ id: foundry.utils.randomID(), src: path, caption: "" })
        )
    });
    picker.render(true);
  }

  static async #onDeleteImage(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("images", (rows) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    });
  }

  static async #onMoveImage(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    const dir = Number(target.dataset.dir);
    await this.updateRows("images", (rows) => {
      const i = rows.findIndex((r) => r.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= rows.length) return;
      [rows[i], rows[j]] = [rows[j], rows[i]];
    });
  }
}
```

- [ ] **Step 3: Templates**

`templates/media/edit.hbs`:

```hbs
<section class="campaign-record-content record-edit">
<fieldset class="media-images">
  <legend>{{localize "CAMPAIGNRECORD.Media.FIELDS.images.label"}}</legend>
  <ol data-rows="images">
    {{#each system.images}}
    <li data-row-id="{{this.id}}" class="media-image-row">
      <img src="{{this.src}}" alt="{{this.caption}}">
      <input type="text" data-row-field="caption" value="{{this.caption}}"
             placeholder="{{localize "CAMPAIGNRECORD.Media.CaptionPlaceholder"}}">
      <button type="button" data-action="moveImage" data-dir="-1"
              aria-label="{{localize "CAMPAIGNRECORD.Media.MoveUp"}}"><i class="fa-solid fa-arrow-up"></i></button>
      <button type="button" data-action="moveImage" data-dir="1"
              aria-label="{{localize "CAMPAIGNRECORD.Media.MoveDown"}}"><i class="fa-solid fa-arrow-down"></i></button>
      <button type="button" data-action="deleteImage"
              aria-label="{{localize "CAMPAIGNRECORD.DeleteRow"}}"><i class="fa-solid fa-trash"></i></button>
    </li>
    {{/each}}
  </ol>
  <button type="button" data-action="addImage">
    <i class="fa-solid fa-plus"></i> {{localize "CAMPAIGNRECORD.Media.AddImage"}}
  </button>
</fieldset>
{{formGroup systemFields.slideshowInterval value=system.slideshowInterval localize=true}}
{{> campaign-record.common-edit}}
</section>
```

`templates/media/view.hbs`:

```hbs
<section class="campaign-record-content record-view">
<div class="media-gallery">
  {{#each system.images}}
  <figure>
    <img src="{{this.src}}" alt="{{this.caption}}">
    {{#if this.caption}}<figcaption>{{this.caption}}</figcaption>{{/if}}
  </figure>
  {{/each}}
</div>
{{> campaign-record.common-view}}
</section>
```

- [ ] **Step 4: Registration + lang + subtitle**

- `RECORD_TYPES`: append `"media"` — final list: `["npc", "place", "quest", "pc", "item", "encounter", "checklist", "shop", "loot", "media"]`.
- Registrations + `module.json` `"media": {}`; sheet label `CAMPAIGNRECORD.Sheets.Media: "Campaign Record Media Sheet"`.
- `lang/en.json`: `TYPES.JournalEntryPage["campaign-record.media"]: "Media"`; section:

```json
    "Media": {
      "AddImage": "Add Image",
      "CaptionPlaceholder": "Caption…",
      "MoveUp": "Move up",
      "MoveDown": "Move down",
      "ImageCount": "{count} images",
      "FIELDS": {
        "images": { "label": "Images" },
        "slideshowInterval": { "label": "Auto-advance (seconds, 0 = manual)" }
      }
    },
```

- `recordSubtitle` case:

```js
    case `${TYPE_PREFIX}media`:
      return game.i18n.format("CAMPAIGNRECORD.Media.ImageCount", { count: (s.images ?? []).length });
```

- [ ] **Step 5: E2E spec `tests/e2e/14-media.spec.mjs`**

The FilePicker dialog can't be exercised headlessly; seed rows via the document API and test caption edit, reorder, delete, and the view gallery through the UI.

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("media sheet", () => {
  let page, ids;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
    ids = await createGroupWithPage(page, "E2E Media Group", "E2E Media", "campaign-record.media");
    await page.evaluate(
      async ({ groupId, pageId }) => {
        const p = game.journal.get(groupId).pages.get(pageId);
        await p.update({
          "system.images": [
            { id: foundry.utils.randomID(), src: "icons/svg/book.svg", caption: "First" },
            { id: foundry.utils.randomID(), src: "icons/svg/chest.svg", caption: "Second" }
          ]
        });
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(page, "E2E Media");
    await page.close();
  });

  const images = () =>
    page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.toObject().images,
      { groupId: ids.groupId, pageId: ids.pageId }
    );

  test("caption edit, reorder, and delete persist in order", async () => {
    await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = page.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[data-action="addImage"]').waitFor({ timeout: 15_000 });

    const caption = sheet.locator('[data-rows="images"] [data-row-field="caption"]').first();
    await caption.fill("Cover");
    await caption.dispatchEvent("change");
    await expect.poll(async () => (await images())[0].caption).toBe("Cover");

    // move the second image up
    await sheet.locator('[data-action="moveImage"][data-dir="-1"]').last().click();
    await expect.poll(async () => (await images()).map((i) => i.caption)).toEqual(["Second", "Cover"]);

    await sheet.locator('[data-action="deleteImage"]').first().click();
    await expect.poll(async () => (await images()).length).toBe(1);
    expect((await images())[0].caption).toBe("Cover");

    const interval = sheet.locator('[name="system.slideshowInterval"]');
    await interval.fill("10");
    await interval.dispatchEvent("change");
    await expect
      .poll(async () =>
        page.evaluate(
          ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.slideshowInterval,
          { groupId: ids.groupId, pageId: ids.pageId }
        )
      )
      .toBe(10);
  });

  test("view mode renders the gallery with captions", async () => {
    await page.evaluate(
      async ({ groupId, pageId }) => {
        const g = game.journal.get(groupId);
        await g.pages.get(pageId).sheet.close();
        await g.sheet.render(true);
        await g.sheet.goToPage(pageId);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const gallery = page.locator(".journal-entry-page .media-gallery");
    await gallery.waitFor({ timeout: 15_000 });
    await expect(gallery.locator("figure")).toHaveCount(1);
    await expect(gallery).toContainText("Cover");
    await page.evaluate(({ groupId }) => game.journal.get(groupId).sheet.close(), ids);
  });
});
```

- [ ] **Step 6: Restart server, run gates**

```bash
lsof -ti :30000 | xargs kill; sleep 2
npx playwright test tests/e2e/14-media.spec.mjs
npx playwright test
npm test
```

Expected: new spec 2 passed; full suites green.

- [ ] **Step 7: Commit**

```bash
git add scripts/data/media.mjs scripts/sheets/media-sheet.mjs templates/media scripts/constants.mjs scripts/data/registration.mjs scripts/sheets/registration.mjs module.json lang/en.json scripts/apps/hub/hub-data.mjs tests/e2e/14-media.spec.mjs
git commit -m "feat: Media record type with ordered gallery (sheet only)"
```

---

### Task 10: Hub coverage for all types, docs, and version bump

Verify the Hub end-to-end across the full type roster (chips, subtitles, list-field search), update the manual checklist, bump to 0.3.0.

**Files:**
- Create: `tests/e2e/15-hub-types.spec.mjs`
- Modify: `docs/manual-test-checklist.md`, `module.json` (version)

**Interfaces:**
- Consumes: everything shipped in Tasks 1–9; Hub type chips derive from `RECORD_TYPES` (10 entries) + the journal chip = 11 chips.

- [ ] **Step 1: E2E spec `tests/e2e/15-hub-types.spec.mjs`**

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("hub integration for phase 3 types", () => {
  let page, ids;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
    ids = await createGroupWithPage(page, "E2E HubTypes Group", "E2E HubTypes Shop", "campaign-record.shop");
    await page.evaluate(
      async ({ groupId, pageId }) => {
        const group = game.journal.get(groupId);
        await group.pages.get(pageId).update({
          "system.shopType": "Blacksmith",
          "system.inventory": [
            { id: foundry.utils.randomID(), name: "Vorpal Cheese", price: "999 gp", quantity: 1, item: null }
          ]
        });
        await group.createEmbeddedDocuments("JournalEntryPage", [
          { name: "E2E HubTypes PC", type: "campaign-record.pc",
            system: { playerName: "Dan", classLevel: "Rogue 3" } },
          { name: "E2E HubTypes Checklist", type: "campaign-record.checklist",
            system: { items: [
              { id: foundry.utils.randomID(), text: "Investigate the lighthouse", done: true, assignee: "" },
              { id: foundry.utils.randomID(), text: "Report back", done: false, assignee: "" }
            ] } }
        ]);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(page, "E2E HubTypes");
    await page.close();
  });

  const openHub = () =>
    page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const hub = CampaignHub.open();
      await hub.render(true);
    });

  test("index shows one chip per record type plus journal, and phase-3 subtitles", async () => {
    await openHub();
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    await expect(hub.locator(".type-chip")).toHaveCount(11);
    await expect(hub.locator(".record-list")).toContainText("Blacksmith");     // shop subtitle
    await expect(hub.locator(".record-list")).toContainText("Dan — Rogue 3");  // pc subtitle
    await expect(hub.locator(".record-list")).toContainText("1/2 done");       // checklist subtitle
  });

  test("search hits shop inventory and checklist item text", async () => {
    const hits = (q) =>
      page.evaluate(async (q) => {
        const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
        const hub = CampaignHub.open();
        hub.state.query = q;
        await hub.render(true);
        return hub.element.querySelector(".hub-search").textContent;
      }, q);
    expect(await hits("vorpal")).toContain("E2E HubTypes Shop");
    expect(await hits("lighthouse")).toContain("E2E HubTypes Checklist");
  });
});
```

(If `.hub-search` / `.record-list` / `.type-chip` selectors drifted, use the actual classes from `templates/hub/*.hbs`.)

- [ ] **Step 2: Run the spec**

```bash
npx playwright test tests/e2e/15-hub-types.spec.mjs
```

Expected: 2 passed.

- [ ] **Step 3: Update `docs/manual-test-checklist.md`**

In the automated section, add one line per new spec file (09–15) describing what it covers, following the existing cross-reference format. In the manual section, add:
- Add an image to a Media record through the real FilePicker dialog (dialog flow not automated).
- Drop an Actor from the sidebar onto an Encounter sheet and an Item onto a Shop sheet (real pointer drag; synthetic drops are automated).
- Subjective pass over the seven new sheets' layout/styling in both edit and view modes.

- [ ] **Step 4: Version bump**

`module.json`: `"version": "0.3.0"`.

- [ ] **Step 5: Full gates**

```bash
npm test
lsof -ti :30000 | xargs kill; sleep 2
npx playwright test
```

Expected: all unit tests green; all e2e specs (01–15) green.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/15-hub-types.spec.mjs docs/manual-test-checklist.md module.json
git commit -m "feat: hub e2e coverage for all record types; v0.3.0"
```

---

## Self-Review Notes

- **Spec coverage:** Phase 3 = "PC, Item, Encounter, Shop, Loot, Checklist, Media (sheet only)" → Tasks 4–9. Spec-mandated e2e: per-type render/persist/view (each type task), checklist toggling from both clients (Task 6), shop inventory add/edit/delete (Task 7). Media presenter/sockets explicitly excluded (Phase 4). Backlog fold-in → Tasks 1–2. The `styles/campaign-record.css` file may need small additions for new row/gallery layouts — implementers may add classes there freely; no structural CSS work is planned.
- **Deliberate scope choices:** Loot currency uses fixed cp/sp/ep/gp/pp integer denominations now (the spec's "degrade to plain number fields" is satisfied without Phase 4); Shop price is free text until the 5e layer; Media reordering uses up/down buttons (keyboard-accessible, no drag plumbing); the search focus-restore "redundancy" finding is adjudicated NOT redundant (partial renders replace the input) and is documented with a comment instead of removed.
- **Type consistency check:** `updateRows(field, mutate)` / `bindRowInputs(field)` defined in Task 3 and consumed with identical signatures in Tasks 5–9; row schema keys match each template's `data-row-field` attributes; `RECORD_TYPES` final order matches the chips assertion (10 + journal = 11) in Task 10.
