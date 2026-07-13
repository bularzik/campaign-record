# Campaign Record UI Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Campaign Record hub header, filter/sort controls, inline editing, and thumbnail display per the approved design.

**Architecture:** The hub is a custom ApplicationV2 built from `scripts/apps/hub/hub-mixin.mjs`, rendered as a standalone window (`CampaignHub`) or a group's JournalEntry sheet (`GroupHubSheet`). UI lives in `templates/hub/*.hbs`; the single stylesheet is `styles/campaign-record.css`; record page sheets (module types) extend `scripts/sheets/base-record-sheet.mjs` and mount frameless in the pane via `scripts/apps/hub/record-pane.mjs`.

**Tech Stack:** Foundry VTT v13 ApplicationV2 + Handlebars, vanilla JS (ES modules), vitest (jsdom) for unit tests, Playwright for e2e.

## Global Constraints

- Module id is `campaign-record`; template paths are `modules/campaign-record/templates/...`.
- Pure logic goes in `scripts/logic/*.mjs` with a vitest test in `tests/*.test.js`; UI behavior is covered by Playwright specs in `tests/e2e/*.spec.mjs`.
- `npm test` (vitest) must stay green after every task. e2e specs are edited to match new behavior but run in the Foundry e2e harness (see the `foundry-e2e` skill) — not required per-commit.
- Do NOT delete existing `lang/en.json` keys (`HiddenOnly`, `ToggleThumbnails`, `EditRecord`, `DoneEditing` become orphaned but stay): `tests/i18n-rename.test.js` enumerates specific keys and `tests/i18n-coverage.test.js` only checks referenced keys resolve. Leaving orphans keeps both green with zero churn.
- Commit after each task with the shown message.

---

### Task 1: Window title → "Campaign Record"

**Files:**
- Modify: `lang/en.json` (add `CAMPAIGNRECORD.Hub.WindowTitle`)
- Modify: `scripts/apps/hub/group-hub-sheet.mjs`
- Test: `tests/i18n-coverage.test.js` (already asserts referenced keys resolve — no edit)

**Interfaces:**
- Produces: `GroupHubSheet#title` getter returning the localized window title.

- [ ] **Step 1: Add the localization key.** In `lang/en.json`, inside `CAMPAIGNRECORD.Hub` (after the `"AutoTargetNone": "None"` line, add a comma), add:

```json
      "AutoTargetNone": "None",
      "WindowTitle": "Campaign Record"
```

- [ ] **Step 2: Override the title getter.** In `scripts/apps/hub/group-hub-sheet.mjs`, after the `get showsGroupPicker()` block (ends line 21), add:

```js
  /** Window title stays generic; the record's name shows in the header row. */
  get title() {
    return game.i18n.localize("CAMPAIGNRECORD.Hub.WindowTitle");
  }
```

- [ ] **Step 3: Verify vitest is green.**

Run: `npx vitest run tests/i18n-coverage.test.js tests/i18n-rename.test.js`
Expected: PASS (the new value "Campaign Record" strips to empty under the rename test's `campaign record` filter, so it is not flagged).

- [ ] **Step 4: Commit.**

```bash
git add lang/en.json scripts/apps/hub/group-hub-sheet.mjs
git commit -m "fix(hub): window title reads 'Campaign Record' not 'Journal Entry: <name>'"
```

---

### Task 2: Header — record name left, settings gear right

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs` (add `headerTitle` getter + context)
- Modify: `scripts/apps/hub/group-hub-sheet.mjs` (override `headerTitle`)
- Modify: `templates/hub/header.hbs`
- Modify: `styles/campaign-record.css`

**Interfaces:**
- Produces: `context.headerTitle` (string|null) consumed by `header.hbs`.

- [ ] **Step 1: Add a default `headerTitle` getter.** In `scripts/apps/hub/hub-mixin.mjs`, after the `get showsGroupPicker()` block (ends line 34), add:

```js
    /** Name shown at the left of the header; null on the standalone hub (the group picker names it instead). */
    get headerTitle() {
      return null;
    }
```

- [ ] **Step 2: Provide it on the group sheet.** In `scripts/apps/hub/group-hub-sheet.mjs`, after the `get title()` added in Task 1, add:

```js
  /** The group's name sits left-justified in the header row. */
  get headerTitle() {
    return this.document.name;
  }
```

- [ ] **Step 3: Expose it in context.** In `scripts/apps/hub/hub-mixin.mjs` `_prepareContext`, immediately after `context.showGroupPicker = this.showsGroupPicker;` (line 615), add:

```js
      context.headerTitle = this.headerTitle;
```

- [ ] **Step 4: Render the name on the left.** In `templates/hub/header.hbs`, replace the closing of the group-picker block (lines 8-9):

```hbs
    {{/each}}
  </select>
  {{/if}}
```

with:

```hbs
    {{/each}}
  </select>
  {{else if headerTitle}}
  <h2 class="hub-title">{{headerTitle}}</h2>
  {{/if}}
```

- [ ] **Step 5: Push the gear to the right.** In `styles/campaign-record.css`, replace the `.campaign-hub .hub-header` rule (lines 31-37):

```css
.campaign-hub .hub-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--color-border-light-primary, #7a7971);
}
```

with (add `justify-content: space-between` and a `.hub-title` rule):

```css
.campaign-hub .hub-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--color-border-light-primary, #7a7971);
}
.campaign-hub .hub-header .hub-title {
  margin: 0;
  border: none;
  font-size: var(--font-size-18, 1.125rem);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 6: Verify vitest is green.**

Run: `npx vitest run`
Expected: PASS (no unit test targets the header markup; this confirms nothing else broke).

- [ ] **Step 7: Verify in the app (manual/e2e harness).** Open a Campaign Record journal entry: the group name shows at the left of the header row and the gear button is flush right. On the standalone hub the group `<select>` is at the left, gear at the right.

- [ ] **Step 8: Commit.**

```bash
git add scripts/apps/hub/hub-mixin.mjs scripts/apps/hub/group-hub-sheet.mjs templates/hub/header.hbs styles/campaign-record.css
git commit -m "feat(hub): show record name left, settings gear right in header row"
```

---

### Task 3: Fix the types dropdown contrast

**Files:**
- Modify: `styles/campaign-record.css`

- [ ] **Step 1: Give the menu a dark surface + legible text.** In `styles/campaign-record.css`, replace the `.campaign-hub .doctype-menu` rule (lines 63-75):

```css
.campaign-hub .doctype-menu {
  position: absolute;
  z-index: 2;
  top: 100%;
  left: 0;
  min-width: 12rem;
  max-height: 16rem;
  overflow-y: auto;
  padding: 0.25rem;
  border: 1px solid var(--color-border-light-primary, #7a7971);
  border-radius: 4px;
  background: var(--color-bg-option, var(--color-bg, #e8e6dc));
}
```

with (match the dark settings panel and set an explicit text color):

```css
.campaign-hub .doctype-menu {
  position: absolute;
  z-index: 2;
  top: 100%;
  left: 0;
  min-width: 12rem;
  max-height: 16rem;
  overflow-y: auto;
  padding: 0.25rem;
  border: 1px solid var(--color-border-dark, #000);
  border-radius: 4px;
  background: var(--color-bg, #1c1c1c);
  color: var(--color-text-primary, #f0f0e0);
}
```

- [ ] **Step 2: Verify vitest is green.**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 3: Verify in the app (manual/e2e harness).** Click the types (funnel) filter: the dropdown is a dark panel with readable light option text — no white-on-white.

- [ ] **Step 4: Commit.**

```bash
git add styles/campaign-record.css
git commit -m "fix(hub): legible dark background for the types filter dropdown"
```

---

### Task 4: Sort → icon popup to the right of the types dropdown

**Files:**
- Create: `scripts/logic/sort-menu.mjs`
- Test: `tests/sort-menu.test.js`
- Modify: `scripts/apps/hub/hub-mixin.mjs`
- Modify: `templates/hub/index.hbs`
- Modify: `styles/campaign-record.css`
- Modify: `tests/e2e/05-hub.spec.mjs`

**Interfaces:**
- Produces: `buildSortMenu(current, labelOf)` → `{ items: {value,label,selected}[] }`; consumed by `_prepareContext` and `index.hbs`. `state.sortMenuOpen` boolean.

- [ ] **Step 1: Write the failing unit test.** Create `tests/sort-menu.test.js`:

```js
import { describe, it, expect } from "vitest";
import { SORT_KEYS, buildSortMenu } from "../scripts/logic/sort-menu.mjs";

describe("buildSortMenu", () => {
  const labelOf = (k) => `L:${k}`;

  it("lists every sort key with resolved labels", () => {
    const { items } = buildSortMenu("name", labelOf);
    expect(items.map((i) => i.value)).toEqual(SORT_KEYS);
    expect(items.map((i) => i.label)).toEqual(SORT_KEYS.map((k) => `L:${k}`));
  });

  it("marks the current key selected and no other", () => {
    const { items } = buildSortMenu("updated", labelOf);
    expect(items.filter((i) => i.selected).map((i) => i.value)).toEqual(["updated"]);
  });

  it("selects nothing when the current key is unknown", () => {
    const { items } = buildSortMenu("bogus", labelOf);
    expect(items.some((i) => i.selected)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `npx vitest run tests/sort-menu.test.js`
Expected: FAIL (cannot find module `../scripts/logic/sort-menu.mjs`).

- [ ] **Step 3: Implement the pure helper.** Create `scripts/logic/sort-menu.mjs`:

```js
/** Index sort options, mirroring the doctype-filter view-model pattern. */
export const SORT_KEYS = ["name", "type", "updated"];

/**
 * Build the sort popup view model.
 * @param {string} current  active sort key
 * @param {(key: string) => string} labelOf  localized label for a sort key
 * @returns {{items: {value: string, label: string, selected: boolean}[]}}
 */
export function buildSortMenu(current, labelOf) {
  return {
    items: SORT_KEYS.map((value) => ({ value, label: labelOf(value), selected: value === current }))
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes.**

Run: `npx vitest run tests/sort-menu.test.js`
Expected: PASS.

- [ ] **Step 5: Add `sortMenuOpen` to state.** In `scripts/apps/hub/hub-mixin.mjs`, replace the `state` initializer (lines 73-76):

```js
    state = {
      groupId: "all", types: new Set(), hiddenOnly: false, sort: "name", query: "",
      typeMenuOpen: false, settingsMenuOpen: false
    };
```

with (add `sortMenuOpen`):

```js
    state = {
      groupId: "all", types: new Set(), hiddenOnly: false, sort: "name", query: "",
      typeMenuOpen: false, settingsMenuOpen: false, sortMenuOpen: false
    };
```

- [ ] **Step 6: Reset it on close.** In `_onClose` (lines 268-269), after `this.state.settingsMenuOpen = false;` add:

```js
      this.state.sortMenuOpen = false;
```

- [ ] **Step 7: Build the sort menu in context.** In `scripts/apps/hub/hub-mixin.mjs`, add the import near the top (after line 7's `buildDoctypeFilter` import):

```js
import { buildSortMenu } from "../../logic/sort-menu.mjs";
```

Then replace the `context.sortOptions` block (lines 649-653):

```js
      context.sortOptions = ["name", "type", "updated"].map((s) => ({
        value: s,
        label: game.i18n.localize(`CAMPAIGNRECORD.Hub.Sort.${s}`),
        selected: this.state.sort === s
      }));
```

with:

```js
      context.sortMenu = buildSortMenu(
        this.state.sort,
        (s) => game.i18n.localize(`CAMPAIGNRECORD.Hub.Sort.${s}`)
      );
      context.sortMenuOpen = this.state.sortMenuOpen;
```

- [ ] **Step 8: Restructure the index markup.** In `templates/hub/index.hbs`, replace the doctype-filter block and the sort `<select>` — i.e. replace lines 9-40 (from `<div class="doctype-filter">` through the closing `</select>` of the sort select) — with a shared filter row that puts the sort icon-popup beside the types filter, and a search-only controls row:

```hbs
  <div class="filter-row">
    <div class="doctype-filter">
      <button type="button" class="doctype-summary" aria-haspopup="true"
              aria-expanded="{{#if typeMenuOpen}}true{{else}}false{{/if}}"
              data-tooltip="CAMPAIGNRECORD.Hub.TypeFilter"
              aria-label="{{localize "CAMPAIGNRECORD.Hub.TypeFilter"}}">
        <i class="fa-solid fa-filter"></i>
        <span class="doctype-summary-label">{{#if typeMenuOpen}}{{localize "CAMPAIGNRECORD.Hub.AllTypes"}}{{else}}{{doctypeFilter.summary}}{{/if}}</span>
      </button>
      {{#if typeMenuOpen}}
      <div class="doctype-menu">
        {{#each doctypeFilter.items}}
        <label class="doctype-option">
          <input type="checkbox" name="doctype-check" value="{{this.type}}" {{#if this.checked}}checked{{/if}}>
          <i class="{{this.icon}}"></i> {{this.label}}
        </label>
        {{/each}}
      </div>
      {{/if}}
    </div>
    <div class="sort-filter">
      <button type="button" class="sort-summary" aria-haspopup="true"
              aria-expanded="{{#if sortMenuOpen}}true{{else}}false{{/if}}"
              data-tooltip="CAMPAIGNRECORD.Hub.SortBy"
              aria-label="{{localize "CAMPAIGNRECORD.Hub.SortBy"}}">
        <i class="fa-solid fa-arrow-down-short-wide"></i>
      </button>
      {{#if sortMenuOpen}}
      <div class="sort-menu">
        {{#each sortMenu.items}}
        <label class="sort-option">
          <input type="radio" name="sort-select" value="{{this.value}}" {{#if this.selected}}checked{{/if}}>
          {{this.label}}
        </label>
        {{/each}}
      </div>
      {{/if}}
    </div>
  </div>
  <div class="index-controls">
    <input type="search" name="index-search" value="{{state.query}}"
           placeholder="{{localize "CAMPAIGNRECORD.Hub.FilterTag"}}" autocomplete="off">
```

Note: this replacement ends by re-opening `<div class="index-controls">` with the search input; the snippets label, hidden-toggle, and filtered-count that follow are left untouched by this task (snippets is moved in Task 6, hidden-toggle removed in Task 5). The original `<div class="index-controls">` and search input lines (28-30) are consumed by this replacement, so delete the now-duplicated original lines 28-30.

- [ ] **Step 9: Add the localization key.** In `lang/en.json`, inside `CAMPAIGNRECORD.Hub`, after `"TypeFilter": "Filter by type",` add:

```json
      "TypeFilter": "Filter by type",
      "SortBy": "Sort entries",
```

- [ ] **Step 10: Replace the sort change listener with popup wiring.** In `scripts/apps/hub/hub-mixin.mjs` `_onRender`, replace the sort-select block (lines 718-725):

```js
      const sortSelect = this.element.querySelector('select[name="sort-select"]');
      if (sortSelect && !sortSelect.dataset.crBound) {
        sortSelect.dataset.crBound = "1";
        sortSelect.addEventListener("change", (event) => {
          this.state.sort = event.target.value;
          this.#renderList();
        });
      }
```

with a delegated toggle/close + radio-change handler mirroring the doctype popup:

```js
      if (!this.element.dataset.crSortBound) {
        this.element.dataset.crSortBound = "1";
        this.element.addEventListener("click", (event) => {
          if (event.target.closest(".sort-summary")) {
            this.state.sortMenuOpen = !this.state.sortMenuOpen;
            return this.#renderList();
          }
          if (this.state.sortMenuOpen && !event.target.closest(".sort-filter")) {
            this.state.sortMenuOpen = false;
            this.#renderList();
          }
        });
        this.element.addEventListener("change", (event) => {
          const radio = event.target.closest('input[name="sort-select"]');
          if (!radio) return;
          this.state.sort = radio.value;
          this.state.sortMenuOpen = false;
          this.#renderList();
        });
      }
```

- [ ] **Step 11: Style the sort popup; remove the stale select rule.** In `styles/campaign-record.css`, replace the `.campaign-hub .index-controls select[name="sort-select"]` rule (lines 107-110):

```css
.campaign-hub .index-controls select[name="sort-select"] {
  width: auto;
  flex: 0 0 auto;
}
```

with a filter-row + sort-popup block (reusing the doctype-menu look):

```css
.campaign-hub .filter-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.campaign-hub .filter-row .doctype-filter {
  flex: 1 1 auto;
  margin-bottom: 0;
}
.campaign-hub .sort-filter {
  position: relative;
  flex: 0 0 auto;
}
.campaign-hub .sort-summary {
  width: auto;
  flex: 0 0 auto;
}
.campaign-hub .sort-menu {
  position: absolute;
  z-index: 2;
  top: 100%;
  right: 0;
  min-width: 10rem;
  padding: 0.25rem;
  border: 1px solid var(--color-border-dark, #000);
  border-radius: 4px;
  background: var(--color-bg, #1c1c1c);
  color: var(--color-text-primary, #f0f0e0);
}
.campaign-hub .sort-option {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.15rem 0.3rem;
  white-space: nowrap;
  cursor: pointer;
}
.campaign-hub .sort-option:hover {
  background: var(--color-hover-bg, rgba(255, 255, 240, 0.1));
}
```

Also delete the now-unused standalone `.campaign-hub .doctype-filter { position: relative; margin-bottom: 0.5rem; }` rule (lines 52-55) since `.doctype-filter` now sits inside `.filter-row`; replace it with just the positioning it still needs:

```css
.campaign-hub .doctype-filter {
  position: relative;
}
```

- [ ] **Step 12: Update the e2e sort test.** In `tests/e2e/05-hub.spec.mjs`, replace the two `select[name="sort-select"]` interactions (lines 92 and 95) so the test drives the popup:

Replace line 92:

```js
    await hub.locator('select[name="sort-select"]').selectOption("type");
```

with:

```js
    await hub.locator('.sort-summary').click();
    await hub.locator('.sort-menu input[name="sort-select"][value="type"]').check();
```

Replace line 95:

```js
    await hub.locator('select[name="sort-select"]').selectOption("name");
```

with:

```js
    await hub.locator('.sort-summary').click();
    await hub.locator('.sort-menu input[name="sort-select"][value="name"]').check();
```

- [ ] **Step 13: Verify vitest is green.**

Run: `npx vitest run`
Expected: PASS (includes the new `tests/sort-menu.test.js`).

- [ ] **Step 14: Verify in the app (manual/e2e harness).** The sort control is a single icon to the right of the types filter; clicking opens a popup of Name/Type/Updated; choosing one re-sorts and closes the popup; clicking elsewhere closes it.

- [ ] **Step 15: Commit.**

```bash
git add scripts/logic/sort-menu.mjs tests/sort-menu.test.js scripts/apps/hub/hub-mixin.mjs templates/hub/index.hbs styles/campaign-record.css lang/en.json tests/e2e/05-hub.spec.mjs
git commit -m "feat(hub): sort control becomes an icon popup beside the types filter"
```

---

### Task 5: Remove "Show hidden entries only"

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs`
- Modify: `templates/hub/index.hbs`
- Modify: `styles/campaign-record.css`
- Modify: `tests/e2e/06-hub-index.spec.mjs`

- [ ] **Step 1: Remove the button markup.** In `templates/hub/index.hbs`, delete the GM-only hidden-toggle block (originally lines 41-46):

```hbs
    {{#if isGM}}
    <button type="button" class="hidden-toggle {{#if state.hiddenOnly}}active{{/if}}"
            data-action="toggleHiddenOnly" data-tooltip="CAMPAIGNRECORD.Hub.HiddenOnly">
      <i class="fa-solid fa-eye-slash"></i>
    </button>
    {{/if}}
```

- [ ] **Step 2: Remove the action registration.** In `scripts/apps/hub/hub-mixin.mjs`, delete line 45:

```js
        toggleHiddenOnly: HubBase.#onToggleHiddenOnly,
```

- [ ] **Step 3: Remove the state field.** In the `state` initializer, change `hiddenOnly: false, ` out — the line becomes:

```js
      groupId: "all", types: new Set(), sort: "name", query: "",
```

- [ ] **Step 4: Remove the filter application.** In `#indexEntries`, delete line 290:

```js
      if (this.state.hiddenOnly) records = records.filter((r) => r.hidden);
```

- [ ] **Step 5: Remove the handler.** Delete `#onToggleHiddenOnly` (lines 384-387):

```js
    static #onToggleHiddenOnly() {
      this.state.hiddenOnly = !this.state.hiddenOnly;
      this.render();
    }
```

- [ ] **Step 6: Drop the clear-filters reference.** In `#onClearFilters`, delete the line `this.state.hiddenOnly = false;` (originally line 391).

- [ ] **Step 7: Drop it from `#otherGroupMatches`.** Replace the `filtersActive` line (originally 315):

```js
      const filtersActive = this.state.types.size > 0 || this.state.hiddenOnly || scopingClearable;
```

with:

```js
      const filtersActive = this.state.types.size > 0 || scopingClearable;
```

- [ ] **Step 8: Drop it from `hasActiveFilters`.** Replace (originally lines 641-642):

```js
      context.hasActiveFilters = this.state.types.size > 0 || this.state.hiddenOnly
        || (this.showsGroupPicker && this.state.groupId !== "all");
```

with:

```js
      context.hasActiveFilters = this.state.types.size > 0
        || (this.showsGroupPicker && this.state.groupId !== "all");
```

- [ ] **Step 9: Remove the CSS rule.** In `styles/campaign-record.css`, delete the `.hidden-toggle.active` rule (lines 132-135):

```css
.campaign-hub .hidden-toggle.active {
  background: var(--color-warm-2, #c9593f);
  color: #fff;
}
```

- [ ] **Step 10: Update the e2e clear-filters test.** In `tests/e2e/06-hub-index.spec.mjs`, replace the test body (lines 93-112) so it no longer references `hiddenOnly`:

```js
  test("clear filters resets the type filter, keeps the query", async () => {
    const hub = gmPage.locator("#campaign-hub");
    await gmPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const h = CampaignHub.open();
      h.state.query = "e2e";
      h.state.types = new Set(["quest"]);
      await h.render(true);
    });
    await hub.locator('[data-action="clearFilters"]').first().click();
    const state = await gmPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const h = CampaignHub.open();
      return { types: h.state.types.size, query: h.state.query };
    });
    expect(state.types).toBe(0);
    expect(state.query).toBe("e2e");
  });
```

(The unrelated assertion at line 89, `expect(playerHub.locator(".hidden-toggle")).toHaveCount(0)`, still passes — the element no longer exists for anyone — and may be left as-is.)

- [ ] **Step 11: Verify vitest is green.**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 12: Verify in the app (manual/e2e harness).** No eye-slash "hidden only" button appears in the index controls for a GM; type filtering and clear-filters still work.

- [ ] **Step 13: Commit.**

```bash
git add scripts/apps/hub/hub-mixin.mjs templates/hub/index.hbs styles/campaign-record.css tests/e2e/06-hub-index.spec.mjs
git commit -m "feat(hub): remove the 'show hidden entries only' filter"
```

---

### Task 6: Move "Snippets" into the settings menu

**Files:**
- Modify: `templates/hub/header.hbs`
- Modify: `templates/hub/index.hbs`
- Modify: `scripts/apps/hub/hub-mixin.mjs`
- Modify: `styles/campaign-record.css`

- [ ] **Step 1: Remove the snippets label from the index controls.** In `templates/hub/index.hbs`, delete the `.snippets-toggle` block (originally lines 31-35):

```hbs
    <label class="snippets-toggle">
      <input type="checkbox" name="snippets-toggle" data-action="toggleSnippets"
             {{#if snippets}}checked{{/if}}>
      {{localize "CAMPAIGNRECORD.Hub.Snippets"}}
    </label>
```

- [ ] **Step 2: Add a Snippets toggle to the settings panel.** In `templates/hub/header.hbs`, after the `toggleInlineEdit` button block (ends line 30, before `<hr>` on line 31), add a matching `menuitemcheckbox` button:

```hbs
      <button type="button" role="menuitemcheckbox" data-action="toggleSnippets"
              aria-checked="{{#if snippets}}true{{else}}false{{/if}}">
        <i class="fa-solid {{#if snippets}}fa-square-check{{else}}fa-square{{/if}}"></i>
        {{localize "CAMPAIGNRECORD.Hub.Snippets"}}
      </button>
```

- [ ] **Step 3: Re-render header + index on toggle.** In `scripts/apps/hub/hub-mixin.mjs`, replace `#onToggleSnippets` (lines 519-523):

```js
    static async #onToggleSnippets() {
      const current = game.settings.get(MODULE_ID, SNIPPETS_SETTING);
      await game.settings.set(MODULE_ID, SNIPPETS_SETTING, !current);
      await this.render({ parts: ["index"] });
    }
```

with (also refresh the header so the checkmark updates):

```js
    static async #onToggleSnippets() {
      const current = game.settings.get(MODULE_ID, SNIPPETS_SETTING);
      await game.settings.set(MODULE_ID, SNIPPETS_SETTING, !current);
      await this.render({ parts: ["header", "index"] });
    }
```

- [ ] **Step 4: Remove the now-unused index styling.** In `styles/campaign-record.css`, delete the `.campaign-hub .snippets-toggle` rule (lines 117-124):

```css
.campaign-hub .snippets-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex: 0 0 auto;
  font-size: var(--font-size-12, 12px);
  white-space: nowrap;
}
```

(The panel button inherits `.hub-settings-panel > button` styling already defined at lines 705.)

- [ ] **Step 5: Verify vitest is green.**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Verify in the app (manual/e2e harness).** The Snippets checkbox no longer sits next to the search box; it appears inside the gear menu and toggling it still expands index rows with search-match snippets.

- [ ] **Step 7: Commit.**

```bash
git add templates/hub/header.hbs templates/hub/index.hbs scripts/apps/hub/hub-mixin.mjs styles/campaign-record.css
git commit -m "feat(hub): move the Snippets toggle into the settings menu"
```

---

### Task 7: Entry-list thumbnails

**Files:**
- Modify: `templates/hub/index-row.hbs`
- Modify: `styles/campaign-record.css`

**Interfaces:**
- Consumes: `this.image` (already provided by `toIndexEntry` in `hub-data.mjs:68` as `page.system?.image || null`).

- [ ] **Step 1: Render the image, falling back to the type icon.** In `templates/hub/index-row.hbs`, replace the icon line (line 4):

```hbs
  <i class="record-type-icon {{this.icon}}" data-tooltip="{{this.typeLabel}}"></i>
```

with:

```hbs
  {{#if this.image}}
  <img class="record-thumb" src="{{this.image}}" alt="" data-tooltip="{{this.typeLabel}}">
  {{else}}
  <i class="record-type-icon {{this.icon}}" data-tooltip="{{this.typeLabel}}"></i>
  {{/if}}
```

- [ ] **Step 2: Widen the narrow index's first column and size the thumb.** In `styles/campaign-record.css`, replace the narrow-index grid rule (lines 612-614):

```css
.campaign-hub .hub-index .record-row {
  grid-template-columns: 1.5rem minmax(0, 1fr);
}
```

with (room for a 2rem thumb) and add a `.record-thumb` rule right after:

```css
.campaign-hub .hub-index .record-row {
  grid-template-columns: 2rem minmax(0, 1fr);
}
.campaign-hub .record-row .record-thumb {
  width: 2rem;
  height: 2rem;
  object-fit: cover;
  border: none;
  border-radius: 3px;
  justify-self: center;
}
```

- [ ] **Step 3: Verify vitest is green.**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 4: Verify in the app (manual/e2e harness).** Index rows for entries that have a `system.image` show that image as a 2rem thumbnail; entries without one keep the type icon.

- [ ] **Step 5: Commit.**

```bash
git add templates/hub/index-row.hbs styles/campaign-record.css
git commit -m "feat(hub): show entry images as thumbnails in the index list"
```

---

### Task 8: Timeline thumbnails always on; remove the toggle + setting

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs`
- Modify: `templates/hub/timeline.hbs`
- Modify: `scripts/constants.mjs`
- Modify: `scripts/hooks/hub-ui.mjs`
- Modify: `tests/e2e/19-hub-timeline-links.spec.mjs`

- [ ] **Step 1: Always populate the thumb.** In `scripts/apps/hub/hub-mixin.mjs` `#timelineGroups`, delete the setting read (line 397):

```js
      const thumbnails = game.settings.get(MODULE_ID, THUMBNAILS_SETTING);
```

and replace the `thumb` line (line 414):

```js
              thumb: thumbnails && entry.img ? entry.img : null,
```

with:

```js
              thumb: entry.img || null,
```

- [ ] **Step 2: Remove the toggle action + handler + context.** In `scripts/apps/hub/hub-mixin.mjs`:
  - Delete the action registration line 55: `toggleThumbnails: HubBase.#onToggleThumbnails,`
  - Delete `#onToggleThumbnails` (lines 507-511):

```js
    static async #onToggleThumbnails() {
      const current = game.settings.get(MODULE_ID, THUMBNAILS_SETTING);
      await game.settings.set(MODULE_ID, THUMBNAILS_SETTING, !current);
      this.render();
    }
```

  - Delete the context line 655: `context.thumbnails = game.settings.get(MODULE_ID, THUMBNAILS_SETTING);`
  - In the imports (lines 3-5), remove `THUMBNAILS_SETTING, ` so the line reads:

```js
import {
  MODULE_ID, RAIL_SETTING, INLINE_EDIT_SETTING, SNIPPETS_SETTING, RECORD_TYPES, typeId
} from "../../constants.mjs";
```

- [ ] **Step 3: Remove the toggle button from the template.** In `templates/hub/timeline.hbs`, delete the button block (lines 8-12):

```hbs
    <button type="button" data-action="toggleThumbnails"
            class="{{#if thumbnails}}active{{/if}}"
            data-tooltip="CAMPAIGNRECORD.Hub.ToggleThumbnails">
      <i class="fa-solid fa-image"></i>
    </button>
```

- [ ] **Step 4: Remove the setting constant.** In `scripts/constants.mjs`, delete lines 48-49:

```js
/** Client setting: render timeline links as thumbnails instead of icon chips. */
export const THUMBNAILS_SETTING = "timelineThumbnails";
```

- [ ] **Step 5: Remove the setting registration.** In `scripts/hooks/hub-ui.mjs`:
  - In the import (line 1), remove `THUMBNAILS_SETTING, ` so it reads:

```js
import { MODULE_ID, RAIL_SETTING, INLINE_EDIT_SETTING, SNIPPETS_SETTING } from "../constants.mjs";
```

  - Delete the registration block (lines 35-40):

```js
  game.settings.register(MODULE_ID, THUMBNAILS_SETTING, {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

```

- [ ] **Step 6: Rewrite the e2e thumbnail test.** In `tests/e2e/19-hub-timeline-links.spec.mjs`, replace the whole "thumbnail toggle" test (lines 126-141) with one that asserts thumbnails render by default and there is no toggle:

```js
  test("image links render as thumbnails by default with no toggle", async () => {
    const gmHub = gmPage.locator("#campaign-hub");
    await expect(gmHub.locator('button[data-action="toggleThumbnails"]')).toHaveCount(0);
    await expect(gmHub.locator(".link-chip img.link-thumb").first()).toBeVisible({ timeout: 10_000 });
  });
```

- [ ] **Step 7: Confirm no stray references remain.**

Run: `grep -rn "THUMBNAILS_SETTING\|toggleThumbnails\|context.thumbnails\|timelineThumbnails" scripts/ templates/`
Expected: no output.

- [ ] **Step 8: Verify vitest is green.**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 9: Verify in the app (manual/e2e harness).** Timeline link chips that resolve to an image show the image thumbnail immediately; there is no "toggle thumbnail view" button in the timeline tools.

- [ ] **Step 10: Commit.**

```bash
git add scripts/apps/hub/hub-mixin.mjs templates/hub/timeline.hbs scripts/constants.mjs scripts/hooks/hub-ui.mjs tests/e2e/19-hub-timeline-links.spec.mjs
git commit -m "feat(hub): timeline thumbnails always on; remove the toggle and its setting"
```

---

### Task 9: Inline view is the default; hide the edit-toggle when redundant

**Files:**
- Modify: `scripts/logic/inline-edit.mjs` (add `shouldShowEditToggle`)
- Test: `tests/inline-edit.test.js` (extend)
- Modify: `scripts/apps/hub/hub-mixin.mjs`
- Modify: `templates/hub/record.hbs`
- Modify: `tests/e2e/05-hub.spec.mjs`

**Interfaces:**
- Produces: `shouldShowEditToggle({ canEdit, inViewMode, inlineEditableView })` → boolean; `context.view.showEditToggle`.

- [ ] **Step 1: Write the failing unit test.** In `tests/inline-edit.test.js`, add (import `shouldShowEditToggle` alongside the existing imports at the top of the file):

```js
import { shouldShowEditToggle } from "../scripts/logic/inline-edit.mjs";

describe("shouldShowEditToggle", () => {
  it("hides the toggle for an inline-editable typed entry in view mode", () => {
    expect(shouldShowEditToggle({ canEdit: true, inViewMode: true, inlineEditableView: true })).toBe(false);
  });
  it("shows the toggle when the view is not inline-editable (text page / inline off)", () => {
    expect(shouldShowEditToggle({ canEdit: true, inViewMode: true, inlineEditableView: false })).toBe(true);
  });
  it("shows the toggle while in edit mode so the user can return to view", () => {
    expect(shouldShowEditToggle({ canEdit: true, inViewMode: false, inlineEditableView: true })).toBe(true);
  });
  it("never shows the toggle without update permission", () => {
    expect(shouldShowEditToggle({ canEdit: false, inViewMode: true, inlineEditableView: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**

Run: `npx vitest run tests/inline-edit.test.js`
Expected: FAIL (`shouldShowEditToggle` is not exported).

- [ ] **Step 3: Implement the helper.** In `scripts/logic/inline-edit.mjs`, after `computeInlineEdit` (ends line 13), add:

```js
/**
 * Should the pane header show the manual edit-toggle for the viewed record?
 * Hidden only when the view is already inline-editable (a typed entry, inline
 * editing on) and we are in view mode — there is nothing to switch to. Kept for
 * text pages, inline-off, no inline path, and while in edit mode (as the
 * "done editing" affordance). Requires update permission in every case.
 */
export function shouldShowEditToggle({ canEdit, inViewMode, inlineEditableView }) {
  if (!canEdit) return false;
  return !(inViewMode && inlineEditableView);
}
```

- [ ] **Step 4: Run the test to confirm it passes.**

Run: `npx vitest run tests/inline-edit.test.js`
Expected: PASS.

- [ ] **Step 5: New records open in view mode.** In `scripts/apps/hub/hub-mixin.mjs` `#onNewRecord`, replace line 371:

```js
      await this.navigateToRecord(page.uuid, { mode: "edit" });
```

with:

```js
      await this.navigateToRecord(page.uuid);
```

- [ ] **Step 6: Import the constants + helper.** In `scripts/apps/hub/hub-mixin.mjs`:
  - Add `GROUP_SHEET_CLASS` to the constants import (lines 3-5) so it reads:

```js
import {
  MODULE_ID, RAIL_SETTING, INLINE_EDIT_SETTING, SNIPPETS_SETTING, RECORD_TYPES, typeId, GROUP_SHEET_CLASS
} from "../../constants.mjs";
```

  - Extend the inline-edit import (line 6):

```js
import { hasInlineFocus, shouldShowEditToggle } from "../../logic/inline-edit.mjs";
```

- [ ] **Step 7: Compute `showEditToggle` in context.** In `_prepareContext`, replace the `context.view` assignment (lines 675-681):

```js
      context.view = this.state.view && viewedPage
        ? {
            name: viewedPage.name,
            editing: this.state.view.mode === "edit",
            canEdit: viewedPage.canUserModify(game.user, "update")
          }
        : null;
```

with (add the inline-editable predicate and the toggle gate):

```js
      if (this.state.view && viewedPage) {
        const canEdit = viewedPage.canUserModify(game.user, "update");
        const inlineEditableView =
          game.settings.get(MODULE_ID, INLINE_EDIT_SETTING) &&
          canEdit &&
          viewedPage.type.startsWith(`${MODULE_ID}.`) &&
          viewedPage.parent?.getFlag("core", "sheetClass") === GROUP_SHEET_CLASS;
        context.view = {
          name: viewedPage.name,
          editing: this.state.view.mode === "edit",
          canEdit,
          showEditToggle: shouldShowEditToggle({
            canEdit,
            inViewMode: this.state.view.mode !== "edit",
            inlineEditableView
          })
        };
      } else {
        context.view = null;
      }
```

- [ ] **Step 8: Gate the edit-toggle in the template.** In `templates/hub/record.hbs`, replace the edit-toggle guard (line 10):

```hbs
    {{#if view.canEdit}}
```

with:

```hbs
    {{#if view.showEditToggle}}
```

- [ ] **Step 9: Update the "New Entry beside Edit" e2e test.** In `tests/e2e/05-hub.spec.mjs`, the test at lines 52-78 asserts the edit-toggle is visible next to New Entry for a viewed NPC. With inline editing on (default), a typed NPC is inline-editable so the toggle is now hidden. Replace lines 65-75:

```js
    await hub.locator(".record-row", { hasText: "E2E Hub Nav Npc" }).click();
    const header = hub.locator(".hub-record.active .record-pane-header");
    await expect(header.locator('[data-action="newRecord"]')).toBeVisible();
    await expect(header.locator('[data-action="toggleEditMode"]')).toBeVisible();

    // New Entry must render immediately before the edit-toggle button so it
    // sits beside Edit, not bundled with Back/Forward on the other end.
    const newButtonFollowedByEdit = await header
      .locator('[data-action="newRecord"]')
      .evaluate((el) => el.nextElementSibling?.dataset.action === "toggleEditMode");
    expect(newButtonFollowedByEdit).toBe(true);
```

with:

```js
    await hub.locator(".record-row", { hasText: "E2E Hub Nav Npc" }).click();
    const header = hub.locator(".hub-record.active .record-pane-header");
    await expect(header.locator('[data-action="newRecord"]')).toBeVisible();
    // A typed entry is inline-editable (default), so no manual edit-toggle is shown.
    await expect(header.locator('[data-action="toggleEditMode"]')).toHaveCount(0);
```

Also update the test title on line 52 from `"New Entry sits in the timeline tools by default and beside Edit when viewing"` to `"New Entry sits in the timeline tools and pane header; typed entries show no edit-toggle"`.

- [ ] **Step 10: Verify vitest is green.**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 11: Verify in the app (manual/e2e harness).** Opening a typed entry (default inline on) shows an editable view with no pen/edit-toggle and no Save buttons; creating a new entry lands directly in that editable view. A text/journal page still shows the edit-toggle, and turning inline editing off restores the edit-toggle on typed entries.

- [ ] **Step 12: Commit.**

```bash
git add scripts/logic/inline-edit.mjs tests/inline-edit.test.js scripts/apps/hub/hub-mixin.mjs templates/hub/record.hbs tests/e2e/05-hub.spec.mjs
git commit -m "feat(hub): typed entries stay in the inline auto-save view; hide redundant edit-toggle"
```

---

### Task 10: Inline editor fills the pane and resizes

**Files:**
- Modify: `styles/campaign-record.css`

- [ ] **Step 1: Establish a flex height chain to the editor.** In `styles/campaign-record.css`, replace the inline-edit prose-mirror sizing rule (lines 516-522):

```css
/* Core lays the active editor out as a flex column (menu + flex:1
   .editor-container holding an absolutely-positioned .editor-content).
   Overriding display would collapse the container to zero height and clip
   the content unclickable — size it via core's own --min-height instead. */
.campaign-record-content.inline-edit prose-mirror {
  --min-height: 8rem;
}
```

with a chain that lets the description editor grow to fill the pane while keeping core's own editor layout intact:

```css
/* Height chain: the mounted view sheet fills the pane so the description
   editor can grow with the window instead of collapsing to a few lines.
   Core lays the active editor out as a flex column (menu + flex:1
   .editor-container holding an absolutely-positioned .editor-content); we
   size via core's own --min-height and let the container flex, never
   overriding the editor's display. */
.campaign-hub .record-pane-mount > .record-pane-sheet,
.campaign-record-content.inline-edit {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.campaign-record-content.inline-edit {
  flex: 1;
}
.campaign-record-content.inline-edit .record-description {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.campaign-record-content.inline-edit prose-mirror {
  --min-height: 12rem;
  flex: 1;
  min-height: 0;
}
```

- [ ] **Step 2: Verify vitest is green.**

Run: `npx vitest run`
Expected: PASS (CSS-only; confirms nothing else broke).

- [ ] **Step 3: Verify in the app (manual/e2e harness).** Open a typed entry in the inline view and resize the window taller: the description editor grows to fill the available pane height rather than staying a short fixed box, and remains scrollable when content overflows. Confirm `tests/e2e/18-inline-edit.spec.mjs` still passes in the harness.

- [ ] **Step 4: Commit.**

```bash
git add styles/campaign-record.css
git commit -m "fix(hub): inline record editor fills the pane and resizes with the window"
```

---

## Self-Review

**Spec coverage:**
- A1 header name/gear → Task 2. A2 window title → Task 1. A3 snippets → Task 6.
- B1 dropdown contrast → Task 3. B2 sort popup → Task 4. B3 remove hidden-only → Task 5.
- C1 inline default + edit-toggle gate → Task 9. C2 editor height → Task 10. C3 save buttons gone → consequence of Task 9 (verified in Task 9 Step 11).
- D1 entry-list thumbnails → Task 7. D2 timeline thumbnails + D3 remove toggle → Task 8.
- All 10 acceptance criteria map to a task.

**Type/name consistency:** `buildSortMenu`/`SORT_KEYS` (Task 4), `shouldShowEditToggle` (Task 9), `context.headerTitle` (Task 2), `context.sortMenu`/`state.sortMenuOpen` (Task 4), `context.view.showEditToggle` (Task 9) are defined where produced and consumed by name in the same task's template/handler.

**Placeholders:** none — every code step shows the exact before/after.

**Known follow-up (flagged for user):** C3's text-page / inline-off retention of the edit-toggle is an implementation-driven refinement of the original "remove the edit sheet entirely" wording; the spec Section C was updated to match. Opening a record page *outside* the hub (its own sheet) still uses Foundry's default edit mode — out of scope per the spec.
