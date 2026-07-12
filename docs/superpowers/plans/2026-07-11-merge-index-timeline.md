# Merge Index + Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the Campaign Hub's Index and Timeline tabs into one always-on two-pane display — full index on the left (collapsible), timeline in the right pane, and an opened entry overlaying the timeline.

**Architecture:** v1.2.6 already renders a two-column CSS grid (`index | record`) under `.viewing-record`, hiding the timeline. This plan makes that grid **always-on**, keeps `.hub-timeline` persistent in the right cell, overlays `.hub-record` on top when an entry is open, moves the collapse toggle into the always-present index, relocates New Entry to a shared right-pane nav, and groups the index only when Sort = Type. It is a template + CSS + small mixin refactor; the search engine, timeline data model, entry sheets, and pane history are untouched.

**Tech Stack:** Foundry VTT v13 `ApplicationV2` + `HandlebarsApplicationMixin`, Handlebars templates/partials, plain CSS, Playwright e2e, Vitest (logic only).

## Global Constraints

- Foundry VTT **v13+**; module id **`campaign-record`**; template paths are `modules/campaign-record/templates/...`.
- The four hub parts (`.hub-header`, `.hub-index`, `.hub-timeline`, `.hub-record`) are direct children of `.window-content`. Do not introduce a wrapper element around them — layout is done on `.window-content` as a grid.
- Preserve the inline-edit deferred-render protection: never remove or bypass the `hasInlineFocus(mount)` guard in `render()`.
- Preserve GM visibility, hidden-entry handling, and permission checks (`canUserModify`, `testUserPermission`) exactly as they are.
- Reuse existing i18n keys where present (`CAMPAIGNRECORD.Hub.NewRecord` = "New Entry", `...ToggleRail` = "Toggle entry list"). Add new keys only where noted, in `lang/en.json`.
- e2e runs are governed by the **foundry-e2e** skill (shared install, session lock). Read it before any `npx playwright` run.

---

### Task 1: Always-on two-pane grid; timeline persistent; record overlays

Make the hub render index-left + timeline-right at all times, with an opened record overlaying the timeline. Removes the tab system.

**Files:**
- Modify: `templates/hub/header.hbs` (remove tab nav)
- Modify: `templates/hub/index.hbs:1` (root `<section>` classes)
- Modify: `templates/hub/timeline.hbs:1` (root `<section>` classes)
- Modify: `templates/hub/record.hbs:1` (root `<section>` `active` class already present)
- Modify: `scripts/apps/hub/hub-mixin.mjs` (remove `TABS`, tab-nav binding)
- Modify: `styles/campaign-record.css` (always-grid, overlay, retire tab rules)
- Test: `tests/e2e/05-hub.spec.mjs`

**Interfaces:**
- Consumes: existing `state.view` (`{uuid, mode}` | undefined), `context.view` (`{name, editing, canEdit}` | null), `.record-pane-mount`, `.rail-collapsed`/`.viewing-record` root classes set in `_onRender`.
- Produces: `.window-content` is always a grid; `.hub-record.active` overlays `.hub-timeline`. Root class `.viewing-record` still reflects `!!state.view` (kept for the overlay + narrow-row rules).

- [ ] **Step 1: Update the e2e expectation (write the failing assertion)**

In `tests/e2e/05-hub.spec.mjs`, replace any test that clicks the Index/Timeline tab nav or asserts `.tab.active` with an assertion that both panes are visible at once. Add near the existing hub-open test:

```js
test("hub shows index and timeline side by side with no tabs", async () => {
  await openHub(page); // existing helper that opens the Campaign Hub
  await expect(page.locator(".campaign-hub .hub-header nav.tabs")).toHaveCount(0);
  await expect(page.locator(".campaign-hub .hub-index")).toBeVisible();
  await expect(page.locator(".campaign-hub .hub-timeline")).toBeVisible();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Read the foundry-e2e skill, then run:
Run: `npx playwright test tests/e2e/05-hub.spec.mjs -g "side by side"`
Expected: FAIL — the tab nav still exists and `.hub-timeline` is hidden outside timeline tab.

- [ ] **Step 3: Remove the tab nav from the header**

In `templates/hub/header.hbs`, delete the entire `<nav class="tabs">…</nav>` block (lines 23–29). Leave the group select, import, export, and inline-edit toggle.

- [ ] **Step 4: Drop tab classes from the part roots**

In `templates/hub/index.hbs` line 1, change:
```hbs
<section class="tab hub-index{{#if tabs.index.active}} active{{/if}}" data-group="primary" data-tab="index">
```
to:
```hbs
<section class="hub-index">
```

In `templates/hub/timeline.hbs` line 1, change:
```hbs
<section class="tab hub-timeline{{#if tabs.timeline.active}} active{{/if}}" data-group="primary" data-tab="timeline">
```
to:
```hbs
<section class="hub-timeline">
```

(`record.hbs` already uses `<section class="hub-record {{#if view}}active{{/if}}">` — leave it.)

- [ ] **Step 5: Remove the TABS static and tab-nav binding from the mixin**

In `scripts/apps/hub/hub-mixin.mjs`:

Delete the `static TABS = { … };` block (lines 72–81).

Delete the tab-nav binding block in `_onRender` (the block beginning `// Dragging a record from the Index tab needs a way to reach a Timeline` through its closing `}`, lines ~711–725):
```js
      const tabNav = this.element.querySelector(".hub-header nav.tabs");
      if (tabNav && !tabNav.dataset.crBound) { … }
```
Records can now be dragged straight from the always-visible index to a timeline drop target, so the tab-hover shim is obsolete. The `.hub-header nav.tabs` click→`navigateToIndex` shim goes with it; navigating home is handled by Back and by clicking a timeline chip.

- [ ] **Step 6: Make `.window-content` always the grid, with the record overlaying the timeline**

In `styles/campaign-record.css`:

Delete the tab rules (lines 43–52):
```css
.campaign-hub .tab { … }
.campaign-hub .tab.active { … }
```

Replace the record-pane block that starts at `/* ---- Hub record pane ---- */` (the `.hub-record` flex rules at lines 518–528 and the `.viewing-record`-scoped grid at lines 558–597) with an always-on grid where timeline and record share the right cell:

```css
/* ---- Hub two-pane layout (index | main), always on ---- */
.campaign-hub .window-content {
  display: grid;
  grid-template-columns: minmax(0, 260px) minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  grid-template-areas:
    "header header"
    "index  main";
  gap: 0 0.5rem;
}
.campaign-hub .hub-header { grid-area: header; }
.campaign-hub .hub-index {
  grid-area: index;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}
/* Timeline and record occupy the same right cell; the record overlays. */
.campaign-hub .hub-timeline,
.campaign-hub .hub-record {
  grid-area: main;
  min-width: 0;
}
.campaign-hub .hub-timeline {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}
/* Record overlay: hidden until an entry is open, then covers the timeline. */
.campaign-hub .hub-record { display: none; }
.campaign-hub .hub-record.active {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--color-bg, var(--dnd5e-color-parchment, #ededed));
  z-index: 1; /* record part follows timeline in DOM; this keeps it on top */
}
```

Keep the existing `.record-pane-header`, `.record-pane-body`, `.record-pane-mount` rules (lines 529–556) as-is.

Generalize the narrow-row rules (lines 589–597) by removing the `.viewing-record` scope, since the index is always narrow now:
```css
/* Narrow left-index rows: icon + name only. */
.campaign-hub .hub-index .record-row {
  grid-template-columns: 1.5rem minmax(0, 1fr);
}
.campaign-hub .hub-index .record-subtitle { display: none; }
.campaign-hub .hub-index .record-row.current {
  background: rgba(0, 0, 0, 0.15);
  font-weight: bold;
}
```

- [ ] **Step 7: Run the e2e assertion to confirm it passes**

Run: `npx playwright test tests/e2e/05-hub.spec.mjs -g "side by side"`
Expected: PASS — no tab nav; both index and timeline visible.

- [ ] **Step 8: Verify the record overlay + Back reveals the timeline**

Add to `tests/e2e/05-hub.spec.mjs`:
```js
test("opening an entry overlays the timeline; Back reveals it", async () => {
  await openHub(page);
  await page.locator(".campaign-hub .hub-index .record-row").first().click();
  await expect(page.locator(".campaign-hub .hub-record.active")).toBeVisible();
  await page.locator('.campaign-hub [data-action="paneBack"]').click();
  await expect(page.locator(".campaign-hub .hub-record.active")).toHaveCount(0);
  await expect(page.locator(".campaign-hub .hub-timeline")).toBeVisible();
});
```
Run: `npx playwright test tests/e2e/05-hub.spec.mjs -g "overlays the timeline"`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add templates/hub/header.hbs templates/hub/index.hbs templates/hub/timeline.hbs scripts/apps/hub/hub-mixin.mjs styles/campaign-record.css tests/e2e/05-hub.spec.mjs
git commit -m "feat: always-on two-pane hub with timeline persistent and record overlay"
```

---

### Task 2: Collapse toggle moves into the index; always available; collapsed strip

The rail toggle currently lives in the record header and only appears when viewing. Move it into the index controls so the index collapses from any state, and make the collapsed index a thin strip that keeps the toggle reachable.

**Files:**
- Modify: `templates/hub/index.hbs` (add toggle to controls)
- Modify: `templates/hub/record.hbs` (remove toggle)
- Modify: `styles/campaign-record.css` (collapsed strip)
- Test: `tests/e2e/21-hub-record-pane.spec.mjs`

**Interfaces:**
- Consumes: `toggleRail` action + `RAIL_SETTING` + root `.rail-collapsed` class (all already wired in the mixin — unchanged).
- Produces: `.hub-index` collapses to a ~40px strip showing only `.rail-toggle`.

- [ ] **Step 1: Update the collapse e2e (write the failing assertion)**

In `tests/e2e/21-hub-record-pane.spec.mjs`, replace the collapse test's setup so it does **not** require an open record. Assert the toggle is reachable and collapsing hides the index rows while keeping the toggle:
```js
test("index collapses from the default view and the toggle stays reachable", async () => {
  await openHub(page);
  const toggle = page.locator('.campaign-hub .hub-index [data-action="toggleRail"]');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator(".campaign-hub")).toHaveClass(/rail-collapsed/);
  await expect(page.locator(".campaign-hub .hub-index .record-list")).toBeHidden();
  await expect(toggle).toBeVisible();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx playwright test tests/e2e/21-hub-record-pane.spec.mjs -g "collapses from the default"`
Expected: FAIL — the toggle lives in the record header, absent on the default view.

- [ ] **Step 3: Add the toggle to the index controls**

In `templates/hub/index.hbs`, inside `<div class="index-controls">` (after the opening tag, before the search input at line 26), add:
```hbs
    <button type="button" class="rail-toggle" data-action="toggleRail"
            data-tooltip="CAMPAIGNRECORD.Hub.ToggleRail"
            aria-label="{{localize "CAMPAIGNRECORD.Hub.ToggleRail"}}">
      <i class="fa-solid fa-angles-left"></i>
    </button>
```

- [ ] **Step 4: Remove the toggle from the record header**

In `templates/hub/record.hbs`, delete the rail-toggle button block (lines 3–8):
```hbs
    {{#if view}}
    <button type="button" class="rail-toggle" data-action="toggleRail" …>
      <i class="fa-solid fa-angles-left"></i>
    </button>
    {{/if}}
```

- [ ] **Step 5: Style the collapsed strip**

In `styles/campaign-record.css`, replace the collapsed-index rules (the block at lines 584–587 that currently reads):
```css
.campaign-hub.viewing-record.rail-collapsed .window-content {
  grid-template-columns: 0 minmax(0, 1fr);
}
.campaign-hub.viewing-record.rail-collapsed .hub-index { display: none; }
```
with an always-on thin strip:
```css
.campaign-hub.rail-collapsed .window-content {
  grid-template-columns: 2.25rem minmax(0, 1fr);
}
/* Collapsed: keep only the toggle; hide filters and the list. */
.campaign-hub.rail-collapsed .hub-index > *:not(.index-controls),
.campaign-hub.rail-collapsed .hub-index .index-controls > *:not(.rail-toggle) {
  display: none;
}
.campaign-hub.rail-collapsed .hub-index .rail-toggle i {
  transform: scaleX(-1); /* point the chevrons the other way when collapsed */
}
```

- [ ] **Step 6: Run the collapse e2e to confirm it passes**

Run: `npx playwright test tests/e2e/21-hub-record-pane.spec.mjs -g "collapses from the default"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add templates/hub/index.hbs templates/hub/record.hbs styles/campaign-record.css tests/e2e/21-hub-record-pane.spec.mjs
git commit -m "feat: collapse the hub index from any view via a toggle in the index controls"
```

---

### Task 3: New Entry relocated to a shared right-pane nav (beside Edit)

Move New Entry out of the index controls into an icon button in the right-pane header, beside Edit when viewing and beside the thumbnails toggle on the timeline. Share back/forward/New across both headers via a partial so history nav works in both states.

**Files:**
- Create: `templates/hub/right-pane-nav.hbs`
- Modify: `scripts/sheets/registration.mjs` (register the partial)
- Modify: `templates/hub/timeline.hbs` (nav in timeline-tools)
- Modify: `templates/hub/record.hbs` (nav in record header; keep title/edit)
- Modify: `templates/hub/index.hbs` (remove New Entry button)
- Modify: `styles/campaign-record.css` (New Entry accent styling optional)
- Test: `tests/e2e/05-hub.spec.mjs`

**Interfaces:**
- Consumes: `canGoBack`, `canGoForward` (context booleans), `newRecord`/`paneBack`/`paneForward` actions (all already wired).
- Produces: partial `campaign-record.hub-right-nav` rendering back/forward/New. `record.hbs` and `timeline.hbs` both include it.

- [ ] **Step 1: Write the placement e2e (failing)**

In `tests/e2e/05-hub.spec.mjs`:
```js
test("New Entry sits in the timeline tools by default and beside Edit when viewing", async () => {
  await openHub(page);
  await expect(page.locator(".campaign-hub .hub-index .index-controls [data-action=\"newRecord\"]")).toHaveCount(0);
  await expect(page.locator(".campaign-hub .hub-timeline [data-action=\"newRecord\"]")).toBeVisible();
  await page.locator(".campaign-hub .hub-index .record-row").first().click();
  const header = page.locator(".campaign-hub .record-pane-header");
  await expect(header.locator('[data-action="newRecord"]')).toBeVisible();
  await expect(header.locator('[data-action="toggleEditMode"]')).toBeVisible();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx playwright test tests/e2e/05-hub.spec.mjs -g "New Entry sits"`
Expected: FAIL — New Entry is still in the index controls.

- [ ] **Step 3: Create the shared right-pane nav partial**

Create `templates/hub/right-pane-nav.hbs`:
```hbs
<button type="button" data-action="paneBack" {{#unless canGoBack}}disabled{{/unless}}
        data-tooltip="CAMPAIGNRECORD.Hub.Back" aria-label="{{localize "CAMPAIGNRECORD.Hub.Back"}}">
  <i class="fa-solid fa-arrow-left"></i>
</button>
<button type="button" data-action="paneForward" {{#unless canGoForward}}disabled{{/unless}}
        data-tooltip="CAMPAIGNRECORD.Hub.Forward" aria-label="{{localize "CAMPAIGNRECORD.Hub.Forward"}}">
  <i class="fa-solid fa-arrow-right"></i>
</button>
<button type="button" class="new-record" data-action="newRecord"
        data-tooltip="CAMPAIGNRECORD.Hub.NewRecord" aria-label="{{localize "CAMPAIGNRECORD.Hub.NewRecord"}}">
  <i class="fa-solid fa-plus"></i>
</button>
```

- [ ] **Step 4: Register the partial**

In `scripts/sheets/registration.mjs`, inside the `loadTemplates({ … })` object in `registerPartials()`, add:
```js
    "campaign-record.hub-right-nav": "modules/campaign-record/templates/hub/right-pane-nav.hbs",
```

- [ ] **Step 5: Use the partial in the record header (keep title/edit)**

Replace the body of `<header class="record-pane-header">` in `templates/hub/record.hbs` so back/forward/New come from the partial and title/edit stay. The header becomes:
```hbs
  <header class="record-pane-header">
    {{> campaign-record.hub-right-nav}}
    {{#if view}}
    <h2 class="record-pane-title">{{view.name}}</h2>
    {{#if view.canEdit}}
    <button type="button" class="edit-toggle" data-action="toggleEditMode"
            data-tooltip="{{#if view.editing}}CAMPAIGNRECORD.Hub.DoneEditing{{else}}CAMPAIGNRECORD.Hub.EditRecord{{/if}}"
            aria-label="{{#if view.editing}}{{localize "CAMPAIGNRECORD.Hub.DoneEditing"}}{{else}}{{localize "CAMPAIGNRECORD.Hub.EditRecord"}}{{/if}}">
      <i class="fa-solid {{#if view.editing}}fa-eye{{else}}fa-pen-to-square{{/if}}"></i>
    </button>
    {{/if}}
    {{/if}}
  </header>
```
(The old inline back/forward buttons are now the partial; delete them.)

- [ ] **Step 6: Use the partial in the timeline tools (keep thumbnails)**

In `templates/hub/timeline.hbs`, change the `<div class="timeline-tools">` block to include the nav before the thumbnails button:
```hbs
  <div class="timeline-tools">
    {{> campaign-record.hub-right-nav}}
    <button type="button" data-action="toggleThumbnails"
            class="{{#if thumbnails}}active{{/if}}"
            data-tooltip="CAMPAIGNRECORD.Hub.ToggleThumbnails">
      <i class="fa-solid fa-image"></i>
    </button>
  </div>
```

- [ ] **Step 7: Remove New Entry from the index controls**

In `templates/hub/index.hbs`, delete the New Entry button block (lines 47–49):
```hbs
    <button type="button" data-action="newRecord">
      <i class="fa-solid fa-plus"></i> {{localize "CAMPAIGNRECORD.Hub.NewRecord"}}
    </button>
```
Also delete the now-unused rule `.campaign-hub .index-controls button[data-action="newRecord"] { margin-left: auto; }` (styles/campaign-record.css lines 130–132).

- [ ] **Step 8: Left-align the timeline tools so New Entry reads as a header action**

In `styles/campaign-record.css`, change `.campaign-hub .timeline-tools { justify-content: flex-end; }` (line 271) to:
```css
  justify-content: flex-start;
  gap: 0.25rem;
  align-items: center;
```

- [ ] **Step 9: Run the placement e2e to confirm it passes**

Run: `npx playwright test tests/e2e/05-hub.spec.mjs -g "New Entry sits"`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add templates/hub/right-pane-nav.hbs scripts/sheets/registration.mjs templates/hub/timeline.hbs templates/hub/record.hbs templates/hub/index.hbs styles/campaign-record.css tests/e2e/05-hub.spec.mjs
git commit -m "feat: move New Entry into a shared right-pane nav beside Edit"
```

---

### Task 4: Group the index only when Sort = Type, with small headers

The left list is flat by default (ordered by the sort). When Sort = Type, render small type-group headers instead. Extract the row markup into a partial so both branches share it.

**Files:**
- Create: `templates/hub/index-row.hbs`
- Modify: `scripts/sheets/registration.mjs` (register the row partial)
- Modify: `scripts/apps/hub/hub-mixin.mjs` (`_prepareContext`: add `grouped` + `recordGroups`)
- Modify: `templates/hub/index.hbs` (branch flat vs. grouped)
- Modify: `styles/campaign-record.css` (`.record-group-header`)
- Test: `tests/e2e/05-hub.spec.mjs`

**Interfaces:**
- Consumes: `#indexEntries()` returns `{ records, total }` where each record has `{uuid, name, shortType, subtitle, icon, typeLabel, hidden, canAttach, current, matches}`; `this.state.sort` is one of `"name" | "type" | "updated"`.
- Produces: `context.grouped` (boolean, true iff `sort === "type"`) and `context.recordGroups` (`[{ label, records }]`, present only when grouped).

- [ ] **Step 1: Write the grouping e2e (failing)**

In `tests/e2e/05-hub.spec.mjs`:
```js
test("the index groups under small type headers only when sorted by type", async () => {
  await openHub(page);
  await expect(page.locator(".campaign-hub .record-group-header")).toHaveCount(0); // default sort = name
  await page.locator('.campaign-hub select[name="sort-select"]').selectOption("type");
  await expect(page.locator(".campaign-hub .record-group-header").first()).toBeVisible();
  await page.locator('.campaign-hub select[name="sort-select"]').selectOption("name");
  await expect(page.locator(".campaign-hub .record-group-header")).toHaveCount(0);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx playwright test tests/e2e/05-hub.spec.mjs -g "groups under small type headers"`
Expected: FAIL — no grouping markup exists.

- [ ] **Step 3: Build the grouped context in the mixin**

In `scripts/apps/hub/hub-mixin.mjs` `_prepareContext`, just after the block that sets `context.records = records.map(...)` (around line 617–620), add:
```js
      context.grouped = this.state.sort === "type";
      if (context.grouped) {
        const groups = [];
        let last = null;
        for (const r of context.records) {
          if (!last || last.shortType !== r.shortType) {
            last = { shortType: r.shortType, label: this.#typeLabel(r.shortType), records: [] };
            groups.push(last);
          }
          last.records.push(r);
        }
        context.recordGroups = groups;
      }
```
The records are already type-sorted (the `"type"` sorter orders by `shortType` then `name`), so a single linear pass groups them correctly.

Add a small private helper next to `#indexEntries` (reusing the localization already inlined in `_prepareContext`):
```js
    #typeLabel(shortType) {
      return shortType === "journal"
        ? game.i18n.localize("CAMPAIGNRECORD.Hub.JournalPage")
        : game.i18n.localize(`TYPES.JournalEntryPage.${typeId(shortType)}`);
    }
```
Then replace the inline `const typeLabel = (t) => …` in `_prepareContext` (lines 626–628) and its use with `this.#typeLabel` so there is one source of truth:
```js
      context.doctypeFilter = buildDoctypeFilter(this.state.types, (t) => this.#typeLabel(t));
```

- [ ] **Step 4: Extract the row partial**

Create `templates/hub/index-row.hbs` with the existing row markup (from `index.hbs` lines 58–72):
```hbs
<li class="record-row{{#if this.current}} current{{/if}}" data-uuid="{{this.uuid}}"
    {{#if this.canAttach}}data-drag-record draggable="true"{{/if}}
    data-action="openRecord">
  <i class="record-type-icon {{this.icon}}" data-tooltip="{{this.typeLabel}}"></i>
  <span class="record-name">{{this.name}}
    {{#if this.hidden}}<i class="fa-solid fa-eye-slash" data-tooltip="CAMPAIGNRECORD.Hidden"></i>{{/if}}
  </span>
  <span class="record-subtitle">{{this.subtitle}}</span>
  {{#if @root.snippets}}{{#if this.matches.length}}
  <div class="record-snippets">
    {{#each this.matches}}
    <span class="hit-snippet"><strong>{{this.field}}:</strong> {{this.snippet}}</span>
    {{/each}}
  </div>
  {{/if}}{{/if}}
</li>
```
Register it in `scripts/sheets/registration.mjs` inside `loadTemplates({ … })`:
```js
    "campaign-record.hub-index-row": "modules/campaign-record/templates/hub/index-row.hbs",
```

- [ ] **Step 5: Branch the list in index.hbs**

Replace the `<ol class="record-list"> … </ol>` block (lines 56–77) with:
```hbs
  <ol class="record-list">
    {{#if grouped}}
      {{#each recordGroups}}
      <li class="record-group-header">{{this.label}}</li>
      {{#each this.records}}{{> campaign-record.hub-index-row}}{{/each}}
      {{/each}}
    {{else}}
      {{#each records}}{{> campaign-record.hub-index-row}}{{/each}}
    {{/if}}
    {{#unless records.length}}
    <li class="hint">{{localize "CAMPAIGNRECORD.Hub.NoRecords"}}</li>
    {{/unless}}
  </ol>
```

- [ ] **Step 6: Style the small group header**

In `styles/campaign-record.css`, add near the record-list rules (after line 143):
```css
.campaign-hub .record-group-header {
  list-style: none;
  margin: 0.4rem 0 0.1rem;
  padding: 0 0.5rem;
  font-size: var(--font-size-11, 11px);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  opacity: 0.7;
}
.campaign-hub .record-group-header:first-child { margin-top: 0.1rem; }
```

- [ ] **Step 7: Run the grouping e2e to confirm it passes**

Run: `npx playwright test tests/e2e/05-hub.spec.mjs -g "groups under small type headers"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add templates/hub/index-row.hbs scripts/sheets/registration.mjs scripts/apps/hub/hub-mixin.mjs templates/hub/index.hbs styles/campaign-record.css tests/e2e/05-hub.spec.mjs
git commit -m "feat: group the hub index by type only when sorted by type"
```

---

### Task 5: Widen default window, sweep dead code, and green the full suite

Bump the default window width for the permanent two-pane layout, remove now-dead CSS/i18n, and reconcile the remaining Hub e2e specs.

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs:38` (`position.width`)
- Modify: `styles/campaign-record.css` (dead-rule sweep)
- Modify: `lang/en.json` (drop unused Tabs keys if unreferenced)
- Test: `tests/e2e/08-hub-timeline.spec.mjs`, `tests/e2e/19-hub-timeline-links.spec.mjs`, `tests/e2e/22-group-hub-sheet.spec.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: default hub width 960; no references to `.tab`, tab nav, or `Tabs` i18n remain.

- [ ] **Step 1: Widen the default window**

In `scripts/apps/hub/hub-mixin.mjs` line 38, change:
```js
      position: { width: 760, height: 640 },
```
to:
```js
      position: { width: 960, height: 640 },
```

- [ ] **Step 2: Reconcile the remaining tab-dependent e2e specs**

In `tests/e2e/08-hub-timeline.spec.mjs`, `19-hub-timeline-links.spec.mjs`, and `22-group-hub-sheet.spec.mjs`, remove any step that clicks the Index/Timeline tab nav (selectors like `[data-tab="timeline"]`, `nav.tabs a`) or waits for `.tab.active`. The timeline is now always visible, so those specs should interact with `.hub-timeline` directly.

Run each and fix assertions until green:
Run: `npx playwright test tests/e2e/08-hub-timeline.spec.mjs tests/e2e/19-hub-timeline-links.spec.mjs tests/e2e/22-group-hub-sheet.spec.mjs`
Expected: PASS (after removing tab-nav interactions).

- [ ] **Step 3: Sweep dead i18n**

Check whether the `Tabs` block is still referenced:
Run: `grep -rn "Hub.Tabs\|labelPrefix\|\.Tabs\." scripts templates`
Expected: no matches. If none, remove the `"Tabs": { … }` block from `lang/en.json` (line ~41).

- [ ] **Step 4: Sweep dead CSS**

Confirm no template still uses classes you retired:
Run: `grep -rn "class=\"tab \|data-tab=\|record-rail\|hub-record .*slim" templates`
Expected: no matches. Remove any leftover `.record-rail`-related rules if present (there should be none after v1.2.6, but verify).

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS (logic tests unaffected).
Run: `npx playwright test tests/e2e/05-hub.spec.mjs tests/e2e/08-hub-timeline.spec.mjs tests/e2e/19-hub-timeline-links.spec.mjs tests/e2e/21-hub-record-pane.spec.mjs tests/e2e/22-group-hub-sheet.spec.mjs`
Expected: PASS.

- [ ] **Step 6: Manual smoke check (real Foundry)**

Open the Campaign Hub and confirm, per the mockup: index left + timeline right with no tabs; Sort = Type groups under small headers, Name/Updated are flat; New `+` sits beside Edit when an entry is open and in the timeline tools otherwise; the entry overlays the timeline and Back reveals it; the collapse toggle shrinks the index to a strip from both the timeline and entry views; dragging an index row onto a timepoint still attaches it.

- [ ] **Step 7: Commit**

```bash
git add scripts/apps/hub/hub-mixin.mjs styles/campaign-record.css lang/en.json tests/e2e/08-hub-timeline.spec.mjs tests/e2e/19-hub-timeline-links.spec.mjs tests/e2e/22-group-hub-sheet.spec.mjs
git commit -m "chore: widen hub window and remove dead tab code after the index/timeline merge"
```

---

## Self-Review

**Spec coverage:**
- Two-pane always-on grid + overlay → Task 1. ✓
- Left index always present, collapsible to a strip, toggle in the index → Task 2. ✓
- Timeline persistent in the right cell, revealed on Back → Task 1. ✓
- New Entry as an icon beside Edit, present in both states → Task 3. ✓
- Flat by default, grouped only when Sort = Type, small headers, compressed rows → Task 4 (rows are the existing compressed icon+name row; subtitle hidden by the narrow-row rule). ✓
- Tabs removed (header nav, TABS static, drag-hover shim) → Tasks 1 & 5. ✓
- Window widened 760 → 960 → Task 5. ✓
- Non-goals (search engine, timeline data model, entry sheets incl. scene picker, groups, pane history) — untouched by every task. ✓
- e2e specs updated → Tasks 1–5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows concrete markup/CSS/JS. e2e steps that say "remove tab-nav interactions" name the exact selectors to remove and give a run/expected pair.

**Type consistency:** `#typeLabel(shortType)` defined once (Task 4) and reused for both `recordGroups` labels and `buildDoctypeFilter`. `context.grouped`/`context.recordGroups` produced in Task 4 and consumed by `index.hbs` in the same task. Partial ids `campaign-record.hub-right-nav` (Task 3) and `campaign-record.hub-index-row` (Task 4) match their `registration.mjs` entries and `{{> …}}` includes. Root classes `.viewing-record`/`.rail-collapsed` are set unchanged by the existing `_onRender` and consumed by CSS in Tasks 1–2.
