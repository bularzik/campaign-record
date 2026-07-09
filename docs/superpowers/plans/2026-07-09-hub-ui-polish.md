# Campaign Hub UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Campaign Hub compact and readable: horizontal pill type-chips, a clear-filters control with filtered count, aligned zebra-striped record rows, hover-revealed timeline edit buttons, and consistent search styling.

**Architecture:** Template restructure of the Index tab controls (`index.hbs`) plus a small `clearFilters` action and count context in `campaign-hub.mjs`; everything else is CSS in `styles/campaign-record.css`. Spec: `docs/superpowers/specs/2026-07-09-hub-ui-polish-design.md`.

**Tech Stack:** Foundry VTT v13 ApplicationV2/Handlebars, plain CSS, Playwright e2e, vitest.

## Global Constraints

- **Work in the worktree:** `/Users/danbularzik/Claude/Projects/campaign-record/campaign-record/.claude/worktrees/hub-ui-polish` on branch `feature/hub-ui-polish`. All file paths below are relative to it. Never touch the main checkout — another session is using it.
- **No new dependencies.** CSS + template + minimal JS only.
- **Every user-visible string is localized** via `lang/en.json`; `tests/i18n-coverage.test.js` fails the build on unresolved keys (it regex-extracts `{{localize "KEY"}}`, `data-tooltip="CAMPAIGNRECORD..."`, and `game.i18n.localize/format("KEY")` from templates/scripts).
- **Root cause context:** Foundry v13 base styles give `button` and `input` 100% width. Full-width flex children defeat `flex-wrap` (each item's flex-basis fills the row). Fixes must set `width: auto` / explicit flex properties, matching the existing override pattern at `.campaign-hub .timepoint-head button`.
- **E2E environment:** Playwright drives a local Foundry v13 server (`world-b`), started automatically by global setup. **One runner at a time** — no other browser or test run may be logged into the test world (coordinate with the other session before running e2e). The Foundry data dir symlink `/Users/danbularzik/FoundryVTT/Data/Data/modules/campaign-record` points at the **main checkout**; every e2e run in this plan must first repoint it to the worktree, and Task 6 restores it. Playwright treats `opacity: 0` elements as visible/clickable (only `visibility: hidden`/`display: none` block actionability), so hover-reveal CSS does not break existing click-based specs.
- **Commit style:** conventional prefixes (`feat:`, `test:`, `chore:`), trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

**One-time setup (fold into Task 1, step 1):**

```bash
cd /Users/danbularzik/Claude/Projects/campaign-record/campaign-record/.claude/worktrees/hub-ui-polish
npm install
# Repoint the Foundry module symlink at this worktree for e2e runs:
ln -sfn "$PWD" /Users/danbularzik/FoundryVTT/Data/Data/modules/campaign-record
```

---

### Task 1: Horizontal compact type chips

**Files:**
- Modify: `templates/hub/index.hbs:2-8` (split chips out of `.index-controls`)
- Modify: `styles/campaign-record.css:54-66` (chips row, pill chips, controls row flex fixes)
- Test: `tests/e2e/06-hub-index.spec.mjs`

**Interfaces:**
- Consumes: existing context `typeChips` (`[{type, label, active}]`), action `filterType` — unchanged.
- Produces: markup structure `div.type-chips` (chip row) followed by `div.index-controls` (controls row) inside `section.hub-index`. Task 2 inserts the clear-filters button and count into `div.index-controls`. CSS classes `.type-chip`, `.hidden-toggle` keep their names (e2e specs 06/15 select on them).

- [ ] **Step 1: One-time worktree setup**

```bash
cd /Users/danbularzik/Claude/Projects/campaign-record/campaign-record/.claude/worktrees/hub-ui-polish
npm install
ln -sfn "$PWD" /Users/danbularzik/FoundryVTT/Data/Data/modules/campaign-record
```

Expected: `npm install` completes; `ls -l /Users/danbularzik/FoundryVTT/Data/Data/modules/campaign-record` shows the symlink targeting the worktree.

- [ ] **Step 2: Write the failing e2e test**

Append inside the `test.describe("hub index", ...)` block of `tests/e2e/06-hub-index.spec.mjs`, after the `"lists records and filters by type chip"` test:

```js
  test("type chips render as compact pills on shared rows", async () => {
    const chips = gmPage.locator("#campaign-hub .type-chip");
    const first = await chips.nth(0).boundingBox();
    const second = await chips.nth(1).boundingBox();
    // Same row: full-width buttons would stack each chip on its own line.
    expect(second.y).toBe(first.y);
    expect(second.x).toBeGreaterThan(first.x);
    // Compact: a pill, not a 760px-wide bar.
    expect(first.width).toBeLessThan(150);
  });
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx playwright test tests/e2e/06-hub-index.spec.mjs
```

Expected: the new test FAILS on `expect(second.y).toBe(first.y)` (chips currently stack vertically); the three pre-existing tests in the file PASS.

- [ ] **Step 4: Restructure the template**

Replace lines 2–8 of `templates/hub/index.hbs` (the `<div class="index-controls">` opening tag and the whole `<span class="type-chips">…</span>` block) so the file begins:

```hbs
<section class="tab hub-index{{#if tabs.index.active}} active{{/if}}" data-group="primary" data-tab="index">
  <div class="type-chips">
    {{#each typeChips}}
    <button type="button" class="type-chip {{#if this.active}}active{{/if}}"
            data-action="filterType" data-type="{{this.type}}">{{this.label}}</button>
    {{/each}}
  </div>
  <div class="index-controls">
    <input type="text" name="tag-filter" value="{{state.tag}}"
           placeholder="{{localize "CAMPAIGNRECORD.Hub.FilterTag"}}">
```

Everything from the `<input>` on (sort select, hidden toggle, New Record, closing `</div>`, record list) stays exactly as it is today.

- [ ] **Step 5: Restyle chips row and controls row**

In `styles/campaign-record.css`, replace the current blocks at lines 54–66 (`.campaign-hub .index-controls` and the `.type-chip.active/.hidden-toggle.active` rule) with:

```css
.campaign-hub .type-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}

.campaign-hub .type-chip {
  width: auto;
  line-height: 1.2;
  padding: 0.15rem 0.6rem;
  font-size: var(--font-size-12, 12px);
  border-radius: 1rem;
}

.campaign-hub .index-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.5rem;
}

.campaign-hub .index-controls input[name="tag-filter"] {
  width: auto;
  flex: 1 1 8rem;
  min-width: 8rem;
  max-width: 16rem;
}

.campaign-hub .index-controls select[name="sort-select"] {
  width: auto;
  flex: 0 0 auto;
}

.campaign-hub .index-controls button {
  width: auto;
  flex: 0 0 auto;
}

.campaign-hub .index-controls button[data-action="newRecord"] {
  margin-left: auto;
}

.campaign-hub .type-chip.active,
.campaign-hub .hidden-toggle.active {
  background: var(--color-warm-2, #c9593f);
  color: #fff;
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx playwright test tests/e2e/06-hub-index.spec.mjs
```

Expected: all 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add templates/hub/index.hbs styles/campaign-record.css tests/e2e/06-hub-index.spec.mjs
git commit -m "feat: compact horizontal type chips in hub index

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Clear-filters button + filtered count

**Files:**
- Modify: `scripts/apps/hub/campaign-hub.mjs` (`DEFAULT_OPTIONS.actions` ~line 29, `#indexEntries` ~line 147, new `#onClearFilters`, `_prepareContext` ~line 348)
- Modify: `templates/hub/index.hbs` (controls row, before the New Record button)
- Modify: `lang/en.json` (two keys in the `Hub` block)
- Test: `tests/e2e/06-hub-index.spec.mjs`

**Interfaces:**
- Consumes: `div.index-controls` structure from Task 1; existing `state` object (`types: Set`, `tag: string`, `hiddenOnly: boolean`).
- Produces: action `clearFilters`; context keys `hasActiveFilters: boolean`, `filteredCount: number`, `totalCount: number`; i18n keys `CAMPAIGNRECORD.Hub.ClearFilters` and `CAMPAIGNRECORD.Hub.FilteredCount` (format args `{shown}`, `{total}`); markup `span.filtered-count` and `button.clear-filters` rendered only while a type/tag/hidden filter is active.

- [ ] **Step 1: Write the failing e2e test**

Append inside the `test.describe` block of `tests/e2e/06-hub-index.spec.mjs`:

```js
  test("clear filters resets type, tag, and hidden-only in one click", async () => {
    const hub = gmPage.locator("#campaign-hub");
    // No filters active: control is absent.
    await expect(hub.locator(".clear-filters")).toHaveCount(0);
    await expect(hub.locator(".filtered-count")).toHaveCount(0);

    await hub.locator('.type-chip[data-type="quest"]').click();
    await hub.locator('input[name="tag-filter"]').fill("no-such-tag");
    await expect(hub.locator(".record-row")).toHaveCount(0);
    await expect(hub.locator(".filtered-count")).toBeVisible();
    // Count reflects the filtered list: "0 of N" while nothing matches.
    await expect(hub.locator(".filtered-count")).toHaveText(/^0 of \d+$/);

    await hub.locator(".clear-filters").click();
    await expect(hub.locator(".clear-filters")).toHaveCount(0);
    await expect(hub.locator('input[name="tag-filter"]')).toHaveValue("");
    await expect(hub.locator('.type-chip[data-type="quest"]')).not.toHaveClass(/active/);
    await expect(hub.locator(".record-row", { hasText: "E2E Index NPC" })).toBeVisible();
  });
```

Note: don't assert exact counts in `.filtered-count` — the "all groups" scope can include leftovers from other specs.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx playwright test tests/e2e/06-hub-index.spec.mjs
```

Expected: new test FAILS (`.filtered-count` never becomes visible — element doesn't exist). Prior tests PASS.

- [ ] **Step 3: Add i18n keys**

In `lang/en.json`, inside the `"Hub"` object, after the `"HiddenOnly"` line add:

```json
      "ClearFilters": "Clear filters",
      "FilteredCount": "{shown} of {total}",
```

- [ ] **Step 4: Implement app changes**

In `scripts/apps/hub/campaign-hub.mjs`:

(a) Register the action in `DEFAULT_OPTIONS.actions` (after `toggleHiddenOnly`):

```js
      toggleHiddenOnly: CampaignHub.#onToggleHiddenOnly,
      clearFilters: CampaignHub.#onClearFilters,
```

(b) Change `#indexEntries` to also report the unfiltered total (single `collectRecords` call):

```js
  #indexEntries() {
    const all = collectRecords({ groupId: this.state.groupId, user: game.user });
    let records = all;
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
    return { records: records.sort(sorters[this.state.sort] ?? sorters.name), total: all.length };
  }
```

(c) Add the action handler next to `#onToggleHiddenOnly`:

```js
  static #onClearFilters() {
    this.state.types.clear();
    this.state.tag = "";
    this.state.hiddenOnly = false;
    this.render();
  }
```

(d) In `_prepareContext`, replace `context.records = this.#indexEntries();` with:

```js
    const { records, total } = this.#indexEntries();
    context.records = records;
    context.filteredCount = records.length;
    context.totalCount = total;
    context.hasActiveFilters = this.state.types.size > 0 || !!this.state.tag || this.state.hiddenOnly;
```

- [ ] **Step 5: Add the controls to the template**

In `templates/hub/index.hbs`, immediately before the New Record button inside `div.index-controls`, insert:

```hbs
    {{#if hasActiveFilters}}
    <span class="filtered-count">{{localize "CAMPAIGNRECORD.Hub.FilteredCount" shown=filteredCount total=totalCount}}</span>
    <button type="button" class="clear-filters" data-action="clearFilters"
            data-tooltip="CAMPAIGNRECORD.Hub.ClearFilters">
      <i class="fa-solid fa-filter-circle-xmark"></i>
    </button>
    {{/if}}
```

And in `styles/campaign-record.css`, after the `.index-controls button` rule add:

```css
.campaign-hub .filtered-count {
  font-size: var(--font-size-12, 12px);
  opacity: 0.8;
  white-space: nowrap;
}
```

- [ ] **Step 6: Run e2e and the i18n gate to verify they pass**

```bash
npx playwright test tests/e2e/06-hub-index.spec.mjs
npx vitest run tests/i18n-coverage.test.js
```

Expected: all 5 e2e tests PASS; i18n coverage PASSES (both new keys resolve).

- [ ] **Step 7: Commit**

```bash
git add scripts/apps/hub/campaign-hub.mjs templates/hub/index.hbs lang/en.json tests/e2e/06-hub-index.spec.mjs
git commit -m "feat: clear-filters control with filtered count in hub index

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Record list readability (CSS only)

**Files:**
- Modify: `styles/campaign-record.css` (`.record-row` block, ~line 74)

**Interfaces:**
- Consumes: `.record-row` grid markup from `index.hbs` (icon/img, `.record-name`, `.record-subtitle`, `.record-type`, `.record-group`) — unchanged.
- Produces: nothing consumed downstream; purely visual.

- [ ] **Step 1: Update the CSS**

Replace the `.campaign-hub .record-row` and `.campaign-hub .record-row:hover` blocks with:

```css
.campaign-hub .record-row {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr) minmax(0, 12rem) 4.5rem 8rem;
  gap: 0.5rem;
  align-items: center;
  padding: 0.2rem 0.5rem;
  cursor: pointer;
}

.campaign-hub .record-row:nth-child(even) {
  background: rgba(255, 255, 240, 0.05);
}

.campaign-hub .record-row:hover {
  background: var(--color-hover-bg, rgba(255, 255, 240, 0.1));
}

.campaign-hub .record-row .record-name,
.campaign-hub .record-row .record-subtitle,
.campaign-hub .record-row .record-type,
.campaign-hub .record-row .record-group {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Rationale: fixed widths for the trailing columns (`12rem` subtitle, `4.5rem` type, `8rem` group) make columns align down the list instead of `auto`-sizing per row; the zebra tint reuses the hover color at half strength so it works on Foundry's dark app theme.

- [ ] **Step 2: Verify against existing specs**

```bash
npx playwright test tests/e2e/06-hub-index.spec.mjs tests/e2e/15-hub-types.spec.mjs
```

Expected: PASS (row markup and selectors unchanged; only presentation moved).

- [ ] **Step 3: Commit**

```bash
git add styles/campaign-record.css
git commit -m "feat: zebra striping and aligned columns in hub record list

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Timeline cleanup (CSS only)

**Files:**
- Modify: `styles/campaign-record.css` (`.timepoint-head button` block, ~line 145)

**Interfaces:**
- Consumes: `.timepoint`, `.timepoint-head button`, and the group-level `button[data-action="addTimepoint"]` markup from `timeline.hbs` — unchanged.
- Produces: purely visual. E2E note: `08-hub-timeline.spec.mjs` clicks `button[data-action="addTimepoint"]` and timepoint-head buttons; Playwright considers `opacity: 0` elements visible and clickable, so no test changes are needed.

- [ ] **Step 1: Update the CSS**

Replace the `.campaign-hub .timepoint-head button` block with:

```css
.campaign-hub .timepoint-head button {
  width: auto;
  line-height: 1;
  padding: 0.15rem 0.35rem;
  opacity: 0;
  transition: opacity 0.15s ease-in-out;
}

.campaign-hub .timepoint:hover .timepoint-head button,
.campaign-hub .timepoint-head button:focus-visible {
  opacity: 1;
}

.campaign-hub .timeline-group > button[data-action="addTimepoint"] {
  width: auto;
}
```

- [ ] **Step 2: Verify against the timeline spec**

```bash
npx playwright test tests/e2e/08-hub-timeline.spec.mjs
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add styles/campaign-record.css
git commit -m "feat: hover-reveal timepoint controls, auto-width add button

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Search tab touch-up (CSS only)

**Files:**
- Modify: `styles/campaign-record.css` (after the `.hit-snippet` block, ~line 120)

**Interfaces:**
- Consumes: `.result-type` sections with `h3` + `ol` of `li.search-hit` from `search.hbs` — unchanged.
- Produces: purely visual.

- [ ] **Step 1: Add the CSS**

After the `.campaign-hub .hit-snippet` block, add:

```css
.campaign-hub .result-type h3 {
  font-size: var(--font-size-14, 14px);
  margin: 0.5rem 0 0.25rem;
  padding-bottom: 0.15rem;
  border-bottom: 1px solid var(--color-border-light-primary, #7a7971);
}

.campaign-hub .result-type ol {
  list-style: none;
  margin: 0;
  padding: 0;
}

.campaign-hub .search-hit:nth-child(even) {
  background: rgba(255, 255, 240, 0.05);
}
```

- [ ] **Step 2: Verify against the search spec**

```bash
npx playwright test tests/e2e/07-hub-search.spec.mjs
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add styles/campaign-record.css
git commit -m "feat: consistent search result styling in hub

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Full verification + environment restore

**Files:**
- None created/modified (fix regressions if any surface, in the task that owns them).

**Interfaces:**
- Consumes: all prior tasks.
- Produces: green suite; Foundry symlink restored to the main checkout.

- [ ] **Step 1: Full unit suite**

```bash
npx vitest run
```

Expected: all unit tests PASS (i18n coverage, migrations, presenter, search-index, timeline-sort, visibility).

- [ ] **Step 2: Full e2e suite**

```bash
npm run test:e2e
```

Expected: all 19 spec files PASS. (Coordinate with the other session first — one runner at a time.)

- [ ] **Step 3: Visual sanity screenshot**

With the server still up from the e2e run (or start it per `tests/e2e/README.md`), open the hub as Gamemaster and screenshot the Index, Timeline, and Search tabs to confirm: chips in ~2 rows, one controls row, aligned zebra rows, timeline buttons hidden until hover. This is a human-eye check for the parts automation can't judge (taste).

- [ ] **Step 4: Restore the module symlink to the main checkout**

```bash
ln -sfn /Users/danbularzik/Claude/Projects/campaign-record/campaign-record \
  /Users/danbularzik/FoundryVTT/Data/Data/modules/campaign-record
```

Expected: `ls -l` shows the symlink back on the main checkout.

- [ ] **Step 5: Commit any stragglers and verify clean tree**

```bash
git status --short
```

Expected: empty output on branch `feature/hub-ui-polish`.
