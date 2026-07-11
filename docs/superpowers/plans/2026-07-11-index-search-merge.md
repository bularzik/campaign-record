# Index/Search Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the Campaign Hub's full-content search into the Index tab and delete the standalone Search tab, so records are found in one place.

**Architecture:** The Hub is one ApplicationV2 window (`scripts/apps/hub/hub-mixin.mjs` shared by `CampaignHub` and `GroupHubSheet`) with tabs whose parts live in `templates/hub/*.hbs`. The existing in-memory search engine (`scripts/logic/search-index.mjs`) is unchanged; we route its results into the Index's record list instead of a separate Search tab. The Index's `#indexEntries()` becomes the single record-list source: with a 2+ char query it intersects the scoped list with engine hits (respecting group/type filters and GM visibility) and attaches per-field snippets; below 2 chars it behaves as today.

**Tech Stack:** Vanilla JS ES modules, Foundry VTT v13 ApplicationV2 + Handlebars parts, Vitest (unit), Playwright (e2e). No new dependencies.

## Global Constraints

- Foundry VTT compatibility: minimum v13 (`module.json`). Use only v13 APIs.
- No new runtime dependencies.
- Client preferences use `game.settings.register(MODULE_ID, <key>, { scope: "client", config: false, type: Boolean, default: … })`, mirroring `scripts/hooks/hub-ui.mjs`.
- All user-facing strings live in `lang/en.json` under `CAMPAIGNRECORD.*` and are referenced via `localize`/`game.i18n.localize`. Every referenced key must resolve (enforced by `tests/i18n-coverage.test.js`).
- Out of scope, do not touch: the tags data model / tag editor, and the group model (creation, picker, scoping, assignment).
- The search engine indexes across all groups (scope `"all"`); it must keep doing so — scoping happens by filtering hits against the visible record set, never by rebuilding the index.
- Event-handler binding pattern in `_onRender`: guard each element with a `dataset.crBound` flag so re-renders don't double-bind.
- Running Playwright e2e requires the shared Foundry install and session locking — follow the `foundry-e2e` skill contract before any e2e run/restart. Vitest (`npx vitest run`) is the fast gate and needs no Foundry.

---

## File map

- `scripts/constants.mjs` — add `SNIPPETS_SETTING` constant.
- `scripts/hooks/hub-ui.mjs` — register the snippets client setting.
- `scripts/apps/hub/hub-mixin.mjs` — unify `state.tag`→`state.query`; rewrite `#indexEntries()`; add `#otherGroupMatches()` and `#onToggleSnippets`; rewrite the Index input binding; remove `#searchResults()`, the `search` tab/part, `context.searchGroups`, the `filterType` action + `#onFilterType`, the old `search-query` binding; add the type multi-select binding; update `#onClearFilters` and `hasActiveFilters`; extend `_prepareContext`.
- `templates/hub/index.hbs` — replace type-chips with a `<multi-select>`; replace the tag-filter input with the unified search box + snippets checkbox; render per-row snippets; render the "other groups" hint.
- `templates/hub/header.hbs` — no change (tab nav is data-driven).
- `templates/hub/search.hbs` — deleted.
- `styles/campaign-record.css` — retarget the search-box/snippet CSS to the Index; style the multi-select and hint; drop dead `.type-chip`/`.search-hit`/`.result-type` rules.
- `lang/en.json` — remove `Tabs.search`; repurpose `FilterTag`; add `Snippets`, `OtherGroupMatches`, `TypeFilter` keys.
- Tests: `tests/e2e/07-hub-search.spec.mjs`, `tests/e2e/05-hub.spec.mjs`, `tests/e2e/06-hub-index.spec.mjs`, `tests/e2e/15-hub-types.spec.mjs`, `tests/i18n-coverage.test.js`.

---

## Task 1: Engine-backed Index filtering + unified search box

Unify `state.tag` into `state.query`, make `#indexEntries()` run the search engine for 2+ char queries, and replace the Index's tag-filter input with a single search box.

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs` (state line 82; `#indexEntries` 288-303; `#onClearFilters` 394-399; `hasActiveFilters` 625; Index input binding 680-694)
- Modify: `templates/hub/index.hbs` (controls 8-10)
- Modify: `lang/en.json` (`CAMPAIGNRECORD.Hub.FilterTag`)
- Test: `tests/e2e/06-hub-index.spec.mjs`

**Interfaces:**
- Consumes: `collectRecords({ groupId, user })` → records with `{ uuid, id, name, subtitle, shortType, groupName, image, hidden, canAttach, tags, sortTime }`; `search(index, query, { gm })` → `[{ uuid, name, type, matches: [{ field, snippet }] }]`; `this.#ensureSearchIndex()`.
- Produces: `#indexEntries()` → `{ records, total }` where each record may carry `matches: [{ field, snippet }]` when a 2+ char query is active; `state.query` (string) replaces `state.tag`.

- [ ] **Step 1: Write the failing test** — add to `tests/e2e/06-hub-index.spec.mjs` inside the top-level `describe`, after the existing tests (uses the file's existing `gmPage`/`hub`/group fixtures; if the describe exposes records, reuse them — otherwise this test drives state directly like `15-hub-types.spec.mjs`):

```javascript
test("index search box filters the record list by content", async () => {
  const count = (q) =>
    gmPage.evaluate(async (q) => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const hub = CampaignHub.open();
      hub.state.query = q;
      await hub.render(true);
      return hub.element.querySelectorAll(".record-list .record-row").length;
    }, q);
  const all = await count("");
  const filtered = await count("zzzznomatch");
  expect(all).toBeGreaterThan(0);
  expect(filtered).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/06-hub-index.spec.mjs -g "filters the record list by content"`
Expected: FAIL — `state.query` is not yet consulted by the index list, so `filtered` equals `all` (non-zero).

- [ ] **Step 3: Unify state — replace `tag` with `query`** in `scripts/apps/hub/hub-mixin.mjs:82`:

```javascript
    state = { groupId: "all", types: new Set(), hiddenOnly: false, sort: "name", query: "" };
```

- [ ] **Step 4: Rewrite `#indexEntries()`** (`scripts/apps/hub/hub-mixin.mjs:288-303`) to run the engine for 2+ char queries:

```javascript
    #indexEntries() {
      const all = collectRecords({ groupId: this.groupScopeId, user: game.user });
      let records = all;
      let matchesByUuid = null;
      const query = (this.state.query ?? "").trim();
      if (query.length >= 2) {
        const hits = search(this.#ensureSearchIndex(), query, { gm: game.user.isGM });
        matchesByUuid = new Map(hits.map((h) => [h.uuid, h.matches]));
        records = records.filter((r) => matchesByUuid.has(r.uuid));
      }
      if (this.state.types.size) records = records.filter((r) => this.state.types.has(r.shortType));
      if (this.state.hiddenOnly) records = records.filter((r) => r.hidden);
      const sorters = {
        name: (a, b) => a.name.localeCompare(b.name),
        type: (a, b) => a.shortType.localeCompare(b.shortType) || a.name.localeCompare(b.name),
        updated: (a, b) => b.sortTime - a.sortTime
      };
      const sorted = records.sort(sorters[this.state.sort] ?? sorters.name);
      const withMatches = matchesByUuid
        ? sorted.map((r) => ({ ...r, matches: matchesByUuid.get(r.uuid) ?? [] }))
        : sorted;
      return { records: withMatches, total: all.length };
    }
```

- [ ] **Step 5: Update `#onClearFilters`** (`scripts/apps/hub/hub-mixin.mjs:394-399`) — drop the `state.tag` reset (query is intentionally preserved so "clear filters" reveals other-group matches without discarding the search):

```javascript
    static #onClearFilters() {
      this.state.types.clear();
      this.state.hiddenOnly = false;
      this.render();
    }
```

- [ ] **Step 6: Update `hasActiveFilters`** (`scripts/apps/hub/hub-mixin.mjs:625`) — remove the `state.tag` term:

```javascript
      context.hasActiveFilters = this.state.types.size > 0 || this.state.hiddenOnly;
```

- [ ] **Step 7: Replace the Index input binding** (`scripts/apps/hub/hub-mixin.mjs:680-694`) — retarget from `tag-filter`/`state.tag` to `index-search`/`state.query`:

```javascript
      const indexSearch = this.element.querySelector('input[name="index-search"]');
      if (indexSearch && !indexSearch.dataset.crBound) {
        indexSearch.dataset.crBound = "1";
        indexSearch.addEventListener("input", foundry.utils.debounce(async (event) => {
          // A re-render (e.g. clear-filters) may have replaced this input while
          // the debounce was pending; its stale value must not win.
          if (!event.target.isConnected) return;
          this.state.query = event.target.value;
          await this.render({ parts: ["index"] });
          // render({parts}) replaces this part's DOM — restore focus to keep typing.
          const restored = this.element.querySelector('input[name="index-search"]');
          restored?.focus();
          restored?.setSelectionRange(restored.value.length, restored.value.length);
        }, 250));
      }
```

- [ ] **Step 8: Update the Index template** (`templates/hub/index.hbs:9-10`) — swap the tag-filter input for the unified search box:

```handlebars
    <input type="search" name="index-search" value="{{state.query}}"
           placeholder="{{localize "CAMPAIGNRECORD.Hub.FilterTag"}}" autocomplete="off">
```

- [ ] **Step 9: Repurpose the placeholder string** in `lang/en.json` — change `CAMPAIGNRECORD.Hub.FilterTag` from `"Filter by tag…"` to:

```json
    "FilterTag": "Search records…",
```

- [ ] **Step 10: Run the unit suite** (fast gate, no Foundry)

Run: `npx vitest run`
Expected: PASS (no unit test references `state.tag`).

- [ ] **Step 11: Run test to verify it passes**

Run: `npx playwright test tests/e2e/06-hub-index.spec.mjs -g "filters the record list by content"`
Expected: PASS — `filtered` is 0, `all` is non-zero.

- [ ] **Step 12: Commit**

```bash
git add scripts/apps/hub/hub-mixin.mjs templates/hub/index.hbs lang/en.json tests/e2e/06-hub-index.spec.mjs
git commit -m "feat: make the Hub Index search box filter by full content"
```

---

## Task 2: Snippet rendering + toggle

Add a client-setting-backed `☑ snippets` checkbox next to the search box; when on, content-matched rows expand to show per-field snippets.

**Files:**
- Modify: `scripts/constants.mjs` (after line 35)
- Modify: `scripts/hooks/hub-ui.mjs` (`registerHubSettings`, after the RAIL block ~47)
- Modify: `scripts/apps/hub/hub-mixin.mjs` (actions map ~45; add `#onToggleSnippets` near `#onToggleThumbnails` ~514; imports line 3; `_prepareContext` ~640)
- Modify: `templates/hub/index.hbs` (controls + record rows)
- Modify: `styles/campaign-record.css` (reuse `.hit-snippet`; add `.record-snippets`)
- Modify: `lang/en.json` (add `Snippets`)
- Test: `tests/e2e/06-hub-index.spec.mjs`

**Interfaces:**
- Consumes: `game.settings.get(MODULE_ID, SNIPPETS_SETTING)`; row `matches: [{ field, snippet }]` from Task 1.
- Produces: `SNIPPETS_SETTING` constant (`"hubSnippets"`); `context.snippets` (boolean); `data-action="toggleSnippets"`.

- [ ] **Step 1: Write the failing test** — add to `tests/e2e/06-hub-index.spec.mjs`:

```javascript
test("snippets toggle reveals where a content match occurred", async () => {
  const hub = gmPage.locator("#campaign-hub");
  await gmPage.evaluate(async () => {
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    const h = CampaignHub.open();
    await game.settings.set("campaign-record", "hubSnippets", false);
    h.state.query = "";
    await h.render(true);
  });
  // Pick any record and give it a distinctive body word, then search it.
  await gmPage.evaluate(async () => {
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    const h = CampaignHub.open();
    h.state.query = "qwertyx"; // set by the test's fixture below
    await h.render(true);
  });
  // Off: no snippet element rendered.
  await expect(hub.locator(".record-snippets")).toHaveCount(0);
  await gmPage.evaluate(async () => {
    await game.settings.set("campaign-record", "hubSnippets", true);
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    await CampaignHub.open().render(true);
  });
  // On: snippet element appears for the matched row.
  await expect(hub.locator(".record-snippets .hit-snippet").first()).toBeVisible({ timeout: 10_000 });
});
```

> Implementer note: give a fixture record a body field containing `qwertyx` in this file's `beforeAll` (e.g. update an existing record's `system.description` to include the word), mirroring how `07-hub-search.spec.mjs` seeds `system.role`. Match the query word to the seeded word.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/06-hub-index.spec.mjs -g "snippets toggle"`
Expected: FAIL — no `.record-snippets` element exists and no `hubSnippets` setting is registered.

- [ ] **Step 3: Add the setting constant** to `scripts/constants.mjs` after line 35:

```javascript
/** Client setting: expand Index rows with search-match snippets. */
export const SNIPPETS_SETTING = "hubSnippets";
```

- [ ] **Step 4: Register the setting** in `scripts/hooks/hub-ui.mjs` — import it and add a registration block. Update the import on line 1:

```javascript
import { MODULE_ID, THUMBNAILS_SETTING, RAIL_SETTING, INLINE_EDIT_SETTING, SNIPPETS_SETTING } from "../constants.mjs";
```

Add inside `registerHubSettings()` after the RAIL_SETTING block (~line 47):

```javascript
  game.settings.register(MODULE_ID, SNIPPETS_SETTING, {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });
```

- [ ] **Step 5: Import the constant in the mixin** — extend `scripts/apps/hub/hub-mixin.mjs:3`:

```javascript
  MODULE_ID, THUMBNAILS_SETTING, RAIL_SETTING, INLINE_EDIT_SETTING, SNIPPETS_SETTING, RECORD_TYPES, typeId
```

- [ ] **Step 6: Register the action** in the `actions` object (`scripts/apps/hub/hub-mixin.mjs`, near line 45, alongside `clearFilters`):

```javascript
        toggleSnippets: HubBase.#onToggleSnippets,
```

- [ ] **Step 7: Add the handler** next to `#onToggleThumbnails` (`scripts/apps/hub/hub-mixin.mjs` ~514):

```javascript
    static async #onToggleSnippets() {
      const current = game.settings.get(MODULE_ID, SNIPPETS_SETTING);
      await game.settings.set(MODULE_ID, SNIPPETS_SETTING, !current);
      await this.render({ parts: ["index"] });
    }
```

- [ ] **Step 8: Expose the flag to the template** — in `_prepareContext` after the `inlineEditing` line (`scripts/apps/hub/hub-mixin.mjs:641`):

```javascript
      context.snippets = game.settings.get(MODULE_ID, SNIPPETS_SETTING);
```

- [ ] **Step 9: Add the checkbox to the Index controls** — in `templates/hub/index.hbs`, immediately after the `index-search` input:

```handlebars
    <label class="snippets-toggle">
      <input type="checkbox" name="snippets-toggle" data-action="toggleSnippets"
             {{#if snippets}}checked{{/if}}>
      {{localize "CAMPAIGNRECORD.Hub.Snippets"}}
    </label>
```

- [ ] **Step 10: Render per-row snippets** — in `templates/hub/index.hbs`, inside the record-row `<li>`, after the `record-group` span and before `</li>`:

```handlebars
      {{#if @root.snippets}}{{#if this.matches.length}}
      <div class="record-snippets">
        {{#each this.matches}}
        <span class="hit-snippet"><strong>{{this.field}}:</strong> {{this.snippet}}</span>
        {{/each}}
      </div>
      {{/if}}{{/if}}
```

- [ ] **Step 11: Add the snippet string** to `lang/en.json` under `CAMPAIGNRECORD.Hub` (after `FilterTag`):

```json
    "Snippets": "Snippets",
```

- [ ] **Step 12: Style the snippet row** — in `styles/campaign-record.css`, after the `.record-row` grid rules (~line 131) add a full-width snippet row (the `.hit-snippet` rule at ~176 is reused as-is):

```css
.campaign-hub .record-row .record-snippets {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding-left: 2.5rem;
}
```

- [ ] **Step 13: Run the unit suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 14: Run test to verify it passes**

Run: `npx playwright test tests/e2e/06-hub-index.spec.mjs -g "snippets toggle"`
Expected: PASS — `.record-snippets` absent when off, `.hit-snippet` visible when on.

- [ ] **Step 15: Commit**

```bash
git add scripts/constants.mjs scripts/hooks/hub-ui.mjs scripts/apps/hub/hub-mixin.mjs templates/hub/index.hbs styles/campaign-record.css lang/en.json tests/e2e/06-hub-index.spec.mjs
git commit -m "feat: add snippets toggle to the Hub Index search"
```

---

## Task 3: "Matches in other groups" hint

When filters (type/group/hidden) hide records that the current query matches, show an actionable line that clears filters.

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs` (add `#otherGroupMatches`; `#onClearFilters`; `hasActiveFilters`; `_prepareContext`)
- Modify: `templates/hub/index.hbs` (hint markup)
- Modify: `styles/campaign-record.css` (hint style)
- Modify: `lang/en.json` (`OtherGroupMatches`)
- Test: `tests/e2e/06-hub-index.spec.mjs`

**Interfaces:**
- Consumes: `collectRecords`, `search`, `this.#ensureSearchIndex()`, `this.showsGroupPicker`, `this.groupScopeId`, `this.state`.
- Produces: `context.otherGroupMatches` (number ≥ 0). The hint element carries `data-action="clearFilters"`.

- [ ] **Step 1: Write the failing test** — add to `tests/e2e/06-hub-index.spec.mjs`:

```javascript
test("shows a hint when a type filter hides matching records", async () => {
  const count = await gmPage.evaluate(async () => {
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    const hub = CampaignHub.open();
    hub.state.query = "e2e";            // matches multiple seeded records across types
    hub.state.types = new Set(["quest"]); // filter to a type most matches are NOT
    await hub.render(true);
    return hub.element.querySelectorAll(".other-group-matches").length;
  });
  expect(count).toBe(1);
});
```

> Implementer note: this file's fixtures create records whose names start with `E2E`; the engine indexes names, so `"e2e"` matches several. If the fixture set is all one type, seed one extra record of a different type in `beforeAll`. Adjust the filtered type so at least one match is excluded.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/06-hub-index.spec.mjs -g "hint when a type filter hides"`
Expected: FAIL — no `.other-group-matches` element exists.

- [ ] **Step 3: Add `#otherGroupMatches()`** to `scripts/apps/hub/hub-mixin.mjs` (place it just after `#indexEntries()`):

```javascript
    /** Count query matches hidden by the current clearable filters, 0 when none. */
    #otherGroupMatches(shownRecords) {
      const query = (this.state.query ?? "").trim();
      if (query.length < 2) return 0;
      const scopingClearable = this.showsGroupPicker && this.state.groupId !== "all";
      const filtersActive = this.state.types.size > 0 || this.state.hiddenOnly || scopingClearable;
      if (!filtersActive) return 0;
      // Records visible once clearable filters are reset: unscoped for the
      // standalone hub, still this group for a locked single-group sheet.
      const clearedScope = this.showsGroupPicker ? "all" : this.groupScopeId;
      const visibleCleared = new Set(
        collectRecords({ groupId: clearedScope, user: game.user }).map((r) => r.uuid)
      );
      const shown = new Set(shownRecords.map((r) => r.uuid));
      const hits = search(this.#ensureSearchIndex(), query, { gm: game.user.isGM });
      let count = 0;
      for (const h of hits) if (visibleCleared.has(h.uuid) && !shown.has(h.uuid)) count++;
      return count;
    }
```

- [ ] **Step 4: Reset group scope in `#onClearFilters`** (`scripts/apps/hub/hub-mixin.mjs`) so the hint's action actually reveals other-group matches:

```javascript
    static #onClearFilters() {
      this.state.types.clear();
      this.state.hiddenOnly = false;
      if (this.showsGroupPicker) this.state.groupId = "all";
      this.render();
    }
```

- [ ] **Step 5: Include group scope in `hasActiveFilters`** (`scripts/apps/hub/hub-mixin.mjs`) so the Clear button is available when only the group is narrowed:

```javascript
      context.hasActiveFilters = this.state.types.size > 0 || this.state.hiddenOnly
        || (this.showsGroupPicker && this.state.groupId !== "all");
```

- [ ] **Step 6: Feed the count to the template** — in `_prepareContext`, right after `context.totalCount = total;` (`scripts/apps/hub/hub-mixin.mjs:624`):

```javascript
      context.otherGroupMatches = this.#otherGroupMatches(records);
```

- [ ] **Step 7: Render the hint** — in `templates/hub/index.hbs`, between the `index-controls` `</div>` and the `<ol class="record-list">`:

```handlebars
  {{#if otherGroupMatches}}
  <button type="button" class="other-group-matches" data-action="clearFilters">
    {{localize "CAMPAIGNRECORD.Hub.OtherGroupMatches" count=otherGroupMatches}}
  </button>
  {{/if}}
```

- [ ] **Step 8: Add the string** to `lang/en.json` under `CAMPAIGNRECORD.Hub`:

```json
    "OtherGroupMatches": "{count} more matches in other groups — clear filters",
```

- [ ] **Step 9: Style the hint** — append to `styles/campaign-record.css`:

```css
.campaign-hub .other-group-matches {
  width: 100%;
  text-align: left;
  margin-bottom: 0.5rem;
  font-size: var(--font-size-12, 12px);
  opacity: 0.85;
  background: rgba(255, 255, 240, 0.05);
}
```

- [ ] **Step 10: Run the unit suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 11: Run test to verify it passes**

Run: `npx playwright test tests/e2e/06-hub-index.spec.mjs -g "hint when a type filter hides"`
Expected: PASS — exactly one `.other-group-matches` element.

- [ ] **Step 12: Commit**

```bash
git add scripts/apps/hub/hub-mixin.mjs templates/hub/index.hbs styles/campaign-record.css lang/en.json tests/e2e/06-hub-index.spec.mjs
git commit -m "feat: hint when filters hide Index search matches in other groups"
```

---

## Task 4: Remove the Search tab

Delete the standalone Search tab, its template and code path, and rewrite its e2e coverage to drive the Index search box.

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs` (PARTS ~66; TABS ~75; `#searchResults` 207-228; `context.searchGroups` 638; old `search-query` binding 703-714)
- Delete: `templates/hub/search.hbs`
- Modify: `lang/en.json` (`CAMPAIGNRECORD.Hub.Tabs.search`)
- Modify: `styles/campaign-record.css` (`.hub-search input[name="search-query"]`, `.search-hit`, `.search-hit:*`, `.result-type h3`)
- Modify: `tests/e2e/05-hub.spec.mjs`, `tests/e2e/07-hub-search.spec.mjs`, `tests/i18n-coverage.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: Hub `TABS.primary` now has two entries (`index`, `timeline`); `search` part and `searchGroups` context removed.

- [ ] **Step 1: Update the i18n coverage test** (`tests/i18n-coverage.test.js:43`) — the Tabs enumeration must no longer expect `search`:

```javascript
        for (const tab of ["index", "timeline"]) {
```

- [ ] **Step 2: Run it to verify current state** (guards the deletion)

Run: `npx vitest run tests/i18n-coverage.test.js`
Expected: PASS now (the `search` key still exists); this test will keep passing after Step 6 removes the key.

- [ ] **Step 3: Remove the search PART** (`scripts/apps/hub/hub-mixin.mjs:66`) — delete the line:

```javascript
      search: { template: "modules/campaign-record/templates/hub/search.hbs" },
```

- [ ] **Step 4: Remove the search TAB** (`scripts/apps/hub/hub-mixin.mjs:75`) — delete the line:

```javascript
          { id: "search", icon: "fa-solid fa-magnifying-glass" }
```

Ensure the preceding `timeline` entry line no longer has a trailing comma issue (it is followed by `]`).

- [ ] **Step 5: Delete `#searchResults()`** (`scripts/apps/hub/hub-mixin.mjs:207-228`) entirely, and remove `context.searchGroups = this.#searchResults();` (`:638`). Also delete the now-unused old search binding block (`:703-714`, the `input[name="search-query"]` handler).

> Note: keep `#ensureSearchIndex()`, the `search`/`createIndex` imports, and `_onDocumentChanged` — they are still used by `#indexEntries()`.

- [ ] **Step 6: Delete the template**

```bash
git rm templates/hub/search.hbs
```

- [ ] **Step 7: Remove the tab label** from `lang/en.json` — delete the `"search": "Search"` line inside `CAMPAIGNRECORD.Hub.Tabs` (leave `index` and `timeline`).

- [ ] **Step 8: Remove dead CSS** from `styles/campaign-record.css` — delete the rules `.campaign-hub .hub-search input[name="search-query"]` (156-159), `.campaign-hub .search-hit` (161-166), `.campaign-hub .search-hit:nth-child(even)` (168-170), `.campaign-hub .search-hit:hover` (172-174), and `.campaign-hub .result-type h3` (181-183). Keep `.campaign-hub .hit-snippet` (176-179) — it is reused by record snippets.

- [ ] **Step 9: Fix the Hub tab-switch e2e** (`tests/e2e/05-hub.spec.mjs:17-19`) — replace the search-tab assertions with a timeline round-trip (search is no longer a tab):

```javascript
    await hub.locator('[data-action="tab"][data-tab="timeline"]').click();
    await expect(hub.locator('.hub-timeline[data-tab="timeline"]')).toHaveClass(/active/);
    await expect(hub.locator('.hub-index[data-tab="index"]')).not.toHaveClass(/active/);
```

(Delete the subsequent duplicate timeline click at lines 21-22 if it becomes redundant.)

- [ ] **Step 10: Rewrite the search e2e to use the Index box** — in `tests/e2e/07-hub-search.spec.mjs`, change `openHubAndSearch` to target the Index search input (no tab click) and turn on snippets, and update result selectors from `.search-hit`/`.search-results .hint` to `.record-row`/`.record-snippets`:

```javascript
  const openHubAndSearch = async (p, query) => {
    await p.evaluate(async (query) => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      await game.settings.set("campaign-record", "hubSnippets", true);
      const hub = CampaignHub.open();
      hub.state.query = query;
      await hub.render(true);
    }, query);
    const hub = p.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    return hub;
  };
```

Then update the assertions in this file:
- `.search-hit` (with `hasText`) → `.record-row` (with `hasText`).
- `.hit-snippet` stays (now inside `.record-snippets`).
- The player "no results" check `playerHub.locator(".search-results .hint")` → assert `playerHub.locator(".record-row", { hasText: "E2E Search NPC" })` has count 0.
- In the incremental-patch and UUID tests that already set `hub.state.query` + `hub.render(true)` and count `.search-hit`, change the count selector to `.record-row`.

- [ ] **Step 11: Run the unit suite**

Run: `npx vitest run`
Expected: PASS (i18n coverage passes with the `search` tab key gone; no unit test references `searchGroups`/`#searchResults`).

- [ ] **Step 12: Run the affected e2e specs** (follow the `foundry-e2e` contract first)

Run: `npx playwright test tests/e2e/05-hub.spec.mjs tests/e2e/07-hub-search.spec.mjs`
Expected: PASS — search behavior (prefix match, snippet, GM-only visibility, incremental patch, UUID exclusion) now verified through the Index.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "refactor: remove the standalone Search tab; search lives in the Index"
```

---

## Task 5: Type filter — chips → multi-select dropdown

Replace the type-chip button row with a single Foundry `<multi-select>` control that drives the same `state.types` Set.

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs` (actions map — remove `filterType`; delete `#onFilterType` 382-387; `context.typeChips` → `typeFilterOptions` 626-632; add multi-select binding in `_onRender`)
- Modify: `templates/hub/index.hbs` (type-chips block 2-7)
- Modify: `styles/campaign-record.css` (`.type-chips`, `.type-chip`, `.type-chip.active`)
- Modify: `lang/en.json` (`TypeFilter`)
- Test: `tests/e2e/15-hub-types.spec.mjs`

**Interfaces:**
- Consumes: `RECORD_TYPES`, `typeId`, `state.types` (Set of shortType strings incl. `"journal"`).
- Produces: `context.typeFilterOptions` → `[{ type, label, active }]`; `<multi-select name="type-filter">` whose `change` event sets `state.types = new Set(event.target.value)`.

- [ ] **Step 1: Update the type-count e2e** (`tests/e2e/15-hub-types.spec.mjs`) — the control is now a multi-select with 11 `<option>`s rather than 11 `.type-chip` buttons. Replace the assertion at the `.type-chip` count line:

```javascript
    await expect(hub.locator('multi-select[name="type-filter"] option')).toHaveCount(11);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/15-hub-types.spec.mjs -g "one chip per record type"`
Expected: FAIL — no `multi-select[name="type-filter"]` exists yet.

- [ ] **Step 3: Rename the context data** (`scripts/apps/hub/hub-mixin.mjs:626-632`) from `typeChips` to `typeFilterOptions` (same shape):

```javascript
      context.typeFilterOptions = [...RECORD_TYPES, "journal"].map((t) => ({
        type: t,
        label: t === "journal"
          ? game.i18n.localize("CAMPAIGNRECORD.Hub.JournalPage")
          : game.i18n.localize(`TYPES.JournalEntryPage.${typeId(t)}`),
        active: this.state.types.has(t)
      }));
```

- [ ] **Step 4: Remove the `filterType` action** — delete the `filterType: HubBase.#onFilterType,` entry from the `actions` object (`scripts/apps/hub/hub-mixin.mjs:43`) and delete the `#onFilterType` method (`:382-387`).

- [ ] **Step 5: Bind the multi-select** — in `_onRender`, alongside the `sort-select` binding (`scripts/apps/hub/hub-mixin.mjs` ~695):

```javascript
      const typeFilter = this.element.querySelector('multi-select[name="type-filter"]');
      if (typeFilter && !typeFilter.dataset.crBound) {
        typeFilter.dataset.crBound = "1";
        typeFilter.addEventListener("change", (event) => {
          this.state.types = new Set(event.target.value);
          this.render();
        });
      }
```

- [ ] **Step 6: Replace the template control** (`templates/hub/index.hbs:2-7`) — swap the `type-chips` div for the multi-select:

```handlebars
  <multi-select name="type-filter" class="type-filter"
                aria-label="{{localize "CAMPAIGNRECORD.Hub.TypeFilter"}}">
    {{#each typeFilterOptions}}
    <option value="{{this.type}}" {{#if this.active}}selected{{/if}}>{{this.label}}</option>
    {{/each}}
  </multi-select>
```

- [ ] **Step 7: Add the label string** to `lang/en.json` under `CAMPAIGNRECORD.Hub`:

```json
    "TypeFilter": "Filter by type",
```

- [ ] **Step 8: Replace the chip CSS** in `styles/campaign-record.css` — remove `.type-chips` (54-59) and `.type-chip` (61-67); in the combined active rule (104-108) drop `.type-chip.active,` leaving `.hidden-toggle.active`. Add:

```css
.campaign-hub .type-filter {
  width: auto;
  flex: 1 1 10rem;
  min-width: 10rem;
  max-width: 18rem;
  margin-bottom: 0.5rem;
}
```

> Note: the multi-select now sits on the same controls row visually; if `index-controls` layout needs it, moving the control inside that flex row is acceptable, but keeping it as a sibling above is fine.

- [ ] **Step 9: Run the unit suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 10: Run test to verify it passes**

Run: `npx playwright test tests/e2e/15-hub-types.spec.mjs`
Expected: PASS — 11 options present; subtitle/search assertions still hold.

- [ ] **Step 11: Commit**

```bash
git add scripts/apps/hub/hub-mixin.mjs templates/hub/index.hbs styles/campaign-record.css lang/en.json tests/e2e/15-hub-types.spec.mjs
git commit -m "feat: replace Index type chips with a multi-select dropdown"
```

---

## Task 6: Clear-filters e2e fix, full sweep, and verification

Reconcile remaining e2e that referenced the old tag input, and run the whole suite.

**Files:**
- Modify: `tests/e2e/06-hub-index.spec.mjs` (clear-filters test 89-105)
- Verify: entire unit + e2e suite

**Interfaces:** none new.

- [ ] **Step 1: Update the clear-filters e2e** (`tests/e2e/06-hub-index.spec.mjs:89-105`) — it referenced `input[name="tag-filter"]` and `.type-chip`. Rewrite to drive the multi-select via state and assert the type filter and hidden-only reset, and that the query is preserved:

```javascript
  test("clear filters resets type and hidden-only, keeps the query", async () => {
    const hub = gmPage.locator("#campaign-hub");
    await gmPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const h = CampaignHub.open();
      h.state.query = "e2e";
      h.state.types = new Set(["quest"]);
      h.state.hiddenOnly = true;
      await h.render(true);
    });
    await hub.locator('[data-action="clearFilters"]').first().click();
    const state = await gmPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const h = CampaignHub.open();
      return { types: h.state.types.size, hidden: h.state.hiddenOnly, query: h.state.query };
    });
    expect(state.types).toBe(0);
    expect(state.hidden).toBe(false);
    expect(state.query).toBe("e2e");
  });
```

> Implementer note: if the file has other references to `tag-filter` or `.type-chip`, update them the same way (query via `input[name="index-search"]`, types via `state.types`).

- [ ] **Step 2: Grep for stragglers**

Run: `grep -rn 'tag-filter\|type-chip\|search-query\|search-hit\|searchGroups\|hub-search\|state\.tag' scripts/ templates/ styles/ tests/ lang/`
Expected: no matches (every reference migrated). Fix any that remain.

- [ ] **Step 3: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS (all files).

- [ ] **Step 4: Run the full e2e suite** (follow the `foundry-e2e` contract)

Run: `npx playwright test tests/e2e/05-hub.spec.mjs tests/e2e/06-hub-index.spec.mjs tests/e2e/07-hub-search.spec.mjs tests/e2e/15-hub-types.spec.mjs`
Expected: PASS — Hub has two tabs, Index search filters + snippets + hint work, type dropdown filters, GM-only visibility preserved.

- [ ] **Step 5: Manual smoke (optional but recommended)** — in a running world: open the Hub, confirm two tabs; type a query and confirm the list filters; toggle snippets and confirm rows expand; narrow to one group/type and confirm the "other groups" hint appears and clears; open the type dropdown and multi-select two types.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/06-hub-index.spec.mjs
git commit -m "test: migrate clear-filters e2e to the merged Index search"
```

---

## Self-Review

**Spec coverage:**
- Drop Search tab → Task 4. ✓
- Unified search box (name/tags/content, 2-char floor, respects filters) → Task 1. ✓
- Snippets toggle, off by default, client setting → Task 2. ✓
- "N more matches in other groups — clear filters" (only when filters active & N>0; never on All Groups + no type filter) → Task 3. ✓
- Type chips → multi-select dropdown, same `state.types` → Task 5. ✓
- Deletions (`state.tag`, tag input, `#searchResults`, `searchGroups`, old binding, `filterType`) → Tasks 1 & 4 & 5. ✓
- Kept: search engine, `#ensureSearchIndex`, re-index hooks → preserved, noted in Task 4 Step 5. ✓
- Data flow (<2 chars vs ≥2 chars; GM visibility via `search({gm})`) → Task 1 Step 4. ✓
- Testing + localization + non-goals (tags/groups untouched) → Tasks 1-6; no task touches the tag schema/editor or group model. ✓

**Placeholder scan:** No TBD/TODO. "Implementer note" blocks give concrete seeding guidance, not deferred work; each is backed by an exact assertion. No "add error handling"/"write tests for the above" placeholders.

**Type consistency:** `state.query` (string) used consistently across `#indexEntries`, the input binding, `#otherGroupMatches`, and templates. `matches: [{ field, snippet }]` is the engine's shape (search-index.mjs:128) and is what rows carry and templates read. `context.snippets` (bool) set in Task 2, read in Task 2's template. `context.typeFilterOptions` produced in Task 5 Step 3 and consumed in Task 5 Step 6. `#otherGroupMatches(shownRecords)` defined and called with `records` in Task 3. `SNIPPETS_SETTING` = `"hubSnippets"` used identically in constant, registration, handler, context, and tests.
