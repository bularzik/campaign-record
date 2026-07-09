# Hub Record Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** View and edit campaign records (and text pages) directly inside the Campaign Hub via frameless sheet embedding, with free jump-navigation (left rail + back/forward), and make the hub the campaign group's actual journal sheet so the sidebar opens it directly.

**Architecture:** The existing `CampaignHub` singleton is refactored into a `HubMixin` shared by two thin subclasses: the standalone hub (`ApplicationV2`) and a new `GroupHubSheet` (`DocumentSheetV2` registered for `JournalEntry`, selected per-group via the `core.sheetClass` flag). A record pane mounts the page's real registered sheet frameless (core's own `JournalEntrySheet` embedding pattern: `mode`, `window: {frame: false, positioned: false}`), so all ten record sheets are reused untouched.

**Tech Stack:** Foundry VTT v13.351 (AppV2/DocumentSheetV2, Handlebars parts), vanilla ES modules, vitest (unit), Playwright (e2e against local Foundry World B).

**Spec:** `docs/superpowers/specs/2026-07-09-hub-record-pane-design.md`

## Global Constraints

- Foundry target: v13.351 (module.json unchanged this feature; no new dependencies).
- Module id: `campaign-record`; all flags/settings namespaced with `MODULE_ID`.
- All user-facing strings localized under `CAMPAIGNRECORD.*` in `lang/en.json` (the `i18n-coverage` unit test enforces template keys).
- Record sheets (`scripts/sheets/*`) and data models (`scripts/data/*.mjs` models) must NOT be modified, except `groups.mjs` (group creation flag) and `migration-runner.mjs` (new migration).
- Unit tests: `npm test` (currently 71 passing — must stay green, plus new tests).
- E2E: `npm run test:e2e -- <file>` from this worktree (harness pins the Foundry module symlink to this checkout; needs the local Foundry server; env lock auto-acquired). Full suite: `npm run test:e2e`.
- Commit style: `feat:` / `fix:` / `test:` / `refactor:` / `docs:` prefixes, imperative subject.
- Working directory: worktree `.claude/worktrees/hub-record-pane`, branch `feature/hub-record-pane`.

## File Structure

| File | Responsibility |
| --- | --- |
| `scripts/apps/hub/pane-history.mjs` (new) | Pure history-stack logic (push/back/forward/prune) |
| `scripts/logic/record-links.mjs` (new) | Pure classification of link targets (in-pane / other-group / external) |
| `scripts/apps/hub/record-pane.mjs` (new) | Embedded-sheet lifecycle: create frameless sheet instances, mount, teardown |
| `scripts/apps/hub/hub-mixin.mjs` (new) | All shared hub behavior (parts, tabs, state, actions, index/timeline/search, record pane integration) |
| `scripts/apps/hub/campaign-hub.mjs` (rewrite) | Thin standalone singleton subclass (group dropdown, open/toggle statics) |
| `scripts/apps/hub/group-hub-sheet.mjs` (new) | Thin `DocumentSheetV2` subclass pinned to one group; `goToPage` compat |
| `templates/hub/record.hbs` (new) | Record pane: header (rail toggle, back/forward, name, edit toggle), rail, mount |
| `templates/hub/header.hbs` (modify) | Group picker becomes conditional |
| `scripts/sheets/registration.mjs` (modify) | Register `GroupHubSheet` for `JournalEntry` |
| `scripts/data/groups.mjs` (modify) | New groups get `core.sheetClass` flag |
| `scripts/data/migration-runner.mjs` (modify) | Migration v2 stamps flag on existing groups |
| `scripts/constants.mjs` (modify) | `GROUP_SHEET_CLASS`, `RAIL_SETTING`, `SCHEMA_VERSION` bump |
| `scripts/hooks/hub-ui.mjs` (modify) | Register rail-collapsed client setting |
| `styles/campaign-record.css` (modify) | Record pane / rail layout |
| `lang/en.json` (modify) | New Hub.* and Sheets.GroupHub keys |
| `tests/pane-history.test.js`, `tests/record-links.test.js` (new) | Unit tests |
| `tests/e2e/21-hub-record-pane.spec.mjs`, `tests/e2e/22-group-hub-sheet.spec.mjs` (new), `tests/e2e/18-migrations.spec.mjs` (extend) | E2E |

---

### Task 1: History module (pure, TDD)

**Files:**
- Create: `scripts/apps/hub/pane-history.mjs`
- Test: `tests/pane-history.test.js`

**Interfaces:**
- Produces: `createHistory() -> {entries: Array<{kind: "index"}|{kind: "record", pageId: string}>, cursor: number}`; `currentEntry(h)`; `pushEntry(h, entry)` (mutates; no-op when equal to current; truncates forward history); `canGoBack(h) -> boolean`; `canGoForward(h) -> boolean`; `goBack(h) -> entry|null` (mutates cursor); `goForward(h) -> entry|null`; `prunePage(h, pageId)` (mutates: removes matching record entries, collapses now-adjacent duplicates, keeps cursor on the nearest surviving earlier entry).

- [ ] **Step 1: Write the failing tests**

```js
// tests/pane-history.test.js
import { describe, it, expect } from "vitest";
import {
  createHistory, currentEntry, pushEntry, canGoBack, canGoForward,
  goBack, goForward, prunePage
} from "../scripts/apps/hub/pane-history.mjs";

describe("pane history", () => {
  it("starts at the index root with no back/forward", () => {
    const h = createHistory();
    expect(currentEntry(h)).toEqual({ kind: "index" });
    expect(canGoBack(h)).toBe(false);
    expect(canGoForward(h)).toBe(false);
  });

  it("push advances the cursor; back and forward walk entries", () => {
    const h = createHistory();
    pushEntry(h, { kind: "record", pageId: "a" });
    pushEntry(h, { kind: "record", pageId: "b" });
    expect(currentEntry(h)).toEqual({ kind: "record", pageId: "b" });
    expect(goBack(h)).toEqual({ kind: "record", pageId: "a" });
    expect(goBack(h)).toEqual({ kind: "index" });
    expect(goBack(h)).toBeNull();
    expect(goForward(h)).toEqual({ kind: "record", pageId: "a" });
    expect(canGoForward(h)).toBe(true);
  });

  it("pushing the current entry again is a no-op", () => {
    const h = createHistory();
    pushEntry(h, { kind: "record", pageId: "a" });
    pushEntry(h, { kind: "record", pageId: "a" });
    expect(h.entries).toHaveLength(2);
    pushEntry(h, { kind: "index" });
    pushEntry(h, { kind: "index" });
    expect(h.entries).toHaveLength(3);
  });

  it("pushing after going back truncates forward history", () => {
    const h = createHistory();
    pushEntry(h, { kind: "record", pageId: "a" });
    pushEntry(h, { kind: "record", pageId: "b" });
    goBack(h); // at a
    pushEntry(h, { kind: "record", pageId: "c" });
    expect(h.entries.map((e) => e.pageId ?? "index")).toEqual(["index", "a", "c"]);
    expect(canGoForward(h)).toBe(false);
  });

  it("supports loops without special handling", () => {
    const h = createHistory();
    for (const id of ["a", "b", "c", "a"]) pushEntry(h, { kind: "record", pageId: id });
    expect(h.entries).toHaveLength(5);
    expect(currentEntry(h)).toEqual({ kind: "record", pageId: "a" });
    expect(goBack(h)).toEqual({ kind: "record", pageId: "c" });
  });

  it("prunePage removes entries for a deleted page and repairs the cursor", () => {
    const h = createHistory();
    for (const id of ["a", "b", "a", "c"]) pushEntry(h, { kind: "record", pageId: id });
    // entries: index, a, b, a, c — cursor on c
    goBack(h); // cursor on second a
    prunePage(h, "a");
    // entries: index, b, c — cursor falls to nearest surviving earlier entry (b)
    expect(h.entries.map((e) => e.pageId ?? "index")).toEqual(["index", "b", "c"]);
    expect(currentEntry(h)).toEqual({ kind: "record", pageId: "b" });
  });

  it("prunePage collapses duplicates that become adjacent", () => {
    const h = createHistory();
    for (const id of ["a", "b", "a"]) pushEntry(h, { kind: "record", pageId: id });
    prunePage(h, "b"); // index, a, a -> index, a
    expect(h.entries.map((e) => e.pageId ?? "index")).toEqual(["index", "a"]);
    expect(currentEntry(h)).toEqual({ kind: "record", pageId: "a" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/pane-history.test.js`
Expected: FAIL — cannot resolve `../scripts/apps/hub/pane-history.mjs`.

- [ ] **Step 3: Implement the module**

```js
// scripts/apps/hub/pane-history.mjs
/** Pure navigation-history state for the hub record pane. */

export function createHistory() {
  return { entries: [{ kind: "index" }], cursor: 0 };
}

export function currentEntry(history) {
  return history.entries[history.cursor];
}

function entriesEqual(a, b) {
  return a.kind === b.kind && a.pageId === b.pageId;
}

/** Append an entry after the cursor, dropping forward history. No-op if equal to current. */
export function pushEntry(history, entry) {
  if (entriesEqual(currentEntry(history), entry)) return;
  history.entries = history.entries.slice(0, history.cursor + 1);
  history.entries.push(entry);
  history.cursor = history.entries.length - 1;
}

export function canGoBack(history) {
  return history.cursor > 0;
}

export function canGoForward(history) {
  return history.cursor < history.entries.length - 1;
}

export function goBack(history) {
  if (!canGoBack(history)) return null;
  history.cursor -= 1;
  return currentEntry(history);
}

export function goForward(history) {
  if (!canGoForward(history)) return null;
  history.cursor += 1;
  return currentEntry(history);
}

/** Remove all entries for a deleted page; collapse resulting adjacent duplicates. */
export function prunePage(history, pageId) {
  const kept = [];
  let cursor = 0;
  history.entries.forEach((entry, i) => {
    const doomed = entry.kind === "record" && entry.pageId === pageId;
    const duplicate = kept.length && !doomed && entriesEqual(kept[kept.length - 1], entry);
    if (!doomed && !duplicate) kept.push(entry);
    // The cursor lands on the nearest surviving entry at-or-before its old position.
    if (i === history.cursor) cursor = kept.length ? kept.length - 1 : 0;
  });
  history.entries = kept.length ? kept : [{ kind: "index" }];
  history.cursor = Math.min(cursor, history.entries.length - 1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/pane-history.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the full unit suite, then commit**

Run: `npm test` — expected: all pass (78 total).

```bash
git add scripts/apps/hub/pane-history.mjs tests/pane-history.test.js
git commit -m "feat: pure history-stack module for hub record pane navigation"
```

---

### Task 2: Link-target classification (pure, TDD)

**Files:**
- Create: `scripts/logic/record-links.mjs`
- Test: `tests/record-links.test.js`

**Interfaces:**
- Consumes: `hasGroupFlag(flags)` from `scripts/logic/visibility.mjs` (already exists; returns truthy when a flags object carries the campaign-group flag).
- Produces: `classifyLinkTarget(doc, scopedGroupIds) -> {kind: "in-pane"|"other-group"|"external", groupId?: string, pageId?: string}` where `scopedGroupIds` is a `Set` of the hub's in-scope group ids.

- [ ] **Step 1: Confirm the `hasGroupFlag` signature**

Read `scripts/logic/visibility.mjs` and confirm `hasGroupFlag` is exported and how it reads flags (it is used as `hasGroupFlag(doc.parent?.flags)` in `campaign-hub.mjs:132`). Adjust the import below only if the actual export differs.

- [ ] **Step 2: Write the failing tests**

```js
// tests/record-links.test.js
import { describe, it, expect } from "vitest";
import { classifyLinkTarget } from "../scripts/logic/record-links.mjs";

const groupFlags = { "campaign-record": { group: { timepoints: [] } } };
const pageIn = (groupId, pageId = "p1", flags = groupFlags) => ({
  documentName: "JournalEntryPage",
  id: pageId,
  parent: { id: groupId, flags }
});

describe("classifyLinkTarget", () => {
  const scope = new Set(["g1"]);

  it("classifies a page in a scoped group as in-pane", () => {
    expect(classifyLinkTarget(pageIn("g1"), scope)).toEqual({
      kind: "in-pane", groupId: "g1", pageId: "p1"
    });
  });

  it("classifies a page in another campaign group as other-group", () => {
    expect(classifyLinkTarget(pageIn("g2"), scope)).toEqual({
      kind: "other-group", groupId: "g2", pageId: "p1"
    });
  });

  it("classifies a page in a non-group journal as external", () => {
    expect(classifyLinkTarget(pageIn("g1", "p1", {}), scope).kind).toBe("external");
  });

  it("classifies non-page documents and null as external", () => {
    expect(classifyLinkTarget({ documentName: "Actor", id: "a1" }, scope).kind).toBe("external");
    expect(classifyLinkTarget(null, scope).kind).toBe("external");
  });

  it("treats every group as in scope for the all-groups hub", () => {
    const all = new Set(["g1", "g2"]);
    expect(classifyLinkTarget(pageIn("g2"), all).kind).toBe("in-pane");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- tests/record-links.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/record-links.mjs`.

- [ ] **Step 4: Implement**

```js
// scripts/logic/record-links.mjs
import { hasGroupFlag } from "./visibility.mjs";

/**
 * Decide how the hub should handle activating a link to a document.
 * - "in-pane": a page of a campaign group within the hub's scope
 * - "other-group": a page of a campaign group outside the scope
 * - "external": anything else (defer to Foundry's default handling)
 */
export function classifyLinkTarget(doc, scopedGroupIds) {
  if (doc?.documentName !== "JournalEntryPage") return { kind: "external" };
  if (!hasGroupFlag(doc.parent?.flags)) return { kind: "external" };
  const groupId = doc.parent.id;
  const kind = scopedGroupIds.has(groupId) ? "in-pane" : "other-group";
  return { kind, groupId, pageId: doc.id };
}
```

- [ ] **Step 5: Run tests, then full suite, then commit**

Run: `npm test -- tests/record-links.test.js` — expected PASS (5 tests). Then `npm test` — all pass.

```bash
git add scripts/logic/record-links.mjs tests/record-links.test.js
git commit -m "feat: pure link-target classification for in-pane navigation"
```

---

### Task 3: Spike — frameless edit-mode embedding of core text page sheet

**Files:**
- Create (throwaway): `tests/e2e/spike-prosemirror-embed.spec.mjs`

**Interfaces:**
- Produces: a go/no-go decision recorded in the commit message. GO → Task 8 embeds core text sheets in edit mode like any record sheet. NO-GO → Task 8 uses its documented fallback (hub-owned `<prose-mirror>` element).

The spec flags one risk: core itself never embeds a text page sheet **in edit mode** frameless (view mode it does). This spike verifies it before the pane is built.

- [ ] **Step 1: Write the spike spec**

```js
// tests/e2e/spike-prosemirror-embed.spec.mjs
import { test, expect } from "@playwright/test";
import { login, createGroupWithPage, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

test("core text page sheet renders frameless in edit mode with a working editor", async ({ page }) => {
  await login(page, "Gamemaster");
  const ids = await createGroupWithPage(page, "E2E Spike Group", "E2E Spike Text", "text");

  const result = await page.evaluate(async ({ groupId, pageId }) => {
    const doc = game.journal.get(groupId).pages.get(pageId);
    const cls = doc._getSheetClass();
    const sheet = new cls({
      id: `spike-embed-${pageId}`,
      document: doc,
      mode: "edit",
      window: { frame: false, positioned: false }
    });
    await sheet.render({ force: true });
    document.body.append(sheet.element);
    // Give the ProseMirror editor a beat to initialize.
    await new Promise((r) => setTimeout(r, 1000));
    const editor = sheet.element.querySelector("prose-mirror, .prosemirror, .editor");
    const editable = sheet.element.querySelector('[contenteditable="true"]');
    const summary = {
      rendered: sheet.rendered,
      hasEditor: !!editor,
      hasEditableSurface: !!editable,
      html: sheet.element.outerHTML.slice(0, 500)
    };
    await sheet.close({ animate: false });
    return summary;
  }, ids);

  console.log("SPIKE RESULT:", JSON.stringify(result, null, 2));
  await deleteGroupsByPrefix(page, "E2E Spike");
  expect(result.rendered).toBe(true);
  expect(result.hasEditor).toBe(true);
  expect(result.hasEditableSurface).toBe(true);
});
```

- [ ] **Step 2: Run the spike**

Run: `npm run test:e2e -- tests/e2e/spike-prosemirror-embed.spec.mjs`
Expected: PASS → GO. If it fails, capture the logged `SPIKE RESULT` and `html` snippet — that is the NO-GO evidence Task 8's fallback path needs.

- [ ] **Step 3: Delete the spike file and record the decision**

```bash
git rm --cached tests/e2e/spike-prosemirror-embed.spec.mjs 2>/dev/null; rm -f tests/e2e/spike-prosemirror-embed.spec.mjs
git commit --allow-empty -m "docs: spike result — frameless edit-mode text sheet embed: GO (or NO-GO + evidence)"
```

Write the actual outcome (GO/NO-GO and one line of evidence) in the commit message body.

---

### Task 4: Extract HubMixin (pure refactor, no behavior change)

**Files:**
- Create: `scripts/apps/hub/hub-mixin.mjs`
- Rewrite: `scripts/apps/hub/campaign-hub.mjs`
- Modify: `templates/hub/header.hbs`

**Interfaces:**
- Produces: `HubMixin(Base)` returning class `HubBase extends HandlebarsApplicationMixin(Base)` containing ALL current `CampaignHub` behavior except the singleton statics; instance getter `groupScopeId` (returns `this.state.groupId`; subclasses override); getter `showsGroupPicker` (returns `true`); `CampaignHub extends HubMixin(ApplicationV2)` keeps `static open()`, `static toggle()`, `static #instance`, and `DEFAULT_OPTIONS` with `id: "campaign-hub"`.
- Consumes: nothing new. Every existing import of `CampaignHub` (only `scripts/hooks/hub-ui.mjs`) keeps working unchanged.

- [ ] **Step 1: Create `scripts/apps/hub/hub-mixin.mjs`**

Move the entire body of the current `CampaignHub` class (`scripts/apps/hub/campaign-hub.mjs` lines 25–534) verbatim into the mixin, with these exact changes and nothing else:

```js
// scripts/apps/hub/hub-mixin.mjs — skeleton; members listed below move in verbatim
import { getGroups } from "../../data/groups.mjs";
import { MODULE_ID, THUMBNAILS_SETTING, RECORD_TYPES, typeId } from "../../constants.mjs";
import { collectRecords, isIndexablePage, getScopedGroups, toSearchRecord } from "./hub-data.mjs";
import { createIndex, indexRecord, removeRecord, search } from "../../logic/search-index.mjs";
import { hasGroupFlag } from "../../logic/visibility.mjs";
import { classifyDropData, filenameFromSrc } from "../../logic/timeline-links.mjs";
import * as Timepoints from "../../data/timepoints.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;

/** Shared Campaign Hub behavior for the standalone hub and the per-group sheet. */
export function HubMixin(Base) {
  class HubBase extends HandlebarsApplicationMixin(Base) {
    /** The group scope this hub renders: "all", or one group id. */
    get groupScopeId() {
      return this.state.groupId;
    }

    /** Whether the header shows the group dropdown. */
    get showsGroupPicker() {
      return true;
    }

    // …every member listed in the table below, moved verbatim…
  }
  return HubBase;
}
```

Members that move verbatim from `CampaignHub` into `HubBase` (source lines refer to the pre-refactor `campaign-hub.mjs`):

| Member | Source lines | Change while moving |
| --- | --- | --- |
| `static DEFAULT_OPTIONS` | 25–45 | Remove `id: "campaign-hub"` (stays on the subclass). All `CampaignHub.#onX` action references become `HubBase.#onX`. |
| `static PARTS` | 47–52 | none |
| `static TABS` | 54–64 | none |
| `state = {...}` | 66 | none |
| `#hookHandlers`, `#registerDocHooks`, `#teardownHooks` | 68–85 | none |
| `#debouncedRender` | 87–89 | none |
| `#searchIndex`, `#ensureSearchIndex`, `#searchResults` | 91–125 | In `#searchResults`, replace `this.state.groupId` with `this.groupScopeId` |
| `_onDocumentChanged` | 127–140 | none |
| `_onFirstRender`, `_onClose` | 142–151 | none |
| `#indexEntries` | 153–168 | Replace `this.state.groupId` with `this.groupScopeId` |
| `static #onOpenRecord` … `static #onToggleThumbnails` (all 13 action handlers) | 170–352 | Rename holder class references `CampaignHub.` → `HubBase.` (`#promptLabel` call sites). In `#onNewRecord`, `const current = this.state.groupId;` becomes `const current = this.groupScopeId;` |
| `#onTimelineDragStart`, `#onTimelineDrop`, `#dropLink` | 354–437 | none |
| `#timelineGroups` | 235–259 | Replace `this.state.groupId` with `this.groupScopeId` |
| `_prepareContext` | 439–468 | Replace `groupId: this.state.groupId` (records collection, line 447 via `#indexEntries`) — already covered above; `selected: g.id === this.state.groupId` stays (dropdown is standalone-only); add `context.showGroupPicker = this.showsGroupPicker;` after `context.isGM = …` |
| `_onRender` | 470–534 | none (the `group-select` listener is harmless when the select is absent) |

- [ ] **Step 2: Rewrite `scripts/apps/hub/campaign-hub.mjs` as the thin subclass**

```js
// scripts/apps/hub/campaign-hub.mjs (complete new content)
import { HubMixin } from "./hub-mixin.mjs";

const { ApplicationV2 } = foundry.applications.api;

/** The standalone, cross-group Campaign Hub window (group dropdown, singleton). */
export class CampaignHub extends HubMixin(ApplicationV2) {
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
    id: "campaign-hub"
  };
}
```

AppV2 merges `DEFAULT_OPTIONS` up the prototype chain, so the mixin's classes/window/position/actions apply automatically.

- [ ] **Step 3: Make the group picker conditional in `templates/hub/header.hbs`**

Wrap the existing `<select name="group-select">…</select>` (lines 2–7) in `{{#if showGroupPicker}} … {{/if}}`. No other changes.

- [ ] **Step 4: Verify no behavior change**

Run: `npm test` — all unit tests pass.
Run: `npm run test:e2e -- tests/e2e/05-hub.spec.mjs tests/e2e/06-hub-index.spec.mjs tests/e2e/07-hub-search.spec.mjs tests/e2e/08-hub-timeline.spec.mjs`
Expected: PASS (identical hub behavior).

- [ ] **Step 5: Commit**

```bash
git add scripts/apps/hub/hub-mixin.mjs scripts/apps/hub/campaign-hub.mjs templates/hub/header.hbs
git commit -m "refactor: extract shared hub behavior into HubMixin"
```

---

### Task 5: Record pane — view mode in the hub

**Files:**
- Create: `scripts/apps/hub/record-pane.mjs`
- Create: `templates/hub/record.hbs`
- Modify: `scripts/apps/hub/hub-mixin.mjs`
- Modify: `styles/campaign-record.css`
- Modify: `lang/en.json`
- Test: `tests/e2e/21-hub-record-pane.spec.mjs`

**Interfaces:**
- Consumes: `createHistory/pushEntry/currentEntry/canGoBack/canGoForward/goBack/goForward/prunePage` (Task 1).
- Produces (on `HubBase`): `async navigateToRecord(pageId, {mode = "view", pushHistory = true})`; `async navigateToIndex({pushHistory = true})`; private `#history`, `#pane`, `#resolveViewedPage()`, `#inScope(page)`. `RecordPane` class: `async mount(container, page, mode)` (closes any other embedded sheet, creates/reuses a frameless instance, appends its element), `async close()`. New hub part `record` and context member `context.view` (`null` or `{name, editing, canEdit, canGoBack, canGoForward, railCollapsed, railGroups}` — rail members wired in Task 6, present but empty until then).

- [ ] **Step 1: Implement `RecordPane`**

```js
// scripts/apps/hub/record-pane.mjs
/**
 * Owns the frameless page-sheet instances embedded in a hub's record pane.
 * Mirrors core JournalEntrySheet.getPageSheet(): real registered sheets,
 * rendered with no window frame, appended into a container we control.
 */
export class RecordPane {
  #sheets = new Map(); // "pageUuid:mode" -> sheet instance

  async mount(container, page, mode) {
    const key = `${page.uuid}:${mode}`;
    // One live embedded sheet at a time: close all others (mode flips included).
    for (const [k, sheet] of [...this.#sheets]) {
      if (k === key) continue;
      await sheet.close({ animate: false });
      this.#sheets.delete(k);
    }
    let sheet = this.#sheets.get(key);
    if (!sheet) {
      const cls = page._getSheetClass();
      sheet = new cls({
        id: `campaign-record-pane-${page.id}-${mode}`,
        document: page,
        mode,
        ...(mode === "view" ? { tag: "div" } : {}),
        window: { frame: false, positioned: false }
      });
      this.#sheets.set(key, sheet);
    }
    if (!sheet.rendered) await sheet.render({ force: true });
    sheet.element.classList.add("record-pane-sheet");
    container.replaceChildren(sheet.element);
  }

  async close() {
    for (const sheet of this.#sheets.values()) await sheet.close({ animate: false });
    this.#sheets.clear();
  }
}
```

- [ ] **Step 2: Create `templates/hub/record.hbs`**

```handlebars
<section class="hub-record {{#if view}}active{{/if}}">
  {{#if view}}
  <header class="record-pane-header">
    <button type="button" class="rail-toggle" data-action="toggleRail"
            data-tooltip="CAMPAIGNRECORD.Hub.ToggleRail" aria-label="{{localize "CAMPAIGNRECORD.Hub.ToggleRail"}}">
      <i class="fa-solid fa-angles-left"></i>
    </button>
    <button type="button" data-action="paneBack" {{#unless view.canGoBack}}disabled{{/unless}}
            data-tooltip="CAMPAIGNRECORD.Hub.Back" aria-label="{{localize "CAMPAIGNRECORD.Hub.Back"}}">
      <i class="fa-solid fa-arrow-left"></i>
    </button>
    <button type="button" data-action="paneForward" {{#unless view.canGoForward}}disabled{{/unless}}
            data-tooltip="CAMPAIGNRECORD.Hub.Forward" aria-label="{{localize "CAMPAIGNRECORD.Hub.Forward"}}">
      <i class="fa-solid fa-arrow-right"></i>
    </button>
    <h2 class="record-pane-title">{{view.name}}</h2>
    {{#if view.canEdit}}
    <button type="button" class="edit-toggle" data-action="toggleEditMode"
            data-tooltip="{{#if view.editing}}CAMPAIGNRECORD.Hub.DoneEditing{{else}}CAMPAIGNRECORD.Hub.EditRecord{{/if}}"
            aria-label="{{#if view.editing}}{{localize "CAMPAIGNRECORD.Hub.DoneEditing"}}{{else}}{{localize "CAMPAIGNRECORD.Hub.EditRecord"}}{{/if}}">
      <i class="fa-solid {{#if view.editing}}fa-eye{{else}}fa-pen-to-square{{/if}}"></i>
    </button>
    {{/if}}
  </header>
  <div class="record-pane-body">
    <aside class="record-rail {{#if view.railCollapsed}}collapsed{{/if}}">
      {{#each view.railGroups}}
      <h4>{{this.label}}</h4>
      <ol>
        {{#each this.records}}
        <li class="rail-record {{#if this.current}}current{{/if}}" data-action="openRecord"
            data-uuid="{{this.uuid}}">{{this.name}}</li>
        {{/each}}
      </ol>
      {{/each}}
    </aside>
    <div class="record-pane-mount journal-entry-page"></div>
  </div>
  {{/if}}
</section>
```

(The mount carries `journal-entry-page` so core content styles and existing e2e selectors like `.journal-entry-page dl.record-facts` keep working. The rail markup ships now; Task 6 fills `railGroups` and the toggle handler.)

- [ ] **Step 3: Wire the pane into `HubMixin`**

In `scripts/apps/hub/hub-mixin.mjs`, apply ALL of the following:

Add imports:

```js
import { MODULE_ID, THUMBNAILS_SETTING, RAIL_SETTING, RECORD_TYPES, typeId } from "../../constants.mjs";
import { isRecordVisible } from "../../logic/visibility.mjs";
import { RecordPane } from "./record-pane.mjs";
import {
  createHistory, pushEntry, canGoBack, canGoForward, goBack, goForward, prunePage
} from "./pane-history.mjs";
```

(`RAIL_SETTING` is added to `constants.mjs` in Step 4; `isRecordVisible` joins the existing `hasGroupFlag` import from `visibility.mjs`.)

Add to `static PARTS` (after `search`):

```js
record: { template: "modules/campaign-record/templates/hub/record.hbs" }
```

Add to `DEFAULT_OPTIONS.actions`:

```js
paneBack: HubBase.#onPaneBack,
paneForward: HubBase.#onPaneForward,
toggleRail: HubBase.#onToggleRail,
toggleEditMode: HubBase.#onToggleEditMode
```

Add instance state and members:

```js
#history = createHistory();
#pane = new RecordPane();

/** The viewed page resolved within scope, or null. */
#resolveViewedPage() {
  if (!this.state.view) return null;
  for (const group of getScopedGroups(this.groupScopeId)) {
    const page = group.pages.get(this.state.view.pageId);
    if (page) return page;
  }
  return null;
}

#inScope(page) {
  return getScopedGroups(this.groupScopeId).some((g) => g.id === page.parent?.id);
}

async navigateToRecord(pageId, { mode = "view", pushHistory = true } = {}) {
  this.state.view = { pageId, mode };
  if (pushHistory) pushEntry(this.#history, { kind: "record", pageId });
  await this.render();
}

async navigateToIndex({ pushHistory = true } = {}) {
  this.state.view = null;
  if (pushHistory) pushEntry(this.#history, { kind: "index" });
  await this.render();
}

async #applyHistoryEntry(entry) {
  if (!entry) return;
  if (entry.kind === "index") return this.navigateToIndex({ pushHistory: false });
  return this.navigateToRecord(entry.pageId, { pushHistory: false });
}

static async #onPaneBack() {
  await this.#applyHistoryEntry(goBack(this.#history));
}

static async #onPaneForward() {
  await this.#applyHistoryEntry(goForward(this.#history));
}

static async #onToggleRail() {
  const current = game.settings.get(MODULE_ID, RAIL_SETTING);
  await game.settings.set(MODULE_ID, RAIL_SETTING, !current);
  this.render();
}

static async #onToggleEditMode() {
  if (!this.state.view) return;
  this.state.view.mode = this.state.view.mode === "edit" ? "view" : "edit";
  await this.render();
}
```

Replace the body of `static async #onOpenRecord` with in-pane navigation:

```js
static async #onOpenRecord(event, target) {
  const page = await fromUuid(target.closest("[data-uuid]").dataset.uuid);
  if (!page) return;
  if (this.#inScope(page)) return this.navigateToRecord(page.id);
  // Out-of-scope record (e.g. cross-group timeline chip): open its group's sheet.
  await page.parent.sheet.render(true, { pageId: page.id });
}
```

In `_prepareContext`, after `context.timelineGroups = …`, add (rail members are placeholders until Task 6):

```js
const viewedPage = this.#resolveViewedPage();
if (this.state.view && (!viewedPage || !isRecordVisible(game.user, viewedPage))) {
  // Deleted or no longer visible: fall back to the index.
  if (this.state.view) prunePage(this.#history, this.state.view.pageId);
  this.state.view = null;
}
context.view = this.state.view && viewedPage
  ? {
      name: viewedPage.name,
      editing: this.state.view.mode === "edit",
      canEdit: viewedPage.canUserModify(game.user, "update"),
      canGoBack: canGoBack(this.#history),
      canGoForward: canGoForward(this.#history),
      railCollapsed: game.settings.get(MODULE_ID, RAIL_SETTING),
      railGroups: []
    }
  : null;
```

In `_onDocumentChanged`, before `this.#debouncedRender();`, add:

```js
if (hook === "deleteJournalEntryPage" && this.state.view?.pageId === doc.id) {
  prunePage(this.#history, doc.id);
  this.state.view = null;
}
```

In `_onRender`, at the end, add mounting, the viewing-record class, and tab-exit:

```js
this.element.classList.toggle("viewing-record", !!this.state.view);
const mount = this.element.querySelector(".record-pane-mount");
if (mount && this.state.view) {
  const page = this.#resolveViewedPage();
  if (page) {
    this.#pane.mount(mount, page, this.state.view.mode).catch((error) => {
      console.error("campaign-record | failed to render record pane", error);
      ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.RecordUnavailable"));
      this.navigateToIndex();
    });
  }
}
```

And extend the existing `tabNav` binding block (`if (tabNav && !tabNav.dataset.crBound)`) — inside the `for` loop over tab links, add alongside the existing `dragenter` listener:

```js
link.addEventListener("click", () => {
  if (this.state.view) this.navigateToIndex();
});
```

In `_onClose`, before `super._onClose(options);`, add:

```js
this.#pane.close();
```

- [ ] **Step 4: Constants, setting, i18n, CSS**

`scripts/constants.mjs` — add:

```js
/** Client setting: record-pane navigation rail collapsed. */
export const RAIL_SETTING = "recordRailCollapsed";
```

`scripts/hooks/hub-ui.mjs` — in `registerHubSettings()`, add (and import `RAIL_SETTING`):

```js
game.settings.register(MODULE_ID, RAIL_SETTING, {
  scope: "client",
  config: false,
  type: Boolean,
  default: false
});
```

`lang/en.json` — add inside the `Hub` object:

```json
"Back": "Back",
"Forward": "Forward",
"ToggleRail": "Toggle record list",
"EditRecord": "Edit record",
"DoneEditing": "Done editing",
"RecordUnavailable": "That record can no longer be displayed."
```

`styles/campaign-record.css` — append:

```css
/* ---- Hub record pane ---- */
.campaign-hub .hub-record { display: none; }
.campaign-hub.viewing-record .hub-record {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.campaign-hub.viewing-record section.tab { display: none; }
.record-pane-header {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid var(--color-border, #7a7971);
}
.record-pane-header h2.record-pane-title {
  flex: 1;
  margin: 0;
  font-size: var(--font-size-18, 1.125rem);
  border: none;
}
.record-pane-header button {
  width: 2rem;
  flex: 0 0 auto;
  line-height: 1.5rem;
}
.record-pane-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.record-rail {
  flex: 0 0 180px;
  overflow-y: auto;
  padding: 0.25rem 0.5rem;
  border-right: 1px solid var(--color-border, #7a7971);
}
.record-rail.collapsed { display: none; }
.record-rail h4 { margin: 0.5rem 0 0.25rem; }
.record-rail ol { list-style: none; margin: 0; padding: 0; }
.record-rail .rail-record {
  cursor: pointer;
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
}
.record-rail .rail-record:hover { background: rgba(0, 0, 0, 0.1); }
.record-rail .rail-record.current {
  background: rgba(0, 0, 0, 0.15);
  font-weight: bold;
}
.record-pane-mount {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}
```

- [ ] **Step 5: Write the e2e tests**

```js
// tests/e2e/21-hub-record-pane.spec.mjs
import { test, expect } from "@playwright/test";
import { login, createGroupWithPage, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

test.describe("hub record pane", () => {
  test.afterEach(async ({ page }) => {
    await deleteGroupsByPrefix(page, "E2E Pane");
  });

  test("index click opens the record in-pane; tabs return to the index", async ({ page }) => {
    await login(page, "Gamemaster");
    await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Npc", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.waitFor();
    await hub.locator(".record-row", { hasText: "E2E Pane Npc" }).click();

    await expect(hub.locator(".record-pane-title")).toHaveText("E2E Pane Npc");
    await expect(hub.locator(".record-pane-mount dl.record-facts")).toBeVisible();
    await expect(hub.locator('.hub-index[data-tab="index"]')).toBeHidden();

    await hub.locator('[data-action="tab"][data-tab="index"]').click();
    await expect(hub.locator('.hub-index[data-tab="index"]')).toBeVisible();
    await expect(hub.locator(".record-pane-title")).toHaveCount(0);
  });

  test("deleting the viewed record falls back to the index", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Doomed", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.locator(".record-row", { hasText: "E2E Pane Doomed" }).click();
    await expect(hub.locator(".record-pane-title")).toHaveText("E2E Pane Doomed");
    await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).delete(),
      ids
    );
    await expect(hub.locator('.hub-index[data-tab="index"]')).toBeVisible();
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `npm test` — all unit tests pass (i18n coverage picks up the new keys).
Run: `npm run test:e2e -- tests/e2e/21-hub-record-pane.spec.mjs` — expected PASS (2 tests).
Run: `npm run test:e2e -- tests/e2e/05-hub.spec.mjs tests/e2e/06-hub-index.spec.mjs` — expected PASS (index still works when not viewing).

- [ ] **Step 7: Commit**

```bash
git add scripts/apps/hub/record-pane.mjs templates/hub/record.hbs scripts/apps/hub/hub-mixin.mjs \
  scripts/constants.mjs scripts/hooks/hub-ui.mjs lang/en.json styles/campaign-record.css \
  tests/e2e/21-hub-record-pane.spec.mjs
git commit -m "feat: in-pane record viewing in the campaign hub"
```

---

### Task 6: Left navigation rail

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs`
- Test: `tests/e2e/21-hub-record-pane.spec.mjs` (extend)

**Interfaces:**
- Consumes: `#indexEntries()` (existing), `context.view.railGroups` slot and `templates/hub/record.hbs` rail markup (Task 5).
- Produces: `context.view.railGroups: Array<{label, records: Array<{uuid, name, current}>}>` — grouped by record type, filters applied, current record flagged.

- [ ] **Step 1: Fill `railGroups` in `_prepareContext`**

In `hub-mixin.mjs`, add this private method:

```js
/** Rail entries: the filtered index grouped by type, current record flagged. */
#railGroups(currentPageId) {
  const { records } = this.#indexEntries();
  const byType = new Map();
  for (const record of records) {
    if (!byType.has(record.shortType)) {
      const label = record.shortType === "journal"
        ? game.i18n.localize("CAMPAIGNRECORD.Hub.JournalPage")
        : game.i18n.localize(`TYPES.JournalEntryPage.${typeId(record.shortType)}`);
      byType.set(record.shortType, { label, records: [] });
    }
    byType.get(record.shortType).records.push({
      uuid: record.uuid,
      name: record.name,
      current: record.id === currentPageId
    });
  }
  return [...byType.values()];
}
```

In the `context.view` object (Task 5 Step 3), replace `railGroups: []` with:

```js
railGroups: this.#railGroups(this.state.view.pageId)
```

- [ ] **Step 2: Extend the e2e spec**

Add to `tests/e2e/21-hub-record-pane.spec.mjs`:

```js
test("rail lists group records, highlights current, and jumps on click", async ({ page }) => {
  await login(page, "Gamemaster");
  const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane One", "campaign-record.npc");
  await page.evaluate(async ({ groupId }) => {
    await game.journal.get(groupId).createEmbeddedDocuments("JournalEntryPage", [
      { name: "E2E Pane Two", type: "campaign-record.place" }
    ]);
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    CampaignHub.open();
  }, ids);
  const hub = page.locator("#campaign-hub");
  await hub.locator(".record-row", { hasText: "E2E Pane One" }).click();

  const rail = hub.locator(".record-rail");
  await expect(rail.locator(".rail-record", { hasText: "E2E Pane One" })).toHaveClass(/current/);
  await rail.locator(".rail-record", { hasText: "E2E Pane Two" }).click();
  await expect(hub.locator(".record-pane-title")).toHaveText("E2E Pane Two");
  await expect(rail.locator(".rail-record", { hasText: "E2E Pane Two" })).toHaveClass(/current/);
});

test("rail collapse persists across a close/reopen", async ({ page }) => {
  await login(page, "Gamemaster");
  await createGroupWithPage(page, "E2E Pane Group", "E2E Pane One", "campaign-record.npc");
  await page.evaluate(async () => {
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    CampaignHub.open();
  });
  const hub = page.locator("#campaign-hub");
  await hub.locator(".record-row", { hasText: "E2E Pane One" }).click();
  await hub.locator('[data-action="toggleRail"]').click();
  await expect(hub.locator(".record-rail")).toHaveClass(/collapsed/);

  await page.evaluate(async () => {
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    CampaignHub.toggle(); // close
    CampaignHub.toggle(); // reopen
  });
  await hub.locator(".record-row", { hasText: "E2E Pane One" }).click();
  await expect(hub.locator(".record-rail")).toHaveClass(/collapsed/);
});
```

- [ ] **Step 3: Run and commit**

Run: `npm run test:e2e -- tests/e2e/21-hub-record-pane.spec.mjs` — expected PASS (4 tests). `npm test` — green.

```bash
git add scripts/apps/hub/hub-mixin.mjs tests/e2e/21-hub-record-pane.spec.mjs
git commit -m "feat: collapsible navigation rail in the record pane"
```

---

### Task 7: Back/forward traversal e2e (wiring landed in Task 5)

**Files:**
- Test: `tests/e2e/21-hub-record-pane.spec.mjs` (extend)

**Interfaces:**
- Consumes: `paneBack`/`paneForward` actions and history wiring from Task 5; rail from Task 6.

- [ ] **Step 1: Add the traversal test (including a loop)**

```js
test("back/forward traverse visits, loops included", async ({ page }) => {
  await login(page, "Gamemaster");
  const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane A", "campaign-record.npc");
  await page.evaluate(async ({ groupId }) => {
    await game.journal.get(groupId).createEmbeddedDocuments("JournalEntryPage", [
      { name: "E2E Pane B", type: "campaign-record.place" }
    ]);
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    CampaignHub.open();
  }, ids);
  const hub = page.locator("#campaign-hub");
  const rail = hub.locator(".record-rail");
  const title = hub.locator(".record-pane-title");

  // Visit A -> B -> A (a loop) via index + rail jumps.
  await hub.locator(".record-row", { hasText: "E2E Pane A" }).click();
  await rail.locator(".rail-record", { hasText: "E2E Pane B" }).click();
  await rail.locator(".rail-record", { hasText: "E2E Pane A" }).click();
  await expect(title).toHaveText("E2E Pane A");

  await hub.locator('[data-action="paneBack"]').click();
  await expect(title).toHaveText("E2E Pane B");
  await hub.locator('[data-action="paneBack"]').click();
  await expect(title).toHaveText("E2E Pane A");
  await hub.locator('[data-action="paneBack"]').click();
  await expect(hub.locator('.hub-index[data-tab="index"]')).toBeVisible(); // root

  await hub.locator('[data-action="paneForward"]').click();
  await expect(title).toHaveText("E2E Pane A");
  await hub.locator('[data-action="paneForward"]').click();
  await expect(title).toHaveText("E2E Pane B");
});
```

- [ ] **Step 2: Run and commit**

Run: `npm run test:e2e -- tests/e2e/21-hub-record-pane.spec.mjs` — expected PASS (5 tests).

```bash
git add tests/e2e/21-hub-record-pane.spec.mjs
git commit -m "test: back/forward history traversal including link loops"
```

---

### Task 8: Edit mode, text pages, and new-record-in-pane

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs` (`#onNewRecord` only)
- Test: `tests/e2e/21-hub-record-pane.spec.mjs` (extend)

**Interfaces:**
- Consumes: `toggleEditMode` action and `RecordPane` mode support (Task 5); the Task 3 spike decision.
- Produces: `#onNewRecord` ends with in-pane edit navigation instead of opening a window.

- [ ] **Step 1: Route new records into the pane**

In `hub-mixin.mjs` `static async #onNewRecord`, replace the final line `page.sheet.render(true);` with:

```js
if (this.#inScope(page)) await this.navigateToRecord(page.id, { mode: "edit" });
else await page.parent.sheet.render(true, { pageId: page.id });
```

- [ ] **Step 2 (only if Task 3 was NO-GO): text page edit fallback**

Skip this step entirely if the spike passed — the generic mount already handles text pages in both modes because `page._getSheetClass()` returns the core text sheet.

If the spike failed: in `RecordPane.mount`, special-case text pages in edit mode with a hub-owned ProseMirror element instead of a sheet instance:

```js
// In RecordPane.mount, before the sheet-cache logic:
if (page.type === "text" && mode === "edit") {
  const editor = foundry.applications.elements.HTMLProseMirrorElement.create({
    name: "text.content",
    value: page.text.content ?? "",
    document: page,
    editable: true,
    collaborate: true
  });
  editor.addEventListener("save", (event) => {
    page.update({ "text.content": event.target.value });
  });
  container.replaceChildren(editor);
  return;
}
```

Verify the exact `HTMLProseMirrorElement.create` option names against `client/applications/elements/prosemirror-editor.mjs` in the local Foundry install (`/Users/danbularzik/FoundryVTT/FoundryVTT-Node-13.351`) before using — adjust to the real API if it differs.

- [ ] **Step 3: Extend the e2e spec**

```js
test("edit toggle flips to the edit form and persists a change", async ({ page }) => {
  await login(page, "Gamemaster");
  const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Editable", "campaign-record.npc");
  await page.evaluate(async () => {
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    CampaignHub.open();
  });
  const hub = page.locator("#campaign-hub");
  await hub.locator(".record-row", { hasText: "E2E Pane Editable" }).click();

  await hub.locator('[data-action="toggleEditMode"]').click();
  const roleInput = hub.locator('.record-pane-mount [name="system.role"]');
  await roleInput.waitFor();
  await roleInput.fill("Quartermaster");
  await roleInput.blur(); // submitOnChange persists

  await hub.locator('[data-action="toggleEditMode"]').click();
  await expect(hub.locator(".record-pane-mount dl.record-facts")).toContainText("Quartermaster");
  const stored = await page.evaluate(
    ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.role,
    ids
  );
  expect(stored).toBe("Quartermaster");
});

test("text pages view and edit in-pane", async ({ page }) => {
  await login(page, "Gamemaster");
  const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Text", "text");
  await page.evaluate(async ({ groupId, pageId }) => {
    await game.journal.get(groupId).pages.get(pageId).update({
      "text.content": "<p>Chronicle of the keep</p>"
    });
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    CampaignHub.open();
  }, ids);
  const hub = page.locator("#campaign-hub");
  await hub.locator(".record-row", { hasText: "E2E Pane Text" }).click();
  await expect(hub.locator(".record-pane-mount")).toContainText("Chronicle of the keep");

  await hub.locator('[data-action="toggleEditMode"]').click();
  await expect(hub.locator('.record-pane-mount [contenteditable="true"]').first()).toBeVisible();
});

test("new record opens in-pane in edit mode", async ({ page }) => {
  await login(page, "Gamemaster");
  await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Seed", "campaign-record.npc");
  await page.evaluate(async () => {
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    CampaignHub.open();
  });
  const hub = page.locator("#campaign-hub");
  await hub.locator('[data-action="newRecord"]').click();
  const dialog = page.locator(".dialog, dialog.application").last();
  await dialog.locator('input[name="name"]').fill("E2E Pane Fresh");
  await dialog.locator('select[name="group"]').selectOption({ label: "E2E Pane Group" });
  await dialog.locator("button", { hasText: /create/i }).click();

  await expect(hub.locator(".record-pane-title")).toHaveText("E2E Pane Fresh");
  await expect(hub.locator('.record-pane-mount [name="system.role"]')).toBeVisible();
});

test("player without update permission gets no edit toggle", async ({ page, browser }) => {
  await login(page, "Gamemaster");
  const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Locked", "campaign-record.npc");
  await page.evaluate(async ({ groupId }) => {
    await game.journal.get(groupId).update({
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
    });
  }, ids);

  const ctx = await browser.newContext();
  const playerPage = await ctx.newPage();
  await login(playerPage, "User 1");
  await playerPage.evaluate(async () => {
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    CampaignHub.open();
  });
  const hub = playerPage.locator("#campaign-hub");
  await hub.locator(".record-row", { hasText: "E2E Pane Locked" }).click();
  await expect(hub.locator(".record-pane-title")).toHaveText("E2E Pane Locked");
  await expect(hub.locator('[data-action="toggleEditMode"]')).toHaveCount(0);
  await ctx.close();
});
```

Note for the new-record dialog selectors: `DialogV2.prompt` renders a `<dialog class="application dialog-v2 …">`; check the 06-hub-index spec for the selectors it already uses for this dialog and reuse those exact selectors if they differ from the above.

- [ ] **Step 4: Run and commit**

Run: `npm run test:e2e -- tests/e2e/21-hub-record-pane.spec.mjs` — expected PASS (9 tests). `npm test` — green.

```bash
git add scripts/apps/hub/hub-mixin.mjs tests/e2e/21-hub-record-pane.spec.mjs scripts/apps/hub/record-pane.mjs
git commit -m "feat: in-pane editing, text-page support, and new-record flow"
```

---

### Task 9: Content-link interception (in-pane and cross-group)

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs`
- Test: `tests/e2e/21-hub-record-pane.spec.mjs` (extend)

**Interfaces:**
- Consumes: `classifyLinkTarget(doc, scopedGroupIds)` (Task 2); `navigateToRecord` (Task 5).

- [ ] **Step 1: Add the capture-phase click handler**

In `hub-mixin.mjs`, import `classifyLinkTarget` from `"../../logic/record-links.mjs"`, then add to `_onRender` (once-guarded like other bindings):

```js
if (!this.element.dataset.crLinkBound) {
  this.element.dataset.crLinkBound = "1";
  this.element.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest("a.content-link[data-uuid]");
      if (!link) return;
      const doc = fromUuidSync(link.dataset.uuid);
      const scoped = new Set(getScopedGroups(this.groupScopeId).map((g) => g.id));
      const target = classifyLinkTarget(doc, scoped);
      if (target.kind === "external") return; // Foundry's default handling
      event.preventDefault();
      event.stopPropagation();
      if (target.kind === "in-pane") this.navigateToRecord(target.pageId);
      else doc.parent.sheet.render(true, { pageId: target.pageId });
    },
    true
  );
}
```

(`fromUuidSync` resolves world documents synchronously; group pages are always world documents.)

- [ ] **Step 2: Extend the e2e spec**

```js
test("record links inside a record navigate in-pane", async ({ page }) => {
  await login(page, "Gamemaster");
  const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Source", "campaign-record.npc");
  await page.evaluate(async ({ groupId }) => {
    const group = game.journal.get(groupId);
    const [target] = await group.createEmbeddedDocuments("JournalEntryPage", [
      { name: "E2E Pane Target", type: "campaign-record.place" }
    ]);
    const source = group.pages.getName("E2E Pane Source");
    await source.update({ "system.description": `<p>See @UUID[${target.uuid}]{the target}</p>` });
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    CampaignHub.open();
  }, ids);
  const hub = page.locator("#campaign-hub");
  await hub.locator(".record-row", { hasText: "E2E Pane Source" }).click();
  await hub.locator(".record-pane-mount a.content-link", { hasText: "the target" }).click();
  await expect(hub.locator(".record-pane-title")).toHaveText("E2E Pane Target");
  await expect(hub.locator(".record-rail .rail-record", { hasText: "E2E Pane Target" })).toHaveClass(/current/);
});
```

(A cross-group link test lands in Task 10, once `GroupHubSheet` exists to open.)

- [ ] **Step 3: Run and commit**

Run: `npm run test:e2e -- tests/e2e/21-hub-record-pane.spec.mjs` — expected PASS (10 tests).

```bash
git add scripts/apps/hub/hub-mixin.mjs tests/e2e/21-hub-record-pane.spec.mjs
git commit -m "feat: content links to group records navigate in-pane"
```

---

### Task 10: GroupHubSheet — the hub as the group's journal sheet

**Files:**
- Create: `scripts/apps/hub/group-hub-sheet.mjs`
- Modify: `scripts/apps/hub/hub-mixin.mjs` (`_preRender` pageId handling)
- Modify: `scripts/sheets/registration.mjs`
- Modify: `scripts/data/groups.mjs`
- Modify: `scripts/constants.mjs`
- Modify: `lang/en.json`
- Test: `tests/e2e/22-group-hub-sheet.spec.mjs`

**Interfaces:**
- Consumes: `HubMixin` (Task 4), pane/navigation (Task 5), `classifyLinkTarget` routing (Task 9 uses `doc.parent.sheet.render(true, {pageId})` — this task makes that resolve to a hub).
- Produces: `GroupHubSheet extends HubMixin(DocumentSheetV2)` with `groupScopeId -> this.document.id`, `showsGroupPicker -> false`, `goToPage(pageId)` (compat with core `JournalEntrySheet` API and existing e2e helpers); constant `GROUP_SHEET_CLASS = "campaign-record.GroupHubSheet"`; new groups created with `flags.core.sheetClass = GROUP_SHEET_CLASS`.

- [ ] **Step 1: Add the constant**

`scripts/constants.mjs`:

```js
/** Registered sheet id (scope.ClassName) that opens groups in the Campaign Hub. */
export const GROUP_SHEET_CLASS = `${MODULE_ID}.GroupHubSheet`;
```

- [ ] **Step 2: Implement `GroupHubSheet`**

```js
// scripts/apps/hub/group-hub-sheet.mjs
import { HubMixin } from "./hub-mixin.mjs";

const { DocumentSheetV2 } = foundry.applications.api;

/** The Campaign Hub rendered as a group's own JournalEntry sheet. */
export class GroupHubSheet extends HubMixin(DocumentSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["group-hub"],
    window: { resizable: true, icon: "fa-solid fa-book-atlas" },
    position: { width: 760, height: 640 },
    // The hub's inputs are UI state, not document fields — never submit them.
    form: { submitOnChange: false, closeOnSubmit: false }
  };

  get groupScopeId() {
    return this.document.id;
  }

  get showsGroupPicker() {
    return false;
  }

  /** Core JournalEntrySheet API compat: content links and callers land in-pane. */
  goToPage(pageId) {
    return this.navigateToRecord(pageId);
  }
}
```

- [ ] **Step 3: Handle `render(true, {pageId})` in the mixin**

Core routes page content-links as `page.parent.sheet.render(true, {pageId, anchor})` (`JournalEntryPage._onClickDocumentLink`). Add to `HubBase` in `hub-mixin.mjs`:

```js
async _preRender(context, options) {
  await super._preRender(context, options);
  if (options.pageId) {
    this.state.view = { pageId: options.pageId, mode: "view" };
    pushEntry(this.#history, { kind: "record", pageId: options.pageId });
    delete options.pageId; // consumed; must not re-trigger on later renders
  }
}
```

- [ ] **Step 4: Register the sheet and flag new groups**

`scripts/sheets/registration.mjs` — add imports and registration:

```js
import { GroupHubSheet } from "../apps/hub/group-hub-sheet.mjs";
// …inside registerSheets(), after the page sheets:
DocumentSheetConfig.registerSheet(JournalEntry, MODULE_ID, GroupHubSheet, {
  label: "CAMPAIGNRECORD.Sheets.GroupHub",
  makeDefault: false
});
```

`scripts/data/groups.mjs` — in `createGroup`, extend the `flags` object:

```js
flags: {
  [MODULE_ID]: { [GROUP_FLAG]: { timepoints: [] } },
  core: { sheetClass: GROUP_SHEET_CLASS }
}
```

(and add `GROUP_SHEET_CLASS` to the constants import).

`lang/en.json` — add inside `Sheets`:

```json
"GroupHub": "Campaign Hub (Group Sheet)"
```

- [ ] **Step 5: Write the e2e spec**

```js
// tests/e2e/22-group-hub-sheet.spec.mjs
import { test, expect } from "@playwright/test";
import { login, createGroupWithPage, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

test.describe("group hub sheet", () => {
  test.afterEach(async ({ page }) => {
    await deleteGroupsByPrefix(page, "E2E Sheet");
  });

  test("opening a group from the sidebar renders the hub, scoped, no dropdown", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(page, "E2E Sheet Group", "E2E Sheet Npc", "campaign-record.npc");
    await page.evaluate(({ groupId }) => game.journal.get(groupId).sheet.render(true), ids);

    const sheet = page.locator(".group-hub");
    await sheet.waitFor();
    await expect(sheet.locator('.hub-index[data-tab="index"]')).toBeVisible();
    await expect(sheet.locator('select[name="group-select"]')).toHaveCount(0);
    await expect(sheet.locator(".record-row", { hasText: "E2E Sheet Npc" })).toBeVisible();

    // Sidebar entry itself opens the same sheet class.
    await page.evaluate(() => ui.sidebar.changeTab("journal", "primary"));
    const cls = await page.evaluate(
      ({ groupId }) => game.journal.get(groupId).sheet.constructor.name,
      ids
    );
    expect(cls).toBe("GroupHubSheet");
  });

  test("goToPage/content-link routing lands in-pane", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(page, "E2E Sheet Group", "E2E Sheet Npc", "campaign-record.npc");
    await page.evaluate(async ({ groupId, pageId }) => {
      const g = game.journal.get(groupId);
      await g.sheet.render(true);
      await g.sheet.goToPage(pageId);
    }, ids);
    const sheet = page.locator(".group-hub");
    await expect(sheet.locator(".record-pane-title")).toHaveText("E2E Sheet Npc");
    await expect(sheet.locator(".record-pane-mount dl.record-facts")).toBeVisible();
  });

  test("cross-group record links open the other group's hub", async ({ page }) => {
    await login(page, "Gamemaster");
    const a = await createGroupWithPage(page, "E2E Sheet Alpha", "E2E Sheet Source", "campaign-record.npc");
    const b = await createGroupWithPage(page, "E2E Sheet Beta", "E2E Sheet Remote", "campaign-record.place");
    await page.evaluate(async ({ a, b }) => {
      const source = game.journal.get(a.groupId).pages.get(a.pageId);
      const remote = game.journal.get(b.groupId).pages.get(b.pageId);
      await source.update({ "system.description": `<p>@UUID[${remote.uuid}]{far away}</p>` });
      await game.journal.get(a.groupId).sheet.render(true);
      await game.journal.get(a.groupId).sheet.goToPage(a.pageId);
    }, { a, b });

    const alpha = page.locator(".group-hub").first();
    await alpha.locator(".record-pane-mount a.content-link", { hasText: "far away" }).click();
    const beta = page.locator(".group-hub", { hasText: "E2E Sheet Remote" }).last();
    await expect(beta.locator(".record-pane-title")).toHaveText("E2E Sheet Remote");
  });
});
```

- [ ] **Step 6: Run and commit**

Run: `npm run test:e2e -- tests/e2e/22-group-hub-sheet.spec.mjs` — expected PASS (3 tests). `npm test` — green (i18n key covered).

```bash
git add scripts/apps/hub/group-hub-sheet.mjs scripts/apps/hub/hub-mixin.mjs \
  scripts/sheets/registration.mjs scripts/data/groups.mjs scripts/constants.mjs lang/en.json \
  tests/e2e/22-group-hub-sheet.spec.mjs
git commit -m "feat: GroupHubSheet — the hub is the campaign group's journal sheet"
```

---

### Task 11: Migration — stamp the sheet flag on existing groups

**Files:**
- Modify: `scripts/constants.mjs` (SCHEMA_VERSION)
- Modify: `scripts/data/migration-runner.mjs`
- Test: `tests/e2e/18-migrations.spec.mjs` (extend)

**Interfaces:**
- Consumes: `GROUP_SHEET_CLASS` (Task 10), `MIGRATIONS`/`runMigrations` infrastructure (existing).
- Produces: `SCHEMA_VERSION = 2`; migration `{version: 2}` that sets `flags.core.sheetClass` on every group that has NO core sheet override yet (a manual user choice is respected).

- [ ] **Step 1: Bump and add the migration**

`scripts/constants.mjs`: change `export const SCHEMA_VERSION = 1;` to `export const SCHEMA_VERSION = 2;`

`scripts/data/migration-runner.mjs` — import `GROUP_SHEET_CLASS` and append to `MIGRATIONS`:

```js
{
  version: 2,
  // Pre-existing groups open in the core journal sheet; point them at the
  // hub sheet unless the user manually chose a different sheet.
  async run() {
    for (const group of getGroups()) {
      if (group.flags?.core?.sheetClass) continue;
      await group.update({ "flags.core.sheetClass": GROUP_SHEET_CLASS });
    }
  }
}
```

- [ ] **Step 2: Check the pure-logic unit test still holds**

Run: `npm test -- tests/migrations.test.js` — expected PASS unchanged (it tests `pendingMigrations` planning, not the registry contents).

- [ ] **Step 3: Extend the migrations e2e spec**

Read `tests/e2e/18-migrations.spec.mjs` first and follow its existing structure/helpers for resetting `schemaVersion`. Add a test with this exact behavior (adapting setup boilerplate to the file's conventions):

```js
test("migration 2 stamps the group sheet flag, respecting manual overrides", async ({ page }) => {
  await login(page, "Gamemaster");
  const result = await page.evaluate(async () => {
    // Simulate two pre-migration groups: no core flags at all, and a manual override.
    const [plain] = await JournalEntry.createDocuments([{
      name: "E2E Mig Plain",
      flags: { "campaign-record": { group: { timepoints: [] } } }
    }]);
    const [manual] = await JournalEntry.createDocuments([{
      name: "E2E Mig Manual",
      flags: {
        "campaign-record": { group: { timepoints: [] } },
        core: { sheetClass: "core.JournalEntrySheet" }
      }
    }]);
    await game.settings.set("campaign-record", "schemaVersion", 1);
    const { runMigrations } = await import("/modules/campaign-record/scripts/data/migration-runner.mjs");
    await runMigrations();
    const out = {
      plain: plain.flags?.core?.sheetClass ?? null,
      manual: manual.flags?.core?.sheetClass ?? null,
      version: game.settings.get("campaign-record", "schemaVersion")
    };
    await plain.delete();
    await manual.delete();
    return out;
  });
  expect(result.plain).toBe("campaign-record.GroupHubSheet");
  expect(result.manual).toBe("core.JournalEntrySheet");
  expect(result.version).toBe(2);
});
```

- [ ] **Step 4: Run and commit**

Run: `npm run test:e2e -- tests/e2e/18-migrations.spec.mjs` — expected PASS. `npm test` — green.

```bash
git add scripts/constants.mjs scripts/data/migration-runner.mjs tests/e2e/18-migrations.spec.mjs
git commit -m "feat: schema v2 migration points existing groups at the hub sheet"
```

---

### Task 12: Regression sweep — full suites green

**Files:**
- Modify: any of `tests/e2e/02-records.spec.mjs`, `03-quest.spec.mjs`, `04-collaboration-secrecy.spec.mjs`, `09-pc-item.spec.mjs`, `10-encounter.spec.mjs`, `11-checklist.spec.mjs`, `12-shop.spec.mjs`, `13-loot.spec.mjs`, `14-media.spec.mjs`, `05`–`08`, `15`, `19` as needed

**Interfaces:**
- Consumes: everything. `GroupHubSheet.goToPage` compat and the `journal-entry-page` mount class were designed so specs using `group.sheet.render(true)` + `group.sheet.goToPage(id)` + `.journal-entry-page …` selectors keep passing with minimal churn.

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: all pass (~85 tests: 71 pre-existing + Task 1 + Task 2).

- [ ] **Step 2: Run the full e2e suite**

Run: `npm run test:e2e`
Expected: mostly green thanks to the compat layer. Investigate every failure individually.

- [ ] **Step 3: Fix failing specs — expectation updates only**

Ground rules for this step:
- If a spec fails because behavior **intentionally changed** (a group's sheet is now the hub; records open in-pane), update the spec's expectations — e.g. waits for `.journal-entry-sheet` become waits for `.group-hub`, and any spec that asserted a page opens in the core journal window now asserts the pane (`.record-pane-mount`).
- If a spec fails because the **product code is wrong** (pane fails to mount, permissions leak, teardown error), fix the product code, not the spec.
- Do not delete tests. Do not loosen assertions to "anything renders".
- Specs that render **page** sheets directly (`page.sheet.render(true)`) are unaffected by design — page sheets are untouched. If one of those fails, that is a product bug.

- [ ] **Step 4: Re-run both suites to green, then commit**

Run: `npm test && npm run test:e2e`
Expected: 100% pass.

```bash
git add -A tests/
git commit -m "test: update e2e expectations for hub-as-group-sheet and in-pane records"
```

- [ ] **Step 5: Final verification and wrap-up**

- Confirm the worktree diff touches no record-sheet or data-model files (Global Constraints): `git diff main --stat -- scripts/sheets scripts/data | grep -v "groups.mjs\|migration-runner.mjs\|registration.mjs"` shows nothing unexpected.
- Announce completion; hand off to `superpowers:finishing-a-development-branch` for merge/PR decision (branch: `feature/hub-record-pane`).
