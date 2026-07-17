# Journal Edit Flicker Fix + First-Class Inline Journals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the hub from re-rendering the record pane out from under an active editor (the flicker/`matchesNode` loop), and make text/journal pages honor the inline-editing setting like typed records.

**Architecture:** Part 1 — on external document-change hooks while a valid record is open, re-render only the non-`record` parts so `.record-pane-mount` keeps its node identity and `RecordPane.mount()` early-returns without tearing down the editor; plus broaden the focus-deferral guard to recognize journal editors. Part 2 — a Campaign Record text-page sheet (subclass of `BaseRecordSheet`) that renders `text.content` inline, selected by `RecordPane.mount()` for text pages in a hub group, with the inline-editable gate extended to `text` pages.

**Tech Stack:** JavaScript ES modules, Foundry VTT v13 ApplicationV2 / JournalEntryPageHandlebarsSheet, Handlebars, vitest (unit), Playwright (e2e).

## Global Constraints

- Foundry VTT v13 (`foundry.applications.*`, `foundry.utils.*`).
- Module id `"campaign-record"` (`MODULE_ID`); `GROUP_SHEET_CLASS` marks a hub-pinned journal (`page.parent?.getFlag("core","sheetClass") === GROUP_SHEET_CLASS`).
- Inline-editing setting id: `INLINE_EDIT_SETTING` (`"inlineEditing"`).
- Pure logic modules import NO Foundry globals (must load in vitest, like `scripts/logic/doc-import.mjs`).
- Hub ApplicationV2 parts are exactly: `header`, `index`, `timeline`, `record` (`hub-mixin.mjs:79-84`).
- Inline prose elements are `<prose-mirror … data-inline-prose name="<field.path>">`; the debounced saver keys off `el.name` and calls `document.update({[name]: html}, {render:!quiet})`.
- Unit test command: `npm test` (vitest run); single file: `npx vitest run tests/<file>`.
- E2E: `npm run test:e2e` (requires the local Foundry World B; see `tests/e2e/helpers`).
- Commit style: conventional commits.

---

## File Structure

**New files:**
- `scripts/logic/hub-render.mjs` — pure `renderPartsForChange` helper.
- `tests/hub-render.test.js` — its tests.
- `scripts/sheets/text-page-sheet.mjs` — `TextPageSheet` (inline-editable journal sheet).
- `templates/text/view.hbs`, `templates/text/edit.hbs` — its templates.

**Modified files:**
- `scripts/logic/inline-edit.mjs` — rename/broaden `hasInlineFocus` → `hasActiveEditorFocus` (drop the `.inline-edit` container requirement); add `isInlineEditableView` pure helper and extend `computeInlineEdit` to permit `text` pages.
- `tests/inline-edit.test.js` — tests for the broadened predicate and the extended gate (create if absent).
- `scripts/sheets/base-record-sheet.mjs` — update the import/call of the renamed predicate.
- `scripts/apps/hub/hub-mixin.mjs` — parts-aware `#debouncedRender`/`_onDocumentChanged`; broadened guard call; `inlineEditableView` via the new helper.
- `scripts/apps/hub/record-pane.mjs` — select `TextPageSheet` for text pages in a hub group.
- `scripts/data/registration.mjs` (or wherever templates preload) — preload the two new templates if the project preloads templates.
- `tests/e2e/29-journal-edit-guard.spec.mjs` — new regression e2e.

---

## Task 1: Pure render-parts decision helper

**Files:**
- Create: `scripts/logic/hub-render.mjs`
- Test: `tests/hub-render.test.js`

**Interfaces:**
- Produces: `renderPartsForChange({ hasView, viewInvalidated }) => string[] | null`
  - `null` means "render all parts" (default full render).
  - When a record is open and still valid (`hasView && !viewInvalidated`) → `["header", "index", "timeline"]` (omit `record` so its DOM node persists).
  - Otherwise (`!hasView`, or `viewInvalidated`) → `null` (full render: rebuild or clear the pane).

- [ ] **Step 1: Write the failing test**

Create `tests/hub-render.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import { renderPartsForChange } from "../scripts/logic/hub-render.mjs";

describe("renderPartsForChange", () => {
  it("skips the record part when a valid record is open", () => {
    expect(renderPartsForChange({ hasView: true, viewInvalidated: false }))
      .toEqual(["header", "index", "timeline"]);
  });

  it("renders all parts when no record is open", () => {
    expect(renderPartsForChange({ hasView: false, viewInvalidated: false })).toBeNull();
  });

  it("renders all parts when the open view was invalidated (e.g. deleted)", () => {
    expect(renderPartsForChange({ hasView: true, viewInvalidated: true })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hub-render.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/hub-render.mjs`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/logic/hub-render.mjs`:

```javascript
/** Pure hub render-scope decisions. No Foundry globals — unit-tested with vitest. */

/**
 * Which parts to render after a document-change hook. Returning null means
 * "render all parts". When a still-valid record is open, we omit the `record`
 * part so its `.record-pane-mount` DOM node keeps its identity and the embedded
 * editor is never re-parented/torn down.
 * @param {{hasView: boolean, viewInvalidated: boolean}} state
 * @returns {string[]|null}
 */
export function renderPartsForChange({ hasView, viewInvalidated }) {
  if (hasView && !viewInvalidated) return ["header", "index", "timeline"];
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hub-render.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/hub-render.mjs tests/hub-render.test.js
git commit -m "feat(hub): pure render-parts decision helper"
```

---

## Task 2: Broaden the focus-deferral predicate

**Files:**
- Modify: `scripts/logic/inline-edit.mjs` (rename + broaden `hasInlineFocus`)
- Modify: `scripts/sheets/base-record-sheet.mjs` (import + one call site)
- Modify: `scripts/apps/hub/hub-mixin.mjs` (import + call sites)
- Test: `tests/inline-edit.test.js` (create if absent)

**Interfaces:**
- Renames `hasInlineFocus(root, active?)` to `hasActiveEditorFocus(root, active?)`.
- New behavior: returns true when `active` is inside `root` AND is a typing-style control (`input`/`select`/`textarea`, inside a `prose-mirror`, or `isContentEditable`), **regardless of any `.campaign-record-content.inline-edit` container**. Focused buttons/other elements still return false.

- [ ] **Step 1: Write the failing test**

Create (or append to) `tests/inline-edit.test.js`. This uses jsdom-style DOM; the project's vitest env provides `document` (other tests rely on DOM — confirm by running). Test:

```javascript
import { describe, it, expect } from "vitest";
import { hasActiveEditorFocus } from "../scripts/logic/inline-edit.mjs";

function root(html) {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("hasActiveEditorFocus", () => {
  it("defers for a focused text-page editor NOT wrapped in .inline-edit", () => {
    const r = root('<div class="record-pane-mount"><prose-mirror><div contenteditable="true">x</div></prose-mirror></div>');
    const active = r.querySelector('[contenteditable="true"]');
    expect(hasActiveEditorFocus(r, active)).toBe(true);
  });

  it("defers for a focused input inside root", () => {
    const r = root('<input name="system.foo">');
    expect(hasActiveEditorFocus(r, r.querySelector("input"))).toBe(true);
  });

  it("does NOT defer for a focused action button", () => {
    const r = root('<button type="button">Add</button>');
    expect(hasActiveEditorFocus(r, r.querySelector("button"))).toBe(false);
  });

  it("does NOT defer when focus is outside root", () => {
    const r = root('<input>');
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    expect(hasActiveEditorFocus(r, outside)).toBe(false);
  });

  it("is false with no active element", () => {
    const r = root('<input>');
    expect(hasActiveEditorFocus(r, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/inline-edit.test.js`
Expected: FAIL — `hasActiveEditorFocus` not exported. (If the run errors that `document` is undefined, the vitest config lacks a DOM env — in that case set this file's environment with a top-of-file comment `// @vitest-environment jsdom`; jsdom ships with vitest.)

- [ ] **Step 3: Rename and broaden in `scripts/logic/inline-edit.mjs`**

Replace the existing `hasInlineFocus` function (lines ~82-90) with:

```javascript
/**
 * Is the user focused on a typing-style control inside `root`? Render guards
 * defer re-renders while this is true so auto-saves / external updates don't
 * destroy the control being typed in. Matches inputs, selects, textareas,
 * anything within a prose-mirror editor, and contenteditable — anywhere in
 * root (record inline views AND core text-page editors). A focused action
 * button is none of these, so it still does not suppress the re-render that
 * shows its own structural result.
 */
export function hasActiveEditorFocus(root, active = document.activeElement) {
  if (!root || !active || !root.contains(active)) return false;
  return (
    !!active.matches?.("input, select, textarea") ||
    !!active.closest?.("prose-mirror") ||
    active.isContentEditable === true
  );
}
```

- [ ] **Step 4: Update the two call sites**

In `scripts/sheets/base-record-sheet.mjs`: change the import `hasInlineFocus` → `hasActiveEditorFocus` (line 6) and both uses (lines 70, 80) to `hasActiveEditorFocus(this.element)`.

In `scripts/apps/hub/hub-mixin.mjs`: change the import `hasInlineFocus` → `hasActiveEditorFocus` (line 7) and both uses (lines 193, 205) to `hasActiveEditorFocus(mount)`.

Confirm no other references remain:

Run: `grep -rn "hasInlineFocus" scripts/` — expect NO matches.

- [ ] **Step 5: Run tests + syntax**

Run: `npx vitest run tests/inline-edit.test.js` — Expected: PASS (5 tests).
Run: `node --check scripts/sheets/base-record-sheet.mjs && node --check scripts/apps/hub/hub-mixin.mjs` — Expected: no output.
Run: `npm test` — Expected: full suite passes.

- [ ] **Step 6: Commit**

```bash
git add scripts/logic/inline-edit.mjs scripts/sheets/base-record-sheet.mjs scripts/apps/hub/hub-mixin.mjs tests/inline-edit.test.js
git commit -m "feat(hub): broaden edit-focus guard to cover journal (text-page) editors"
```

---

## Task 3: Root fix — don't re-render the record part on external updates

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs` (`#debouncedRender` :175-177, `_onDocumentChanged` :224-241)

**Interfaces:**
- Consumes: `renderPartsForChange` (Task 1).
- Behavior: when a document-change hook fires while a still-valid record is open, render only `["header","index","timeline"]`; otherwise render all parts.

- [ ] **Step 1: Add the import**

At the top of `scripts/apps/hub/hub-mixin.mjs`, add:

```javascript
import { renderPartsForChange } from "../../logic/hub-render.mjs";
```

- [ ] **Step 2: Make the debounced render parts-aware**

Replace the `#debouncedRender` field (lines 175-177):

```javascript
    #debouncedRender = foundry.utils.debounce(() => {
      if (this.rendered) this.render();
    }, 100);
```

with:

```javascript
    // Rebuilt each fire with the current view state so an external update that
    // arrives while a record is open never re-renders the `record` part (which
    // would re-mount the pane and tear down the active editor).
    #debouncedRender = foundry.utils.debounce(() => {
      if (!this.rendered) return;
      const parts = renderPartsForChange({
        hasView: !!this.state.view,
        viewInvalidated: !!this.state.view && !this.#resolveViewedPage()
      });
      this.render(parts ? { parts } : {});
    }, 100);
```

- [ ] **Step 3: Verify `_onDocumentChanged` still nulls a deleted view before the render**

No code change needed here, but confirm ordering: `_onDocumentChanged` (lines 224-241) already sets `this.state.view = null` for a deleted viewed page BEFORE calling `this.#debouncedRender()`. When the deleted page is the viewed one, `hasView` is then false → full render (clears the pane). When another page updates, `hasView` is true and `#resolveViewedPage()` still resolves → partial render (record part preserved). This is the intended behavior; leave the method as is.

- [ ] **Step 4: Syntax + suite**

Run: `node --check scripts/apps/hub/hub-mixin.mjs` — Expected: no output.
Run: `npm test` — Expected: full suite passes.

- [ ] **Step 5: Commit**

```bash
git add scripts/apps/hub/hub-mixin.mjs
git commit -m "fix(hub): skip the record part on external updates so the editor isn't torn down"
```

---

## Task 4: Extend the inline-editable gate to text pages

**Files:**
- Modify: `scripts/logic/inline-edit.mjs` (add `isInlineEditableView`; extend `computeInlineEdit`)
- Modify: `scripts/apps/hub/hub-mixin.mjs` (use `isInlineEditableView` at :835-839)
- Test: `tests/inline-edit.test.js`

**Interfaces:**
- New pure helper: `isInlineEditableView({ enabled, canEdit, type, inGroup }) => boolean` — true when `enabled && canEdit && inGroup` and `type` is a Campaign Record record type (`type.startsWith("campaign-record.")`) **or** `type === "text"`.
- `computeInlineEdit` stays the shape it is (it does not gate on type — the sheet only renders inline when its own template opts in), so no signature change; it already returns true for a `TextPageSheet` in a hub group with the setting on.

- [ ] **Step 1: Write the failing test**

Append to `tests/inline-edit.test.js`:

```javascript
import { isInlineEditableView } from "../scripts/logic/inline-edit.mjs";

describe("isInlineEditableView", () => {
  const base = { enabled: true, canEdit: true, inGroup: true };
  it("is true for a record type in a hub group with the setting on", () => {
    expect(isInlineEditableView({ ...base, type: "campaign-record.npc" })).toBe(true);
  });
  it("is true for a text page in a hub group with the setting on", () => {
    expect(isInlineEditableView({ ...base, type: "text" })).toBe(true);
  });
  it("is false when the setting is off", () => {
    expect(isInlineEditableView({ ...base, enabled: false, type: "text" })).toBe(false);
  });
  it("is false when the user cannot edit", () => {
    expect(isInlineEditableView({ ...base, canEdit: false, type: "text" })).toBe(false);
  });
  it("is false outside a hub group", () => {
    expect(isInlineEditableView({ ...base, inGroup: false, type: "text" })).toBe(false);
  });
  it("is false for an unrelated page type", () => {
    expect(isInlineEditableView({ ...base, type: "image" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/inline-edit.test.js`
Expected: FAIL — `isInlineEditableView` not exported.

- [ ] **Step 3: Implement the helper**

Add to `scripts/logic/inline-edit.mjs`:

```javascript
/**
 * Should the hub treat the viewed page as inline-editable (drives whether the
 * pane shows an always-open editor vs. a view + edit-toggle)? Records and plain
 * text/journal pages both qualify; both are protected from mid-edit teardown.
 */
export function isInlineEditableView({ enabled, canEdit, type, inGroup }) {
  if (!(enabled && canEdit && inGroup)) return false;
  return type === "text" || (typeof type === "string" && type.startsWith("campaign-record."));
}
```

- [ ] **Step 4: Wire into the hub**

In `scripts/apps/hub/hub-mixin.mjs`, import `isInlineEditableView` (add to the existing import from `../../logic/inline-edit.mjs` on line 7), then replace the `inlineEditableView` block (lines 835-839):

```javascript
        const inlineEditableView =
          game.settings.get(MODULE_ID, INLINE_EDIT_SETTING) &&
          canEdit &&
          viewedPage.type.startsWith(`${MODULE_ID}.`) &&
          viewedPage.parent?.getFlag("core", "sheetClass") === GROUP_SHEET_CLASS;
```

with:

```javascript
        const inlineEditableView = isInlineEditableView({
          enabled: game.settings.get(MODULE_ID, INLINE_EDIT_SETTING),
          canEdit,
          type: viewedPage.type,
          inGroup: viewedPage.parent?.getFlag("core", "sheetClass") === GROUP_SHEET_CLASS
        });
```

- [ ] **Step 5: Tests + syntax**

Run: `npx vitest run tests/inline-edit.test.js` — Expected: PASS.
Run: `node --check scripts/apps/hub/hub-mixin.mjs` — Expected: no output.
Run: `npm test` — Expected: full suite passes.

- [ ] **Step 6: Commit**

```bash
git add scripts/logic/inline-edit.mjs scripts/apps/hub/hub-mixin.mjs tests/inline-edit.test.js
git commit -m "feat(hub): treat text/journal pages as inline-editable when the setting is on"
```

---

## Task 5: Inline-editable journal sheet + pane selection

**Files:**
- Create: `scripts/sheets/text-page-sheet.mjs`
- Create: `templates/text/view.hbs`, `templates/text/edit.hbs`
- Modify: `scripts/apps/hub/record-pane.mjs` (select `TextPageSheet` for text pages in a hub group)
- Modify: template-preload registration (see Step 4)

**Interfaces:**
- Consumes: `BaseRecordSheet` (its inline-prose saver, deferred render, focusout/preclose flush, `computeInlineEdit`), which already keys the saver off `prose-mirror[data-inline-prose]` `name`.
- Produces: `TextPageSheet` — a `BaseRecordSheet` subclass that renders `text.content` inline (setting on) or rendered content + edit button (setting off). Selected by `RecordPane.mount()` for `page.type === "text"` in a hub group.

- [ ] **Step 1: Create the templates**

Create `templates/text/view.hbs` (mirrors the record view pattern — `.campaign-record-content` toggles `.inline-edit`, and the inline branch uses `data-inline-prose`):

```handlebars
<section class="campaign-record-content text-page-view{{#if inlineEdit}} inline-edit{{/if}}">
  {{#if inlineEdit}}
  <prose-mirror name="text.content" value="{{page.text.content}}" collaborate data-inline-prose data-document-uuid="{{page.uuid}}"></prose-mirror>
  {{else}}
  <div class="text-page-content">{{{enriched.content}}}</div>
  {{/if}}
</section>
```

Create `templates/text/edit.hbs` (explicit edit mode — a plain editable prose editor, no inline-edit class so it is not treated as an always-open field; this is the "inline off → edit button" path):

```handlebars
<section class="campaign-record-content text-page-edit">
  <prose-mirror name="text.content" value="{{page.text.content}}" collaborate data-document-uuid="{{page.uuid}}"></prose-mirror>
</section>
```

- [ ] **Step 2: Create the sheet**

Create `scripts/sheets/text-page-sheet.mjs`, mirroring `NpcSheet`'s EDIT_PARTS/VIEW_PARTS pattern and enriching `text.content`:

```javascript
import { BaseRecordSheet } from "./base-record-sheet.mjs";

const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

/**
 * Inline-editable sheet for plain text/journal pages inside a hub group.
 * Reuses BaseRecordSheet's inline-prose saver + deferred-render machinery,
 * bound to `text.content` instead of a system field.
 */
export class TextPageSheet extends BaseRecordSheet {
  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/text/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/text/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.enriched.content = await TextEditorImpl.enrichHTML(this.document.text?.content ?? "", {
      relativeTo: this.document
    });
    return context;
  }
}
```

Note for the implementer: `BaseRecordSheet._prepareContext` sets `context.inlineEdit` via `computeInlineEdit` (setting + canUpdate + isView + inGroup) — that already returns true for a text page in a hub group, so no override is needed for the inline decision. Verify `BaseRecordSheet` defines the base `EDIT_PARTS`/`VIEW_PARTS` used by `...super`; if it uses a differently-named base parts object, mirror whatever `NpcSheet` spreads. `#bindInlineProse` already saves `text.content` via `document.update({ "text.content": html }, {render:!quiet})` because it keys off the element `name`.

- [ ] **Step 3: Select the sheet in the pane**

In `scripts/apps/hub/record-pane.mjs`, import the sheet and the group marker, and choose it for text pages in a hub group. At the top:

```javascript
import { TextPageSheet } from "../../sheets/text-page-sheet.mjs";
import { GROUP_SHEET_CLASS } from "../../constants.mjs";
```

Then in `mount()`, replace the sheet-class resolution (line 19, `const cls = page._getSheetClass();`) with:

```javascript
      const inHubGroup = page.parent?.getFlag("core", "sheetClass") === GROUP_SHEET_CLASS;
      const cls = (page.type === "text" && inHubGroup) ? TextPageSheet : page._getSheetClass();
```

- [ ] **Step 4: Preload the new templates (if the project preloads)**

Run: `grep -rn "loadTemplates\|templates/npc/view" scripts/` to find where record templates are registered/preloaded. If there is a preload list, add `"modules/campaign-record/templates/text/view.hbs"` and `"modules/campaign-record/templates/text/edit.hbs"`. If templates are referenced only via each sheet's PARTS (ApplicationV2 loads part templates lazily), no preload edit is needed — confirm which pattern the repo uses by checking how `templates/npc/view.hbs` is made available.

- [ ] **Step 5: Syntax + suite**

Run: `node --check scripts/sheets/text-page-sheet.mjs && node --check scripts/apps/hub/record-pane.mjs` — Expected: no output.
Run: `npm test` — Expected: full suite passes (no unit tests target this Foundry-I/O code; this confirms nothing else broke).

- [ ] **Step 6: Commit**

```bash
git add scripts/sheets/text-page-sheet.mjs templates/text/view.hbs templates/text/edit.hbs scripts/apps/hub/record-pane.mjs
git commit -m "feat(hub): inline-editable journal sheet selected for text pages in a hub group"
```

---

## Task 6: E2E regression — no teardown on external update; inline journal affordance

**Files:**
- Create: `tests/e2e/29-journal-edit-guard.spec.mjs`

**Interfaces:**
- Consumes: `login`, `createGroupWithPage`, `deleteGroupsByPrefix` from `./helpers/foundry.mjs`.

This is Foundry-I/O verified against World B. The diagnosis repro is the basis.

- [ ] **Step 1: Write the regression spec**

Create `tests/e2e/29-journal-edit-guard.spec.mjs`:

```javascript
import { test, expect } from "@playwright/test";
import { login, createGroupWithPage, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

test.describe("journal edit guard", () => {
  test.afterEach(async ({ page }) => {
    await deleteGroupsByPrefix(page, "E2E JGuard");
  });

  test("external page update does not re-mount or error while editing a journal", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await login(page, "Gamemaster");
    const { pageUuid } = await createGroupWithPage(page, "E2E JGuard Group", "E2E JGuard Journal", "text");

    await page.evaluate(async (uuid) => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
      const hub = [...foundry.applications.instances.values()].find(a => a.constructor.name === "CampaignHub");
      await hub.navigateToRecord(uuid, { mode: "edit" });
    }, pageUuid);

    await page.locator("#campaign-hub .record-pane-mount [contenteditable='true']").first().waitFor({ timeout: 10000 });

    // Instrument re-mounts of the pane content.
    await page.evaluate(() => {
      window.__remounts = 0;
      const mount = document.querySelector("#campaign-hub .record-pane-mount");
      new MutationObserver((m) => { for (const x of m) if (x.addedNodes.length) window.__remounts++; })
        .observe(mount, { childList: true });
    });

    // Fire several external page updates (a different page in the world).
    await page.evaluate(async () => {
      const other = game.journal.contents[0];
      for (let i = 0; i < 5; i++) {
        await other.update({ name: other.name }, { diff: false });
        await new Promise(r => setTimeout(r, 150));
      }
    });
    await page.waitForTimeout(500);

    const remounts = await page.evaluate(() => window.__remounts);
    const matchesNodeErrors = errors.filter(e => e.includes("matchesNode"));

    // The editor's DOM node must survive: no re-mounts, no teardown errors.
    expect(remounts).toBe(0);
    expect(matchesNodeErrors).toEqual([]);
    // Editor is still present and editable.
    await expect(page.locator("#campaign-hub .record-pane-mount [contenteditable='true']").first()).toBeVisible();
  });

  test("inline setting on makes a journal an always-open editor in view mode", async ({ page }) => {
    await login(page, "Gamemaster");
    const { pageUuid } = await createGroupWithPage(page, "E2E JGuard Group", "E2E JGuard Inline", "text");
    await page.evaluate(async () => {
      await game.settings.set("campaign-record", "inlineEditing", true);
    });
    await page.evaluate(async (uuid) => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
      const hub = [...foundry.applications.instances.values()].find(a => a.constructor.name === "CampaignHub");
      await hub.navigateToRecord(uuid, { mode: "view" });
    }, pageUuid);
    // In view mode with inline on, the journal renders an always-open editor.
    await expect(page.locator("#campaign-hub .record-pane-mount .campaign-record-content.inline-edit prose-mirror"))
      .toBeVisible({ timeout: 10000 });
  });
});
```

Note for the implementer: adjust the "external update" target if `game.journal.contents[0]` is the hub group itself — pick any journal whose update fires `updateJournalEntry`/`updateJournalEntryPage`. Confirm the inline-view selector matches the Task 5 template (`.campaign-record-content.inline-edit prose-mirror`).

- [ ] **Step 2: Run the spec**

Run: `npx playwright test tests/e2e/29-journal-edit-guard.spec.mjs`
Expected: both tests PASS. If the first test fails with `remounts > 0` or a `matchesNode` error, Part 1 (Task 3) is not effective for this trigger — investigate whether the update fires a hook that bypasses `renderPartsForChange` (e.g. a full render path).

- [ ] **Step 3: Run the existing inline-edit e2e to confirm no regression**

Run: `npx playwright test tests/e2e/18-inline-edit.spec.mjs`
Expected: PASS (record inline editing unchanged).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/29-journal-edit-guard.spec.mjs
git commit -m "test(e2e): journal edit is not torn down by external updates; inline journal affordance"
```

---

## Self-Review

**Spec coverage:**
- Part 1 root fix (skip `record` part on external update) → Task 1 (helper) + Task 3 (wiring). ✓
- Part 1 broadened deferral guard → Task 2. ✓
- Part 2 gate extended to text pages → Task 4. ✓
- Part 2 inline journal sheet + pane selection → Task 5. ✓
- Testing: pure helpers unit-tested (Tasks 1,2,4); e2e regression for no-teardown + inline affordance (Task 6). ✓
- Edge cases: deleted viewed page → full render (Task 3 Step 3); text page outside hub group → core sheet (Task 5 Step 3); inline off → edit template, still protected (Tasks 3+5). ✓

**Placeholder scan:** No TBD/TODO. Two implementer notes (Task 5 Step 4 preload detection; Task 6 target-journal selection) are explicit verification steps with concrete grep/criteria, not placeholders — they exist because the exact preload mechanism and a safe update target are environment facts the implementer confirms in-repo.

**Type consistency:** `renderPartsForChange({hasView, viewInvalidated})` → `string[]|null`, consumed identically in Task 3. `hasActiveEditorFocus(root, active?)` used at both call sites (Task 2). `isInlineEditableView({enabled, canEdit, type, inGroup})` defined (Task 4) and called with those exact keys in hub-mixin. `TextPageSheet` extends `BaseRecordSheet`, referenced in `record-pane.mjs` (Task 5).
