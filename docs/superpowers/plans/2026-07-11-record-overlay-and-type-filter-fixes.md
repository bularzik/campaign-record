# Record-overlay & Type-filter fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four hub defects — no record close button, unreadable record content in dark mode, no way to unlink a linked actor/scene, and a cluttered type filter — in the campaign-record Foundry VTT module.

**Architecture:** All changes live in the hub / record-sheet layer. Handlebars templates + a Foundry ApplicationV2 mixin (`hub-mixin.mjs`) + one pure view-model module (`doctype-filter.mjs`) + module CSS + i18n strings. No data-model or migration changes.

**Tech Stack:** JavaScript (ES modules), Foundry VTT v13 ApplicationV2 + Handlebars, Vitest (unit), Playwright (e2e against a live Foundry install).

## Global Constraints

- Module id is `campaign-record`; JournalEntryPage sub-types are namespaced `campaign-record.<type>` (see `scripts/constants.mjs`).
- Record short types and order come from `RECORD_TYPES` in `scripts/constants.mjs`: `npc, place, quest, pc, item, encounter, checklist, shop, loot, media`, with `journal` appended last by the filter.
- All user-facing strings are localized through `lang/en.json` under the `CAMPAIGNRECORD` namespace; never hardcode English in templates or JS.
- Filter semantics are unchanged: an empty `state.types` set shows all record types.
- `#renderList()` re-renders only the `index` part; it never disturbs a mounted record pane. Use it (not full `render()`) for index-only updates.
- Pure logic modules under `scripts/logic/` stay Foundry-free (no `game`, `ui`, `foundry` globals) so Vitest can import them directly.
- Vitest run command: `npx vitest run`. Foundry e2e requires the `foundry-e2e` skill's session-lock protocol — do not run Playwright ad hoc; read that skill first.

---

### Task 1: Record close button

Add an "✕" close control to the record overlay header that dismisses the record and reveals the timeline.

**Files:**
- Modify: `templates/hub/record.hbs`
- Modify: `scripts/apps/hub/hub-mixin.mjs` (actions map ~line 39–62; add handler near `#onToggleEditMode` ~line 121)
- Modify: `lang/en.json` (`CAMPAIGNRECORD.Hub` block)
- Test: `tests/e2e/21-hub-record-pane.spec.mjs`

**Interfaces:**
- Produces: `closeRecord` action → `HubBase.#onCloseRecord`, which sets `this.state.view = null` and calls `this.render()`.

- [ ] **Step 1: Register the `closeRecord` action**

In `scripts/apps/hub/hub-mixin.mjs`, add to the `actions:` object (after `toggleEditMode: HubBase.#onToggleEditMode` — add a comma to that line):

```javascript
        toggleEditMode: HubBase.#onToggleEditMode,
        closeRecord: HubBase.#onCloseRecord
```

- [ ] **Step 2: Add the handler**

In `scripts/apps/hub/hub-mixin.mjs`, immediately after the `#onToggleEditMode` method (ends ~line 125), add:

```javascript
    /** Dismiss the record overlay and return to the index/timeline. */
    static async #onCloseRecord() {
      if (!this.state.view) return;
      this.state.view = null;
      await this.render();
    }
```

- [ ] **Step 3: Add the localized strings**

In `lang/en.json`, inside the `CAMPAIGNRECORD.Hub` block (e.g. right after the `"EditRecord"` line), add:

```json
      "CloseRecord": "Close entry",
```

- [ ] **Step 4: Add the button to the header**

In `templates/hub/record.hbs`, inside the `{{#if view}} … {{/if}}` block in the header, after the `edit-toggle` button's closing `{{/if}}` (line 16) and before the block's final `{{/if}}` (line 17), add:

```handlebars
    <button type="button" class="close-record" data-action="closeRecord"
            data-tooltip="CAMPAIGNRECORD.Hub.CloseRecord"
            aria-label="{{localize "CAMPAIGNRECORD.Hub.CloseRecord"}}">
      <i class="fa-solid fa-xmark"></i>
    </button>
```

The `record-pane-title` has `flex: 1`, so this trailing button lands at the upper-right corner.

- [ ] **Step 5: Add the e2e test**

In `tests/e2e/21-hub-record-pane.spec.mjs`, add this test inside the `test.describe("hub record pane", …)` block (e.g. after the "index click opens the record in-pane" test):

```javascript
  test("close button dismisses the record and reveals the timeline", async ({ page }) => {
    await login(page, "Gamemaster");
    await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Closer", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.waitFor();
    await hub.locator(".record-row", { hasText: "E2E Pane Closer" }).click();
    await expect(hub.locator(".hub-record.active")).toBeVisible();

    await hub.locator('.hub-record.active [data-action="closeRecord"]').click();

    await expect(hub.locator(".hub-record.active")).toHaveCount(0);
    await expect(hub.locator(".hub-timeline")).toBeVisible();
  });
```

- [ ] **Step 6: Run the e2e test (per foundry-e2e protocol)**

Read the `foundry-e2e` skill, acquire the session lock, then run:
`npx playwright test tests/e2e/21-hub-record-pane.spec.mjs`
Expected: the new "close button dismisses…" test passes along with the existing pane tests.

- [ ] **Step 7: Commit**

```bash
git add templates/hub/record.hbs scripts/apps/hub/hub-mixin.mjs lang/en.json tests/e2e/21-hub-record-pane.spec.mjs
git commit -m "feat: add a close button to the hub record overlay"
```

---

### Task 2: Unlink actor / scene

Add an "Unlink" button beside the existing link, shown only when a link exists, that clears the stored UUID.

**Files:**
- Modify: `scripts/sheets/base-record-sheet.mjs` (actions map ~line 23–28; handlers near `#onLinkActor`/`#onLinkScene` ~line 191–204)
- Modify: `templates/npc/edit.hbs`, `templates/pc/edit.hbs`, `templates/place/edit.hbs`
- Modify: `lang/en.json` (`CAMPAIGNRECORD` root block, near `"LinkActor"`)
- Test: `tests/e2e/19-actor-picker.spec.mjs`

**Interfaces:**
- Consumes: `this._onDropDocument` semantics from subclasses (NpcSheet/PcSheet write `system.actor`, PlaceSheet writes `system.scene`).
- Produces: `unlinkActor` action → `BaseRecordSheet.#onUnlinkActor` (clears `system.actor`); `unlinkScene` action → `BaseRecordSheet.#onUnlinkScene` (clears `system.scene`).

- [ ] **Step 1: Register the unlink actions**

In `scripts/sheets/base-record-sheet.mjs`, extend the `actions:` object (add commas as needed):

```javascript
    actions: {
      toggleHidden: BaseRecordSheet.#onToggleHidden,
      linkActor: BaseRecordSheet.#onLinkActor,
      linkScene: BaseRecordSheet.#onLinkScene,
      unlinkActor: BaseRecordSheet.#onUnlinkActor,
      unlinkScene: BaseRecordSheet.#onUnlinkScene,
      exportRecord: BaseRecordSheet.#onExportRecord
    }
```

- [ ] **Step 2: Add the unlink handlers**

In `scripts/sheets/base-record-sheet.mjs`, immediately after the `#onLinkScene` method (ends ~line 204), add:

```javascript
  /** Clear a linked Actor. No-op on sheets without a system.actor field. */
  static async #onUnlinkActor() {
    if (!("actor" in this.document.system)) return;
    await this.document.update({ "system.actor": "" });
  }

  /** Clear a linked Scene. No-op on sheets without a system.scene field. */
  static async #onUnlinkScene() {
    if (!("scene" in this.document.system)) return;
    await this.document.update({ "system.scene": "" });
  }
```

- [ ] **Step 3: Add localized strings**

In `lang/en.json`, in the `CAMPAIGNRECORD` root block near `"LinkActor"`/`"LinkScene"`, add:

```json
    "UnlinkActor": "Unlink Actor",
    "UnlinkScene": "Unlink Scene",
```

- [ ] **Step 4: Add the Unlink button to `npc/edit.hbs`**

In `templates/npc/edit.hbs`, replace the link button block (lines 14–19) so the unlink button appears only when a link exists:

```handlebars
  {{#if enriched.actorLink}}{{{enriched.actorLink}}}{{else}}
    <span class="hint">{{localize "CAMPAIGNRECORD.DropActorHint"}}</span>
  {{/if}}
  <button type="button" data-action="linkActor">
    <i class="fa-solid fa-link"></i> {{localize "CAMPAIGNRECORD.LinkActor"}}
  </button>
  {{#if enriched.actorLink}}
  <button type="button" data-action="unlinkActor">
    <i class="fa-solid fa-link-slash"></i> {{localize "CAMPAIGNRECORD.UnlinkActor"}}
  </button>
  {{/if}}
```

- [ ] **Step 5: Add the Unlink button to `pc/edit.hbs`**

In `templates/pc/edit.hbs`, after the existing `linkActor` button (lines 12–14) and before `{{> campaign-record.actor-info}}` (line 15), add:

```handlebars
  {{#if enriched.actorLink}}
  <button type="button" data-action="unlinkActor">
    <i class="fa-solid fa-link-slash"></i> {{localize "CAMPAIGNRECORD.UnlinkActor"}}
  </button>
  {{/if}}
```

- [ ] **Step 6: Add the Unlink button to `place/edit.hbs`**

In `templates/place/edit.hbs`, after the existing `linkScene` button (lines 13–15) and before the closing `</div>` (line 16), add:

```handlebars
  {{#if enriched.sceneLink}}
  <button type="button" data-action="unlinkScene">
    <i class="fa-solid fa-link-slash"></i> {{localize "CAMPAIGNRECORD.UnlinkScene"}}
  </button>
  {{/if}}
```

- [ ] **Step 7: Add e2e coverage for unlink**

In `tests/e2e/19-actor-picker.spec.mjs`, inside the `test("player links an actor to an NPC record via the picker", …)` test, replace the final close-sheet call (lines 70–73) with an unlink assertion followed by the close:

```javascript
    // Unlinking clears system.actor and restores the drop hint.
    await sheet.locator('button[data-action="unlinkActor"]').first().click();
    await expect
      .poll(() =>
        playerPage.evaluate(
          ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.actor,
          ids
        )
      )
      .toBe("");
    await expect(sheet.locator("a.content-link")).toHaveCount(0);
    await playerPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.close(),
      ids
    );
```

- [ ] **Step 8: Run the e2e test (per foundry-e2e protocol)**

With the session lock held, run:
`npx playwright test tests/e2e/19-actor-picker.spec.mjs`
Expected: the NPC link+unlink test and the scene test pass.

- [ ] **Step 9: Commit**

```bash
git add scripts/sheets/base-record-sheet.mjs templates/npc/edit.hbs templates/pc/edit.hbs templates/place/edit.hbs lang/en.json tests/e2e/19-actor-picker.spec.mjs
git commit -m "feat: add unlink buttons for linked actors and scenes"
```

---

### Task 3: Rewrite the doctype-filter view model

Replace the chip/available model with a checkbox-items + summary model. Pure logic, unit-tested first.

**Files:**
- Modify: `scripts/logic/doctype-filter.mjs`
- Test: `tests/doctype-filter.test.js`

**Interfaces:**
- Produces: `buildDoctypeFilter(selected: Set<string>, labelOf: (t: string) => string, allLabel: string) => { items: Array<{type, label, icon, checked}>, summary: string }`.
  - `items` covers `[...RECORD_TYPES, "journal"]` in order, each `checked` iff in `selected`.
  - `summary`: `allLabel` when zero or all items are checked; the single item's label when exactly one is checked; otherwise `` `${firstChecked.label} +${checkedCount - 1}` `` where `firstChecked` is the earliest checked item in list order.

- [ ] **Step 1: Rewrite the test file**

Replace the entire contents of `tests/doctype-filter.test.js` with:

```javascript
import { describe, it, expect } from "vitest";
import { buildDoctypeFilter } from "../scripts/logic/doctype-filter.mjs";

const label = (t) => `L:${t}`;
const ALL = "All types";

describe("buildDoctypeFilter", () => {
  it("lists every record type plus journal, all unchecked, when nothing is selected", () => {
    const vm = buildDoctypeFilter(new Set(), label, ALL);
    expect(vm.items.some((i) => i.type === "npc")).toBe(true);
    expect(vm.items.some((i) => i.type === "journal")).toBe(true);
    expect(vm.items.every((i) => i.checked === false)).toBe(true);
    expect(vm.summary).toBe(ALL);
  });

  it("marks selected types checked and carries icon + label", () => {
    const vm = buildDoctypeFilter(new Set(["npc"]), label, ALL);
    const npc = vm.items.find((i) => i.type === "npc");
    expect(npc.checked).toBe(true);
    expect(npc.icon).toBe("fa-solid fa-user");
    expect(npc.label).toBe("L:npc");
  });

  it("summarizes a single selection as that type's label", () => {
    const vm = buildDoctypeFilter(new Set(["quest"]), label, ALL);
    expect(vm.summary).toBe("L:quest");
  });

  it("summarizes multiple selections as first label + remaining count, in list order", () => {
    // list order is npc, place, quest, ...; npc is the earliest selected here.
    const vm = buildDoctypeFilter(new Set(["quest", "npc", "place"]), label, ALL);
    expect(vm.summary).toBe("L:npc +2");
  });

  it("treats an all-selected set the same as none: the all-types label", () => {
    const all = new Set([...
      "npc place quest pc item encounter checklist shop loot media journal".split(" ")]);
    const vm = buildDoctypeFilter(all, label, ALL);
    expect(vm.summary).toBe(ALL);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/doctype-filter.test.js`
Expected: FAIL — `buildDoctypeFilter` still returns `{chips, available, hasSelection}`, so `vm.items` is undefined.

- [ ] **Step 3: Rewrite the module**

Replace the entire contents of `scripts/logic/doctype-filter.mjs` with:

```javascript
import { RECORD_TYPES, recordIcon } from "../constants.mjs";

/**
 * View model for the Index doctype filter. Every type becomes a checkbox item;
 * a compact summary describes the active selection for the collapsed trigger.
 * Pure — the caller injects label resolvers so this stays testable without
 * Foundry's i18n.
 *
 * @param {Set<string>} selected  active short types
 * @param {(type: string) => string} labelOf  localized label for a short type
 * @param {string} allLabel  localized "all types" summary (no/every selection)
 * @returns {{items: object[], summary: string}}
 */
export function buildDoctypeFilter(selected, labelOf, allLabel) {
  const types = [...RECORD_TYPES, "journal"];
  const items = types.map((t) => ({
    type: t,
    label: labelOf(t),
    icon: recordIcon(t),
    checked: selected.has(t)
  }));
  const checked = items.filter((i) => i.checked);
  let summary;
  if (checked.length === 0 || checked.length === items.length) {
    summary = allLabel;
  } else if (checked.length === 1) {
    summary = checked[0].label;
  } else {
    summary = `${checked[0].label} +${checked.length - 1}`;
  }
  return { items, summary };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/doctype-filter.test.js`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/doctype-filter.mjs tests/doctype-filter.test.js
git commit -m "refactor: doctype filter view model uses checkbox items + summary"
```

---

### Task 4: Type-filter UI — rail row + checkbox dropdown

Wire the new model into the index template, move the rail toggle to its own top row, and drive the dropdown open/close + checkbox toggles from the mixin. Depends on Task 3.

**Files:**
- Modify: `templates/hub/index.hbs`
- Modify: `scripts/apps/hub/hub-mixin.mjs` (state init line 72; context ~line 633; `_onRender` bindings ~line 707–716; remove `#onRemoveType`/`#onClearTypes` ~line 378–386 and their action entries line 46–47)
- Modify: `styles/campaign-record.css` (replace `.doctype-*` rules ~line 43–77; collapsed-rail rules ~line 561–566)
- Modify: `lang/en.json` (`CAMPAIGNRECORD.Hub` block)
- Test: `tests/e2e/15-hub-types.spec.mjs`, `tests/e2e/21-hub-record-pane.spec.mjs`

**Interfaces:**
- Consumes: `buildDoctypeFilter(selected, labelOf, allLabel)` from Task 3.
- Produces: transient `this.state.typeMenuOpen` (boolean, not persisted); a delegated click handler that toggles the menu and closes on outside-click; a delegated change handler that toggles `state.types` from `input[name="doctype-check"]`.

- [ ] **Step 1: Add the transient menu-open state**

In `scripts/apps/hub/hub-mixin.mjs` line 72, extend the `state` initializer:

```javascript
    state = { groupId: "all", types: new Set(), hiddenOnly: false, sort: "name", query: "", typeMenuOpen: false };
```

- [ ] **Step 2: Remove the obsolete chip actions and handlers**

In the `actions:` object (~line 46–47) delete these two lines:

```javascript
        removeType: HubBase.#onRemoveType,
        clearTypes: HubBase.#onClearTypes,
```

Then delete the `#onRemoveType` and `#onClearTypes` methods (~line 378–386):

```javascript
    static #onRemoveType(event, target) {
      this.state.types.delete(target.dataset.type);
      this.#renderList();
    }

    static #onClearTypes() {
      this.state.types.clear();
      this.#renderList();
    }
```

(Leave `#onClearFilters` / the `clearFilters` action intact — the other-group-matches button still uses it.)

- [ ] **Step 3: Pass the new context**

In `scripts/apps/hub/hub-mixin.mjs`, replace the `context.doctypeFilter = …` line (~633):

```javascript
      context.doctypeFilter = buildDoctypeFilter(
        this.state.types,
        (t) => this.#typeLabel(t),
        game.i18n.localize("CAMPAIGNRECORD.Hub.AllTypesSummary")
      );
      context.typeMenuOpen = this.state.typeMenuOpen;
```

- [ ] **Step 4: Bind the dropdown click + checkbox handlers**

In `scripts/apps/hub/hub-mixin.mjs` `_onRender`, replace the existing `typeAdd` binding block (~line 707–716) with a single delegated binding on the persistent root element:

```javascript
      if (!this.element.dataset.crTypeBound) {
        this.element.dataset.crTypeBound = "1";
        // Toggle the menu from its trigger; close it on any outside click.
        this.element.addEventListener("click", (event) => {
          if (event.target.closest(".doctype-summary")) {
            this.state.typeMenuOpen = !this.state.typeMenuOpen;
            return this.#renderList();
          }
          if (this.state.typeMenuOpen && !event.target.closest(".doctype-filter")) {
            this.state.typeMenuOpen = false;
            this.#renderList();
          }
        });
        // Check/uncheck a type; the menu stays open across the re-render.
        this.element.addEventListener("change", (event) => {
          const cb = event.target.closest('input[name="doctype-check"]');
          if (!cb) return;
          if (cb.checked) this.state.types.add(cb.value);
          else this.state.types.delete(cb.value);
          this.#renderList();
        });
      }
```

- [ ] **Step 5: Add localized strings**

In `lang/en.json` `CAMPAIGNRECORD.Hub` block: add the two new keys and remove the three now-unused ones (`AddType`, `ClearTypes`, `RemoveType`). Add:

```json
      "AllTypes": "All Types",
      "AllTypesSummary": "All types",
```

Delete these lines:

```json
      "AddType": "Add type…",
      "ClearTypes": "Clear types",
      "RemoveType": "Remove type",
```

- [ ] **Step 6: Rewrite the index template top**

In `templates/hub/index.hbs`, replace the `.doctype-filter` block (lines 2–24) and the `rail-toggle` button inside `.index-controls` (lines 26–30) so the rail toggle gets its own top row and the filter becomes a checkbox dropdown. The new top of the file, from `<section class="hub-index">` through the opening of `.index-controls`, reads:

```handlebars
<section class="hub-index">
  <div class="rail-row">
    <button type="button" class="rail-toggle" data-action="toggleRail"
            data-tooltip="CAMPAIGNRECORD.Hub.ToggleRail"
            aria-label="{{localize "CAMPAIGNRECORD.Hub.ToggleRail"}}">
      <i class="fa-solid fa-angles-left"></i>
    </button>
  </div>
  <div class="doctype-filter{{#if typeMenuOpen}} open{{/if}}">
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
  <div class="index-controls">
```

Leave the rest of `.index-controls` (the search input, snippets toggle, sort select, hidden toggle, filtered-count) and everything below it unchanged — only the `rail-toggle` button is removed from inside it.

- [ ] **Step 7: Update the CSS**

In `styles/campaign-record.css`, replace the doctype rules (lines 43–77: `.doctype-filter`, `.doctype-chip`, `.doctype-chip a`, `.doctype-chip a:hover`, `.doctype-add`, `.doctype-clear`) with:

```css
.campaign-hub .rail-row {
  display: flex;
  margin-bottom: 0.5rem;
}
.campaign-hub .rail-row .rail-toggle {
  width: auto;
  flex: 0 0 auto;
}

.campaign-hub .doctype-filter {
  position: relative;
  margin-bottom: 0.5rem;
}
.campaign-hub .doctype-summary {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  justify-content: flex-start;
}
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
.campaign-hub .doctype-option {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.15rem 0.3rem;
  white-space: nowrap;
  cursor: pointer;
}
.campaign-hub .doctype-option:hover {
  background: var(--color-hover-bg, rgba(255, 255, 240, 0.1));
}
.campaign-hub .doctype-option input {
  flex: 0 0 auto;
  margin: 0;
}
```

Then replace the collapsed-rail rules (lines 561–566) with a version keyed on `.rail-row`:

```css
/* Collapsed: keep only the rail toggle's row; hide everything else. */
.campaign-hub.rail-collapsed .hub-index > *:not(.rail-row) {
  display: none;
}
.campaign-hub.rail-collapsed .hub-index .rail-toggle i {
  transform: scaleX(-1); /* point the chevrons the other way when collapsed */
}
```

- [ ] **Step 8: Update the `15-hub-types` e2e for the new UI**

In `tests/e2e/15-hub-types.spec.mjs`, replace the first two tests (lines 46–81) with checkbox-dropdown equivalents. Keep the `search hits …` test unchanged.

```javascript
  test("type filter offers one checkbox per record type plus journal, and phase-3 subtitles", async () => {
    await openHub();
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    // Closed by default: summary reads "All types".
    await expect(hub.locator(".doctype-summary-label")).toHaveText("All types");
    await hub.locator(".doctype-summary").click();
    // 10 record types + journal = 11 checkboxes.
    await expect(hub.locator('.doctype-menu input[name="doctype-check"]')).toHaveCount(11);
    await expect(hub.locator(".record-list")).toContainText("Blacksmith");     // shop subtitle
    await expect(hub.locator(".record-list")).toContainText("Dan — Rogue 3");  // pc subtitle
    await expect(hub.locator(".record-list")).toContainText("1/2 done");       // checklist subtitle
  });

  test("checking types filters the list; menu stays open; summary updates", async () => {
    await openHub();
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });

    await hub.locator(".doctype-summary").click();
    await hub.locator('.doctype-menu input[value="shop"]').check();
    // Menu stays open for multi-select.
    await expect(hub.locator(".doctype-menu")).toBeVisible();
    await expect(hub.locator(".record-list")).toContainText("E2E HubTypes Shop");
    await expect(hub.locator(".record-list")).not.toContainText("E2E HubTypes PC");

    await hub.locator('.doctype-menu input[value="pc"]').check();
    // Two selected -> "first label +1" (shop precedes journal but pc precedes shop in list order).
    // Close the menu to read the summary.
    await hub.locator(".record-list").click();
    await expect(hub.locator(".doctype-menu")).toHaveCount(0);
    await expect(hub.locator(".doctype-summary-label")).toContainText("+1");

    // Reopen and uncheck both -> back to "All types" and unfiltered.
    await hub.locator(".doctype-summary").click();
    await hub.locator('.doctype-menu input[value="shop"]').uncheck();
    await hub.locator('.doctype-menu input[value="pc"]').uncheck();
    await hub.locator(".record-list").click();
    await expect(hub.locator(".doctype-summary-label")).toHaveText("All types");
    await expect(hub.locator(".record-list")).toContainText("E2E HubTypes PC");
  });
```

- [ ] **Step 9: Fix the rail-toggle selector assumption in `21-hub-record-pane`**

The pane tests already locate the toggle as `.hub-index [data-action="toggleRail"]`, which still matches. Confirm the "index collapses…" test (line 85) still passes after the move — no edit expected, but verify in Step 10. No code change in this step.

- [ ] **Step 10: Run unit + e2e**

Run: `npx vitest run` — expected: all suites pass (doctype-filter included).
Then, with the foundry-e2e session lock held, run:
`npx playwright test tests/e2e/15-hub-types.spec.mjs tests/e2e/21-hub-record-pane.spec.mjs`
Expected: the new type-filter tests pass and the rail-collapse tests still pass.

- [ ] **Step 11: Commit**

```bash
git add templates/hub/index.hbs scripts/apps/hub/hub-mixin.mjs styles/campaign-record.css lang/en.json tests/e2e/15-hub-types.spec.mjs
git commit -m "feat: type filter as a checkbox dropdown with its own rail-toggle row"
```

---

### Task 5: Theme fix — readable record content in light and dark

Stop the record overlay from forcing a light surface so record content follows Foundry's active theme. Verified live in both themes (no unit test applies to CSS theming).

**Files:**
- Modify: `styles/campaign-record.css` (`.hub-record.active` ~line 548–554; `.record-pane-mount` ~line 592–596; the `--color-bg` fallback ~line 663)

**Interfaces:**
- None (CSS only).

- [ ] **Step 1: Make the overlay surface + text theme-aware**

In `styles/campaign-record.css`, in the `.campaign-hub .hub-record.active` rule (~line 548), replace the hardcoded light `background` line:

```css
  background: var(--color-bg, var(--dnd5e-color-parchment, #ededed));
```

with a themed surface plus an explicit themed text color so background and text always come from the same theme:

```css
  background: var(--color-bg-option, var(--color-cool-5, #23221d));
  color: var(--color-text-primary, inherit);
```

- [ ] **Step 2: Inspect the light fallback at ~line 663**

Read `styles/campaign-record.css` around line 663 (the rule using `var(--color-bg-option, var(--color-bg, #e8e6dc))`). If that rule paints the record content/mount surface, change its final fallback so it does not force a light color in dark mode — use the same themed pair as Step 1 (`var(--color-bg-option, var(--color-cool-5, #23221d))`). If the rule is unrelated to the record pane (e.g. a timeline element), leave it and note why in the commit message.

- [ ] **Step 3: Verify live in dark mode (per foundry-e2e protocol)**

Read the `foundry-e2e` skill and acquire the session lock. Set Foundry's Color Scheme to Dark (Configure Settings → Core → Color Scheme, or `game.settings.set("core", "colorScheme", { applications: "dark", interface: "dark" })`). Open the hub, open an NPC record in view mode, then edit mode. Confirm the field labels, values, and description text are legible against the surface. Take a screenshot for the record.

- [ ] **Step 4: Verify live in light mode**

Switch Foundry's Color Scheme to Light. Reopen the same record in view and edit modes. Confirm content is still legible (dark text on a light surface). If either theme is unreadable, adjust the CSS variables in Steps 1–2 to the core variable whose computed value matches `.window-content`'s background in that theme (inspect via devtools), and re-verify both themes.

- [ ] **Step 5: Commit**

```bash
git add styles/campaign-record.css
git commit -m "fix: record overlay follows Foundry's theme instead of forcing parchment"
```

---

### Task 6: Full verification & version bump

Confirm the whole suite is green and bump the module version for the release.

**Files:**
- Modify: `module.json` (`version`)

**Interfaces:**
- None.

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run`
Expected: all suites pass (no references to the removed `chips`/`available`/`hasSelection` model, `AddType`/`ClearTypes`/`RemoveType` keys, or `doctype-chip`/`doctype-add` selectors remain).

- [ ] **Step 2: Grep for stragglers**

Run:
```bash
grep -rn "doctype-chip\|doctype-add\|doctype-clear\|removeType\|clearTypes\|AddType\|ClearTypes\|RemoveType\|\.chips\|hasSelection\|\.available" scripts/ templates/ styles/ lang/ tests/
```
Expected: no matches (the `clearFilters` action and `#onClearFilters` are named differently and should not appear). Fix any straggler before continuing.

- [ ] **Step 3: Run the full e2e suite (per foundry-e2e protocol)**

With the session lock held, run: `npx playwright test`
Expected: green. Investigate and fix any failure before the version bump.

- [ ] **Step 4: Bump the module version**

In `module.json`, increment `version` from `1.2.7` to `1.2.8`.

- [ ] **Step 5: Commit**

```bash
git add module.json
git commit -m "chore: bump version to 1.2.8"
```

---

## Self-Review notes

- **Spec coverage:** close button → Task 1; theme fix (items 2 & 3 of the report) → Task 5; unlink actor/scene → Task 2; type-filter rail row + checkbox dropdown + summary label → Tasks 3–4. All four spec items map to tasks.
- **Type consistency:** `buildDoctypeFilter(selected, labelOf, allLabel) → {items, summary}` is defined in Task 3 and consumed identically in Task 4. Actions `closeRecord`, `unlinkActor`, `unlinkScene` are registered and handled in their tasks. `state.typeMenuOpen` is initialized (Task 4 Step 1), read into context (Step 3), and toggled (Step 4).
- **Manual verification:** Task 5 is CSS theming with no unit test; it is explicitly verified live in both themes. The exact core theme variable may need adjustment during Step 4 — this is called out, not left as a silent assumption.
