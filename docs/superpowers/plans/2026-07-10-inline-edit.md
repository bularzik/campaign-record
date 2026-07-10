# Inline-Editable Record Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-user toggle (default on) makes all campaign-record documents editable in place in their view mode, with auto-save — plain fields on change, rich text debounced as-you-type.

**Architecture:** Record view templates (`templates/*/view.hbs`) become mode-aware via an `inlineEdit` context flag computed in `BaseRecordSheet`. Plain fields auto-save through Foundry's native `submitOnChange` form machinery (verified active in embedded view mode — the page sheet root is a `<form>` and `isEditable` is permission-based, not mode-based). Rich text uses always-open collaborative `<prose-mirror>` elements with a debounced saver. A new `CampaignGroupSheet` (journal sheet subclass, pinned to groups via the `core.sheetClass` flag) plus a matching guard in `BaseRecordSheet` defer re-renders while an inline control has focus, so auto-saves never destroy the editor mid-typing.

**Tech Stack:** Foundry VTT v13 (AppV2, JournalEntryPageHandlebarsSheet, prose-mirror custom element), Handlebars templates, vitest (unit), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-07-10-inline-edit-design.md`

## Global Constraints

- Foundry v13 (13.351) is the target; use `foundry.applications.*` namespaced APIs, never deprecated V1 paths.
- **Before ANY e2e run, read `.claude/skills/foundry-e2e/SKILL.md` and follow it.** Run e2e only via `npm run test:e2e` (full) or `npx playwright test tests/e2e/NN-name.spec.mjs` (single spec, preferred while iterating). Never repoint the module symlink, never touch `.claude-e2e-lock`, never start/stop the Foundry server. If the lock is held by someone else: report and stop.
- All e2e-created world data uses the `E2E ` name prefix.
- Every new i18n key referenced from templates/scripts must be added to `lang/en.json` — `npm test` includes an i18n coverage test that fails on missing keys.
- All record types: npc, place, quest, pc, item, encounter, checklist, shop, loot, media.
- Setting name is exactly `inlineEditing` (client scope, default `true`); constant `INLINE_EDIT_SETTING`.
- Inline-editable sections are marked with the CSS class `inline-edit` on `.campaign-record-content` — the render guards match `.campaign-record-content.inline-edit`.
- Commit after every task (conventional commits, matching repo style, e.g. `feat: …` / `fix: …` / `test: …`).

---

### Task 1: Pure logic — `computeInlineEdit` and `createDebouncedSaver`

**Files:**
- Create: `scripts/logic/inline-edit.mjs`
- Test: `tests/inline-edit.test.js`

**Interfaces:**
- Consumes: nothing (pure module, no Foundry globals at import time).
- Produces:
  - `computeInlineEdit({ enabled, canUpdate, isView }) → boolean`
  - `createDebouncedSaver({ save, delay = 2000 }) → { prime(value), schedule(getValue), flush(getValue), cancel() }` where `save(value, { quiet })` is called with `quiet: true` from `schedule` (debounced, render-suppressed) and `quiet: false` from `flush`. Identical consecutive values are not re-saved.
  - `hasInlineFocus(root, active = document.activeElement) → boolean` — true when `active` is inside `root` AND inside a `.campaign-record-content.inline-edit` section.

- [ ] **Step 1: Write the failing test**

Create `tests/inline-edit.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeInlineEdit, createDebouncedSaver } from "../scripts/logic/inline-edit.mjs";

describe("computeInlineEdit", () => {
  it("is true only when enabled, permitted, and in view mode", () => {
    for (const enabled of [true, false]) {
      for (const canUpdate of [true, false]) {
        for (const isView of [true, false]) {
          expect(computeInlineEdit({ enabled, canUpdate, isView })).toBe(
            enabled && canUpdate && isView
          );
        }
      }
    }
  });

  it("returns a boolean even for truthy/falsy non-boolean inputs", () => {
    expect(computeInlineEdit({ enabled: 1, canUpdate: "yes", isView: {} })).toBe(true);
    expect(computeInlineEdit({ enabled: undefined, canUpdate: true, isView: true })).toBe(false);
  });
});

describe("createDebouncedSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("schedule saves quietly after the delay, once per idle period", () => {
    const save = vi.fn();
    const saver = createDebouncedSaver({ save, delay: 2000 });
    saver.schedule(() => "<p>a</p>");
    saver.schedule(() => "<p>ab</p>");
    vi.advanceTimersByTime(1999);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("<p>ab</p>", { quiet: true });
  });

  it("flush saves immediately, not quietly, and cancels the pending timer", () => {
    const save = vi.fn();
    const saver = createDebouncedSaver({ save, delay: 2000 });
    saver.schedule(() => "<p>a</p>");
    saver.flush(() => "<p>a</p>");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("<p>a</p>", { quiet: false });
    vi.advanceTimersByTime(5000);
    expect(save).toHaveBeenCalledTimes(1); // timer was cancelled
  });

  it("skips saves when the value has not changed since the last save", () => {
    const save = vi.fn();
    const saver = createDebouncedSaver({ save, delay: 2000 });
    saver.prime("<p>initial</p>");
    saver.flush(() => "<p>initial</p>");
    expect(save).not.toHaveBeenCalled();
    saver.schedule(() => "<p>changed</p>");
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledTimes(1);
    saver.schedule(() => "<p>changed</p>");
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledTimes(1); // same value, no second save
  });

  it("cancel drops a pending save without firing it", () => {
    const save = vi.fn();
    const saver = createDebouncedSaver({ save, delay: 2000 });
    saver.schedule(() => "<p>a</p>");
    saver.cancel();
    vi.advanceTimersByTime(5000);
    expect(save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/inline-edit.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/inline-edit.mjs`.

- [ ] **Step 3: Write the implementation**

Create `scripts/logic/inline-edit.mjs`:

```js
/** Pure decision + debounce plumbing for inline-editable record views. */

/** Should a record sheet render its view as inline-editable? */
export function computeInlineEdit({ enabled, canUpdate, isView }) {
  return Boolean(enabled && canUpdate && isView);
}

/**
 * Debounced field saver. schedule() saves quietly (render suppressed) after
 * `delay` ms of inactivity; flush() saves immediately with a normal render.
 * A value identical to the last saved one is skipped.
 */
export function createDebouncedSaver({ save, delay = 2000 }) {
  let timer = null;
  let lastValue = null;
  const commit = (value, quiet) => {
    if (value === lastValue) return;
    lastValue = value;
    save(value, { quiet });
  };
  return {
    /** Record the persisted value so unchanged content never saves. */
    prime(value) {
      lastValue = value;
    },
    schedule(getValue) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        commit(getValue(), true);
      }, delay);
    },
    flush(getValue) {
      if (timer) clearTimeout(timer);
      timer = null;
      commit(getValue(), false);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    }
  };
}

/**
 * Is the user focused inside an inline-editable section of `root`?
 * Render guards defer re-renders while this is true so auto-saves don't
 * destroy the control being typed in.
 */
export function hasInlineFocus(root, active = document.activeElement) {
  return (
    !!root &&
    !!active &&
    root.contains(active) &&
    !!active.closest(".campaign-record-content.inline-edit")
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/inline-edit.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/inline-edit.mjs tests/inline-edit.test.js
git commit -m "feat: inline-edit decision and debounced-saver logic"
```

---

### Task 2: Setting, constant, and hub header toggle

**Files:**
- Modify: `scripts/constants.mjs`
- Modify: `scripts/hooks/hub-ui.mjs`
- Modify: `scripts/apps/hub/campaign-hub.mjs` (actions map, `_prepareContext`, new action handler)
- Modify: `templates/hub/header.hbs`
- Modify: `lang/en.json`

**Interfaces:**
- Consumes: nothing new.
- Produces: `INLINE_EDIT_SETTING = "inlineEditing"` exported from `scripts/constants.mjs`; client setting registered under `MODULE_ID` with default `true`; hub header button with `data-action="toggleInlineEdit"`.

- [ ] **Step 1: Add the constant**

In `scripts/constants.mjs`, after the `THUMBNAILS_SETTING` line, add:

```js
/** Client setting: record views are editable in place with auto-save. */
export const INLINE_EDIT_SETTING = "inlineEditing";
```

- [ ] **Step 2: Register the setting**

In `scripts/hooks/hub-ui.mjs`, change the import line to:

```js
import { MODULE_ID, THUMBNAILS_SETTING, INLINE_EDIT_SETTING } from "../constants.mjs";
```

and add to `registerHubSettings()` after the thumbnails registration:

```js
game.settings.register(MODULE_ID, INLINE_EDIT_SETTING, {
  name: "CAMPAIGNRECORD.Settings.InlineEditing.Name",
  hint: "CAMPAIGNRECORD.Settings.InlineEditing.Hint",
  scope: "client",
  config: true,
  type: Boolean,
  default: true,
  onChange: () => {
    // Open journal sheets swap record views between read-only and editable.
    const { JournalEntrySheet } = foundry.applications.sheets.journal;
    for (const app of foundry.applications.instances.values()) {
      if (app instanceof JournalEntrySheet && app.rendered) app.render();
    }
  }
});
```

- [ ] **Step 3: Hub action + context**

In `scripts/apps/hub/campaign-hub.mjs`:

1. Change the constants import to include the new setting:

```js
import { MODULE_ID, THUMBNAILS_SETTING, INLINE_EDIT_SETTING, RECORD_TYPES, typeId } from "../../constants.mjs";
```

2. Add to `DEFAULT_OPTIONS.actions` after `toggleThumbnails`:

```js
      toggleInlineEdit: CampaignHub.#onToggleInlineEdit
```

3. Add the handler next to `#onToggleThumbnails`:

```js
  static async #onToggleInlineEdit() {
    const current = game.settings.get(MODULE_ID, INLINE_EDIT_SETTING);
    await game.settings.set(MODULE_ID, INLINE_EDIT_SETTING, !current);
    this.render();
  }
```

4. In `_prepareContext`, after the `context.thumbnails = …` line, add:

```js
    context.inlineEditing = game.settings.get(MODULE_ID, INLINE_EDIT_SETTING);
```

- [ ] **Step 4: Header button**

Replace `templates/hub/header.hbs` with:

```hbs
<div class="hub-header">
  <select name="group-select" aria-label="{{localize "CAMPAIGNRECORD.Hub.GroupPicker"}}">
    <option value="all" {{#if allSelected}}selected{{/if}}>{{localize "CAMPAIGNRECORD.Hub.AllGroups"}}</option>
    {{#each groups}}
    <option value="{{this.id}}" {{#if this.selected}}selected{{/if}}>{{this.name}}</option>
    {{/each}}
  </select>
  <button type="button" class="hub-inline-edit-toggle" data-action="toggleInlineEdit"
          data-tooltip="CAMPAIGNRECORD.Hub.ToggleInlineEdit"
          aria-pressed="{{#if inlineEditing}}true{{else}}false{{/if}}">
    <i class="fa-solid {{#if inlineEditing}}fa-pen{{else}}fa-pen-slash{{/if}}"></i>
  </button>
  <nav class="tabs" data-group="primary">
    {{#each tabs}}
    <a class="{{this.cssClass}}" data-action="tab" data-group="primary" data-tab="{{this.id}}">
      <i class="{{this.icon}}"></i> {{localize this.label}}
    </a>
    {{/each}}
  </nav>
</div>
```

- [ ] **Step 5: i18n keys**

In `lang/en.json`, inside the `"Hub"` object add (after `"ToggleThumbnails"`):

```json
"ToggleInlineEdit": "Toggle inline editing"
```

and add a new `"Settings"` object inside `"CAMPAIGNRECORD"`, as a sibling placed directly after the `"Hub"` object:

```json
"Settings": {
  "InlineEditing": {
    "Name": "Inline editing",
    "Hint": "Edit campaign records directly while viewing them; changes save automatically. Turn off for read-only views."
  }
}
```

Also add now (used by Task 4) inside the existing `"Warning"` object:

```json
"InlineSaveFailed": "Saving your change failed — see the console for details."
```

- [ ] **Step 6: Run the unit suite (i18n coverage guards the new keys)**

Run: `npm test`
Expected: PASS, including `tests/i18n-coverage.test.js`.

- [ ] **Step 7: Commit**

```bash
git add scripts/constants.mjs scripts/hooks/hub-ui.mjs scripts/apps/hub/campaign-hub.mjs templates/hub/header.hbs lang/en.json
git commit -m "feat: inlineEditing client setting with hub header toggle"
```

---

### Task 3: `CampaignGroupSheet` — focus-guarded journal sheet for groups

**Files:**
- Create: `scripts/sheets/group-sheet.mjs`
- Modify: `scripts/sheets/registration.mjs`
- Modify: `scripts/data/groups.mjs` (`createGroup`)
- Modify: `scripts/constants.mjs` (`SCHEMA_VERSION` → 2)
- Modify: `scripts/data/migration-runner.mjs` (v2 migration)
- Modify: `lang/en.json` (sheet label)

**Interfaces:**
- Consumes: `hasInlineFocus(root, active?)` from `scripts/logic/inline-edit.mjs` (Task 1).
- Produces: `CampaignGroupSheet` registered as `"campaign-record.CampaignGroupSheet"`; every group journal carries `flags.core.sheetClass = "campaign-record.CampaignGroupSheet"` (new groups at creation, existing groups via schema migration v2).

**Why:** on every `updateJournalEntryPage`, the journal sheet re-renders its page part and re-appends the page sheet element, which disconnects and destroys any active prose editor. Deferring the render while the user is focused in an inline-editable section prevents the cursor/editor from being destroyed by our own auto-saves or by remote users' updates. The deferred render is flushed when focus leaves.

- [ ] **Step 1: Create the sheet**

Create `scripts/sheets/group-sheet.mjs`:

```js
import { hasInlineFocus } from "../logic/inline-edit.mjs";

const { JournalEntrySheet } = foundry.applications.sheets.journal;

/**
 * Journal sheet for campaign groups. Defers re-renders while the user is
 * typing in an inline-editable record view so auto-saves (local or remote)
 * don't destroy the active control; flushes the deferred render on blur.
 */
export class CampaignGroupSheet extends JournalEntrySheet {
  #deferredRender = null;

  async render(options = {}, _options = {}) {
    if (typeof options === "boolean") options = { force: options };
    if (this.rendered && hasInlineFocus(this.element)) {
      this.#deferredRender = foundry.utils.mergeObject(this.#deferredRender ?? {}, options, {
        inplace: false
      });
      return this;
    }
    return super.render(options, _options);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    if (this.element.dataset.crFlushBound) return;
    this.element.dataset.crFlushBound = "1";
    this.element.addEventListener("focusout", () => {
      // change handlers and the resulting update run after focusout — flush on
      // the next tick so a render deferred by this very blur isn't stranded.
      setTimeout(() => this.#flushDeferredRender(), 0);
    });
  }

  #flushDeferredRender() {
    if (!this.#deferredRender || hasInlineFocus(this.element)) return;
    const options = this.#deferredRender;
    this.#deferredRender = null;
    this.render(options);
  }
}
```

- [ ] **Step 2: Register the sheet**

In `scripts/sheets/registration.mjs`, add the import:

```js
import { CampaignGroupSheet } from "./group-sheet.mjs";
```

and at the top of `registerSheets()`:

```js
  DocumentSheetConfig.registerSheet(JournalEntry, MODULE_ID, CampaignGroupSheet, {
    label: "CAMPAIGNRECORD.Sheets.Group"
  });
```

(No `makeDefault` — ordinary journals keep the core sheet; groups opt in via flag.)

- [ ] **Step 3: New groups get the sheet flag**

In `scripts/data/groups.mjs`, in `createGroup`, change the `flags` object of the `JournalEntry.create` call to:

```js
    flags: {
      [MODULE_ID]: { [GROUP_FLAG]: { timepoints: [] } },
      core: { sheetClass: `${MODULE_ID}.CampaignGroupSheet` }
    }
```

- [ ] **Step 4: Migrate existing groups**

In `scripts/constants.mjs`, change:

```js
export const SCHEMA_VERSION = 2;
```

In `scripts/data/migration-runner.mjs`, append to the `MIGRATIONS` array after the version-1 entry:

```js
  {
    version: 2,
    // Groups predating inline editing point at the focus-guarded group sheet.
    async run() {
      for (const group of getGroups()) {
        await group.update({ "flags.core.sheetClass": `${MODULE_ID}.CampaignGroupSheet` });
      }
    }
  }
```

- [ ] **Step 5: i18n**

In `lang/en.json`, add to the `"Sheets"` object:

```json
"Group": "Campaign Record Group Sheet"
```

- [ ] **Step 6: Run the unit suite**

Run: `npm test`
Expected: PASS (migrations tests exercise `pendingMigrations` against the registry shape; i18n coverage sees the new label).

- [ ] **Step 7: Commit**

```bash
git add scripts/sheets/group-sheet.mjs scripts/sheets/registration.mjs scripts/data/groups.mjs scripts/constants.mjs scripts/data/migration-runner.mjs lang/en.json
git commit -m "feat: focus-guarded CampaignGroupSheet pinned to groups (schema v2)"
```

---

### Task 4: `BaseRecordSheet` — inlineEdit flag, render guard, prose auto-save; CSS

**Files:**
- Modify: `scripts/sheets/base-record-sheet.mjs`
- Modify: `styles/campaign-record.css`

**Interfaces:**
- Consumes: `computeInlineEdit`, `createDebouncedSaver`, `hasInlineFocus` (Task 1); `INLINE_EDIT_SETTING` (Task 2).
- Produces: `context.inlineEdit` (boolean) available to every record template; prose auto-save binding for any `prose-mirror[data-inline-prose]` element rendered by view templates; a view-mode render guard mirroring `CampaignGroupSheet`'s.

- [ ] **Step 1: Update the sheet**

Replace the imports and class body of `scripts/sheets/base-record-sheet.mjs` with the following full file:

```js
import { setRecordHidden } from "../data/groups.mjs";
import { MODULE_ID, INLINE_EDIT_SETTING } from "../constants.mjs";
import { computeInlineEdit, createDebouncedSaver, hasInlineFocus } from "../logic/inline-edit.mjs";

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

  #deferredRender = null;

  #proseSavers = [];

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    context.page = this.document;
    context.system = system;
    context.systemFields = system.schema.fields;
    context.isGM = game.user.isGM;
    context.inlineEdit = computeInlineEdit({
      enabled: game.settings.get(MODULE_ID, INLINE_EDIT_SETTING),
      canUpdate: this.document.canUserModify(game.user, "update"),
      isView: this.isView
    });
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

  /**
   * While the user is focused in an inline-editable section, defer re-renders
   * (triggered by our own auto-saves or by remote updates) so the active
   * control isn't destroyed under the cursor. Flushed on focusout.
   */
  async render(options = {}, _options = {}) {
    if (typeof options === "boolean") options = { force: options };
    if (this.isView && this.rendered && hasInlineFocus(this.element)) {
      this.#deferredRender = foundry.utils.mergeObject(this.#deferredRender ?? {}, options, {
        inplace: false
      });
      return this;
    }
    return super.render(options, _options);
  }

  #flushDeferredRender() {
    if (!this.#deferredRender || hasInlineFocus(this.element)) return;
    const options = this.#deferredRender;
    this.#deferredRender = null;
    this.render(options);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".campaign-record-drop",
      callbacks: { drop: this.#onDrop.bind(this) }
    }).bind(this.element);
    this.#bindInlineProse(context);
    if (this.isView && !this.element.dataset.crFlushBound) {
      this.element.dataset.crFlushBound = "1";
      this.element.addEventListener("focusout", () => {
        setTimeout(() => this.#flushDeferredRender(), 0);
      });
    }
  }

  /**
   * Debounced as-you-type persistence for always-open inline prose editors.
   * Mid-typing saves suppress re-renders everywhere ({render: false}) — other
   * active editors stay in sync through collaborative editing; the final
   * focusout save renders normally so passive viewers catch up.
   */
  #bindInlineProse(context) {
    for (const saver of this.#proseSavers) saver.cancel();
    this.#proseSavers = [];
    if (!context.inlineEdit) return;
    for (const el of this.element.querySelectorAll("prose-mirror[data-inline-prose]")) {
      const fieldName = el.name;
      const saver = createDebouncedSaver({
        save: (html, { quiet }) => {
          this.document.update({ [fieldName]: html }, { render: !quiet }).catch((error) => {
            console.warn("campaign-record | inline prose save rejected", error);
            ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Warning.InlineSaveFailed"));
          });
        }
      });
      saver.prime(foundry.utils.getProperty(this.document, fieldName) ?? "");
      this.#proseSavers.push(saver);
      el.addEventListener("input", () => saver.schedule(() => el.value));
      el.addEventListener("focusout", () => saver.flush(() => el.value));
    }
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
        const rowEl = event.currentTarget.closest("[data-row-id]");
        if (!rowEl) return;
        const id = rowEl.dataset.rowId;
        const key = event.currentTarget.dataset.rowField;
        let value;
        if (event.currentTarget.type === "number") {
          // A cleared or non-numeric input coerces to 0 via Number(""), which
          // can silently persist an unintended value or, where the schema
          // rejects it (e.g. min: 1), throw from document.update. Skip the
          // write and re-render so the input snaps back to the persisted value.
          if (event.currentTarget.value === "") return this.render();
          const num = Number(event.currentTarget.value);
          if (!Number.isFinite(num)) return this.render();
          value = num;
        } else {
          value = event.currentTarget.value;
        }
        this.updateRows(field, (rows) => {
          const row = rows.find((r) => r.id === id);
          if (row) row[key] = value;
        }).catch((error) => {
          console.warn("campaign-record | row update rejected; resyncing sheet", error);
          this.render();
        });
      });
    }
  }
}
```

Notes for the implementer:
- The existing `_onRender` body (DragDrop) is preserved; only the prose binding and flush listener are added.
- `bindRowInputs`, `updateRows`, `#onToggleHidden`, `_onDropDocument` are unchanged from the current file.
- Plain named fields need **no** JS here: the page sheet root is a `<form>` with `submitOnChange: true`, active in view mode (verified against v13 core: `DocumentSheetV2.isEditable` is permission-based, and `_onChangeForm` is bound regardless of mode).

- [ ] **Step 2: CSS for inline fields**

Append to `styles/campaign-record.css`:

```css
/* ---------------------------------------- */
/* Inline-editable record views             */
/* ---------------------------------------- */

.campaign-record-content.inline-edit .record-facts dd input,
.campaign-record-content.inline-edit .record-facts dd select {
  width: 100%;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  transition: border-color 0.15s ease-in-out;
}

.campaign-record-content.inline-edit .record-facts dd input:hover,
.campaign-record-content.inline-edit .record-facts dd select:hover {
  border-color: var(--color-border-light-tertiary, #7a7971);
}

.campaign-record-content.inline-edit .record-facts dd input:focus,
.campaign-record-content.inline-edit .record-facts dd select:focus {
  border-color: var(--color-border-highlight, #ff6400);
  background: var(--color-bg-option, rgba(255, 255, 255, 0.5));
}

.campaign-record-content.inline-edit prose-mirror {
  display: block;
  min-height: 6rem;
}

.campaign-record-content.inline-edit prose-mirror .editor-content {
  min-height: 5rem;
}

.campaign-record-content.inline-edit .form-group.stacked > label,
.campaign-record-content.inline-edit section > h3 {
  margin-top: 0.5rem;
}
```

- [ ] **Step 3: Run the unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/sheets/base-record-sheet.mjs styles/campaign-record.css
git commit -m "feat: inlineEdit context flag, render guard, and prose auto-save in BaseRecordSheet"
```

---

### Task 5: Shared partials — editable common-view, prose value fix in edit templates

**Files:**
- Modify: `templates/partials/common-view.hbs`
- Modify: `templates/partials/common-edit.hbs`
- Modify: `templates/quest/edit.hbs` (prose `value` fix only — the objectives partial comes in Task 6)
- Modify: `templates/loot/edit.hbs` (prose `value` fix only)

**Interfaces:**
- Consumes: `context.inlineEdit`, `context.systemFields`, `context.system`, `context.page`, `context.isGM`, `context.enriched` (all provided by `BaseRecordSheet`).
- Produces: the `campaign-record.common-view` partial renders editable common fields (image, tags, hidden, description, GM notes) when `inlineEdit` is true; every hand-written `<prose-mirror>` in edit templates now carries a `value` attribute.

**Latent bug being fixed here:** the module's edit templates create `<prose-mirror toggled>` with enriched HTML as innerHTML but **no `value` attribute**. The element initializes its internal value from the `value` attribute only, so an untouched editor reports `""` to form serialization — any other field change in edit mode submits the empty string and can wipe stored rich text. Core's own factory always sets `value`; do the same everywhere.

- [ ] **Step 1: Replace `templates/partials/common-view.hbs`**

```hbs
{{#if inlineEdit}}
{{#if system.image}}<img class="record-image" src="{{system.image}}" alt="{{page.name}}">{{/if}}
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
<section class="record-description form-group stacked">
  <label>{{localize "CAMPAIGNRECORD.Common.FIELDS.description.label"}}</label>
  <prose-mirror name="system.description" value="{{system.description}}" collaborate data-inline-prose data-document-uuid="{{page.uuid}}"></prose-mirror>
</section>
{{#if isGM}}
<section class="gm-only form-group stacked">
  <label>{{localize "CAMPAIGNRECORD.Common.FIELDS.gmNotes.label"}}</label>
  <prose-mirror name="system.gmNotes" value="{{system.gmNotes}}" collaborate data-inline-prose data-document-uuid="{{page.uuid}}"></prose-mirror>
</section>
{{/if}}
{{else}}
{{#if system.image}}<img class="record-image" src="{{system.image}}" alt="{{page.name}}">{{/if}}
<section class="record-description">{{{enriched.description}}}</section>
{{#if isGM}}{{#if enriched.gmNotes}}
<section class="gm-only">
  <h3>{{localize "CAMPAIGNRECORD.Common.FIELDS.gmNotes.label"}}</h3>
  {{{enriched.gmNotes}}}
</section>
{{/if}}{{/if}}
{{/if}}
```

- [ ] **Step 2: Fix prose `value` in `templates/partials/common-edit.hbs`**

Change the two prose-mirror lines to:

```hbs
  <prose-mirror name="system.description" value="{{system.description}}" toggled collaborate data-document-uuid="{{page.uuid}}">{{{enriched.description}}}</prose-mirror>
```

```hbs
  <prose-mirror name="system.gmNotes" value="{{system.gmNotes}}" toggled collaborate data-document-uuid="{{page.uuid}}">{{{enriched.gmNotes}}}</prose-mirror>
```

- [ ] **Step 3: Same fix in `templates/quest/edit.hbs`**

```hbs
  <prose-mirror name="system.rewards" value="{{system.rewards}}" toggled collaborate data-document-uuid="{{page.uuid}}">{{{enriched.rewards}}}</prose-mirror>
```

- [ ] **Step 4: Same fix in `templates/loot/edit.hbs`**

```hbs
  <prose-mirror name="system.distribution" value="{{system.distribution}}" toggled collaborate data-document-uuid="{{page.uuid}}">{{{enriched.distribution}}}</prose-mirror>
```

- [ ] **Step 5: Run the unit suite**

Run: `npm test`
Expected: PASS (i18n coverage re-scans templates).

- [ ] **Step 6: Commit**

```bash
git add templates/partials/common-view.hbs templates/partials/common-edit.hbs templates/quest/edit.hbs templates/loot/edit.hbs
git commit -m "feat: editable common-view partial; fix missing prose-mirror value attributes"
```

---

### Task 6: Quest — editable view, objectives partial, e2e (red → green)

**Files:**
- Create: `templates/partials/quest-objectives.hbs`
- Modify: `templates/quest/view.hbs`, `templates/quest/edit.hbs`
- Modify: `scripts/sheets/quest-sheet.mjs` (statusChoices context)
- Modify: `scripts/sheets/registration.mjs` (register partial)
- Create: `tests/e2e/18-inline-edit.spec.mjs`

**Interfaces:**
- Consumes: `campaign-record.common-view` (Task 5), `context.inlineEdit`, `context.objectives`.
- Produces: partial `campaign-record.quest-objectives`; `context.statusChoices` (the `QUEST_STATUSES` map) on quest sheets.

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/18-inline-edit.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage, settle } from "./helpers/foundry.mjs";

test.describe("inline-editable record views", () => {
  let gmPage, ids;

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    await gmPage.evaluate(() => game.settings.set("campaign-record", "inlineEditing", true));
    ids = await createGroupWithPage(gmPage, "E2E Inline Group", "E2E Inline Quest", "campaign-record.quest");
  });

  test.afterAll(async () => {
    await gmPage.evaluate(() => game.settings.set("campaign-record", "inlineEditing", true));
    await deleteGroupsByPrefix(gmPage, "E2E Inline");
    await gmPage.close();
  });

  const questSystem = (p) =>
    p.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.toObject(),
      { groupId: ids.groupId, pageId: ids.pageId }
    );

  const openView = async (p) => {
    await p.evaluate(
      async ({ groupId, pageId }) => {
        const sheet = game.journal.get(groupId).sheet;
        await sheet.render({ force: true });
        sheet.goToPage(pageId);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    await p.locator(".campaign-record-content.inline-edit").first().waitFor({ timeout: 15_000 });
  };

  test("view mode is inline-editable by default and plain fields auto-save", async () => {
    await openView(gmPage);
    const view = gmPage.locator(".campaign-record-content.inline-edit").first();
    const source = view.locator('input[name="system.source"]');
    await source.fill("Innkeeper rumor");
    await source.dispatchEvent("change");
    await expect.poll(async () => (await questSystem(gmPage)).source).toBe("Innkeeper rumor");

    const status = view.locator('select[name="system.status"]');
    await status.selectOption("active");
    await expect.poll(async () => (await questSystem(gmPage)).status).toBe("active");
  });

  test("prose fields save as-you-type after the debounce and keep focus", async () => {
    await openView(gmPage);
    const editor = gmPage
      .locator('.campaign-record-content.inline-edit prose-mirror[name="system.description"] .editor-content')
      .first();
    await editor.click();
    await gmPage.keyboard.type("The road to Phandalin is dangerous.");
    // debounce is 2s of idle; wait past it, then verify the document updated
    await expect
      .poll(async () => (await questSystem(gmPage)).description, { timeout: 10_000 })
      .toContain("The road to Phandalin is dangerous.");
    // the quiet save must not have destroyed the editor or stolen focus
    const focusInEditor = await gmPage.evaluate(() =>
      !!document.activeElement?.closest('prose-mirror[name="system.description"]')
    );
    expect(focusInEditor).toBe(true);
  });

  test("objective rows can be added and edited from the view", async () => {
    await openView(gmPage);
    const view = gmPage.locator(".campaign-record-content.inline-edit").first();
    await view.locator('[data-action="addObjective"]').click();
    await expect.poll(async () => (await questSystem(gmPage)).objectives.length).toBe(1);
    const text = view.locator('input[data-row-field="text"]').first();
    await text.fill("Reach the ruined tower");
    await text.dispatchEvent("change");
    await expect
      .poll(async () => (await questSystem(gmPage)).objectives[0].text)
      .toBe("Reach the ruined tower");
  });

  test("hub toggle flips the setting and views become read-only", async () => {
    // open the hub from the journal sidebar footer
    await gmPage.evaluate(() => ui.sidebar.changeTab("journal", "primary"));
    await gmPage.locator(".campaign-record-open-hub").click();
    const hub = gmPage.locator("#campaign-hub");
    await hub.locator('[data-action="toggleInlineEdit"]').click();
    await expect
      .poll(() => gmPage.evaluate(() => game.settings.get("campaign-record", "inlineEditing")))
      .toBe(false);
    await openViewReadOnly();
    // restore for later tests
    await gmPage.evaluate(() => game.settings.set("campaign-record", "inlineEditing", true));

    async function openViewReadOnly() {
      await gmPage.evaluate(
        async ({ groupId, pageId }) => {
          const sheet = game.journal.get(groupId).sheet;
          await sheet.render({ force: true });
          sheet.goToPage(pageId);
        },
        { groupId: ids.groupId, pageId: ids.pageId }
      );
      await gmPage.locator(".campaign-record-content.record-view").first().waitFor({ timeout: 15_000 });
      await settle(gmPage);
      expect(await gmPage.locator(".campaign-record-content.inline-edit").count()).toBe(0);
      expect(
        await gmPage.locator('.campaign-record-content.record-view input[name="system.source"]').count()
      ).toBe(0);
    }
  });

  test("users without update permission get the read-only view despite the toggle", async ({
    browser
  }) => {
    const observerIds = await gmPage.evaluate(async () => {
      const entry = await JournalEntry.create({
        name: "E2E Inline Observer Group",
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
        flags: {
          "campaign-record": { group: { timepoints: [] } },
          core: { sheetClass: "campaign-record.CampaignGroupSheet" }
        }
      });
      const [page] = await entry.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Inline Observer Quest", type: "campaign-record.quest" }
      ]);
      return { groupId: entry.id, pageId: page.id };
    });
    const ctx = await browser.newContext();
    const playerPage = await ctx.newPage();
    await login(playerPage, "User 1");
    await playerPage.evaluate(() => game.settings.set("campaign-record", "inlineEditing", true));
    await playerPage.evaluate(
      async ({ groupId, pageId }) => {
        const sheet = game.journal.get(groupId).sheet;
        await sheet.render({ force: true });
        sheet.goToPage(pageId);
      },
      observerIds
    );
    await playerPage.locator(".campaign-record-content.record-view").first().waitFor({ timeout: 15_000 });
    await settle(playerPage);
    expect(await playerPage.locator(".campaign-record-content.inline-edit").count()).toBe(0);
    await ctx.close();
  });

  test("edit mode: untouched description survives a plain-field change (prose value fix)", async () => {
    await gmPage.evaluate(
      async ({ groupId, pageId }) => {
        const page = game.journal.get(groupId).pages.get(pageId);
        await page.update({ "system.description": "<p>Keep me intact.</p>" });
        await page.sheet.render(true);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = gmPage.locator(".campaign-record.record-sheet").last();
    const source = sheet.locator('input[name="system.source"]');
    await source.waitFor({ timeout: 15_000 });
    await source.fill("Changed in edit mode");
    await source.dispatchEvent("change");
    await expect.poll(async () => (await questSystem(gmPage)).source).toBe("Changed in edit mode");
    expect((await questSystem(gmPage)).description).toContain("Keep me intact.");
    await gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.close(),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
  });
});
```

- [ ] **Step 2: Run the new spec to verify it fails**

First read `.claude/skills/foundry-e2e/SKILL.md` and follow it. Then:

Run: `npx playwright test tests/e2e/18-inline-edit.spec.mjs`
Expected: FAIL — `.campaign-record-content.inline-edit` never appears (templates don't render it yet). If the run fails with a session-lock holder message instead, stop and report per the contract.

- [ ] **Step 3: Create `templates/partials/quest-objectives.hbs`**

Extracted verbatim from the current `templates/quest/edit.hbs` fieldset:

```hbs
<fieldset class="quest-objectives">
  <legend>{{localize "CAMPAIGNRECORD.Quest.FIELDS.objectives.label"}}</legend>
  <ol data-rows="objectives">
    {{#each objectives}}
    <li data-row-id="{{this.id}}" class="{{#if this.gmOnly}}gm-only{{/if}}">
      <input type="checkbox" data-action="toggleObjective" {{#if this.done}}checked{{/if}}>
      <input type="text" data-row-field="text" value="{{this.text}}">
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
```

- [ ] **Step 4: Register the partial**

In `scripts/sheets/registration.mjs`, add to the `loadTemplates` map:

```js
    "campaign-record.quest-objectives": "modules/campaign-record/templates/partials/quest-objectives.hbs"
```

- [ ] **Step 5: Replace `templates/quest/edit.hbs`**

```hbs
<section class="campaign-record-content record-edit">
<div class="form-fields-grid">
  {{formGroup systemFields.source value=system.source localize=true}}
  {{formGroup systemFields.status value=system.status localize=true}}
</div>
{{> campaign-record.quest-objectives}}
<div class="form-group stacked">
  <label>{{localize "CAMPAIGNRECORD.Quest.FIELDS.rewards.label"}}</label>
  <prose-mirror name="system.rewards" value="{{system.rewards}}" toggled collaborate data-document-uuid="{{page.uuid}}">{{{enriched.rewards}}}</prose-mirror>
</div>
{{> campaign-record.common-edit}}
</section>
```

- [ ] **Step 6: Replace `templates/quest/view.hbs`**

```hbs
<section class="campaign-record-content record-view{{#if inlineEdit}} inline-edit{{/if}}">
{{#if inlineEdit}}
<dl class="record-facts">
  <dt>{{localize "CAMPAIGNRECORD.Quest.FIELDS.source.label"}}</dt>
  <dd><input type="text" name="system.source" value="{{system.source}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Quest.FIELDS.status.label"}}</dt>
  <dd><select name="system.status">{{selectOptions statusChoices selected=system.status localize=true}}</select></dd>
</dl>
{{> campaign-record.quest-objectives}}
<section class="quest-rewards form-group stacked">
  <h3>{{localize "CAMPAIGNRECORD.Quest.FIELDS.rewards.label"}}</h3>
  <prose-mirror name="system.rewards" value="{{system.rewards}}" collaborate data-inline-prose data-document-uuid="{{page.uuid}}"></prose-mirror>
</section>
{{else}}
<dl class="record-facts">
  {{#if system.source}}<dt>{{localize "CAMPAIGNRECORD.Quest.FIELDS.source.label"}}</dt><dd>{{system.source}}</dd>{{/if}}
  <dt>{{localize "CAMPAIGNRECORD.Quest.FIELDS.status.label"}}</dt><dd>{{system.status}}</dd>
</dl>
<section class="quest-objectives">
  <h3>{{localize "CAMPAIGNRECORD.Quest.FIELDS.objectives.label"}}</h3>
  <ol>
    {{#each objectives}}
    <li data-row-id="{{this.id}}" class="{{#if this.gmOnly}}gm-only{{/if}}">
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
{{/if}}
{{> campaign-record.common-view}}
</section>
```

- [ ] **Step 7: statusChoices context**

In `scripts/sheets/quest-sheet.mjs`, add the import:

```js
import { QUEST_STATUSES } from "../data/quest.mjs";
```

and in `_prepareContext`, before `return context;`:

```js
    context.statusChoices = QUEST_STATUSES;
```

- [ ] **Step 8: Run the new spec to verify it passes**

Run: `npx playwright test tests/e2e/18-inline-edit.spec.mjs`
Expected: PASS (all 6 tests).

- [ ] **Step 9: Run the existing quest spec for regressions**

Run: `npx playwright test tests/e2e/03-quest.spec.mjs`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add templates/partials/quest-objectives.hbs templates/quest scripts/sheets/quest-sheet.mjs scripts/sheets/registration.mjs tests/e2e/18-inline-edit.spec.mjs
git commit -m "feat: inline-editable quest view with objectives partial and e2e coverage"
```

---

### Task 7: NPC and PC — editable views

**Files:**
- Modify: `templates/npc/view.hbs`, `templates/pc/view.hbs`
- Modify: `scripts/sheets/npc-sheet.mjs` (statusChoices)

**Interfaces:**
- Consumes: `campaign-record.common-view`, `campaign-record.actor-info` partials; `NPC_STATUSES` from `scripts/data/npc.mjs`.
- Produces: `context.statusChoices` on NPC sheets.

- [ ] **Step 1: statusChoices for NPC**

In `scripts/sheets/npc-sheet.mjs`, add the import `import { NPC_STATUSES } from "../data/npc.mjs";` (merge with any existing import from that file) and in its `_prepareContext`, before `return context;`:

```js
    context.statusChoices = NPC_STATUSES;
```

If `npc-sheet.mjs` has no `_prepareContext` override yet, add one:

```js
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.statusChoices = NPC_STATUSES;
    return context;
  }
```

(Read the file first; it likely already prepares `enriched.actorLink` — extend, don't replace.)

- [ ] **Step 2: Replace `templates/npc/view.hbs`**

```hbs
<section class="campaign-record-content record-view{{#if inlineEdit}} inline-edit{{/if}}">
{{#if inlineEdit}}
<dl class="record-facts">
  <dt>{{localize "CAMPAIGNRECORD.Npc.FIELDS.role.label"}}</dt>
  <dd><input type="text" name="system.role" value="{{system.role}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Npc.FIELDS.location.label"}}</dt>
  <dd><input type="text" name="system.location" value="{{system.location}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Npc.FIELDS.race.label"}}</dt>
  <dd><input type="text" name="system.race" value="{{system.race}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Npc.FIELDS.gender.label"}}</dt>
  <dd><input type="text" name="system.gender" value="{{system.gender}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Npc.FIELDS.profession.label"}}</dt>
  <dd><input type="text" name="system.profession" value="{{system.profession}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Npc.FIELDS.voice.label"}}</dt>
  <dd><input type="text" name="system.voice" value="{{system.voice}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Npc.FIELDS.faction.label"}}</dt>
  <dd><input type="text" name="system.faction" value="{{system.faction}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Npc.FIELDS.status.label"}}</dt>
  <dd><select name="system.status">{{selectOptions statusChoices selected=system.status localize=true}}</select></dd>
</dl>
<div class="form-group campaign-record-drop">
  <label>{{localize "CAMPAIGNRECORD.Npc.FIELDS.actor.label"}}</label>
  {{#if enriched.actorLink}}{{{enriched.actorLink}}}{{else}}
    <span class="hint">{{localize "CAMPAIGNRECORD.DropActorHint"}}</span>
  {{/if}}
  <button type="button" data-action="linkActor">
    <i class="fa-solid fa-link"></i> {{localize "CAMPAIGNRECORD.LinkActor"}}
  </button>
</div>
{{> campaign-record.actor-info}}
{{else}}
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
{{> campaign-record.actor-info}}
{{/if}}
{{> campaign-record.common-view}}
</section>
```

- [ ] **Step 3: Replace `templates/pc/view.hbs`**

```hbs
<section class="campaign-record-content record-view{{#if inlineEdit}} inline-edit{{/if}}">
{{#if inlineEdit}}
<dl class="record-facts">
  <dt>{{localize "CAMPAIGNRECORD.Pc.FIELDS.playerName.label"}}</dt>
  <dd><input type="text" name="system.playerName" value="{{system.playerName}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Pc.FIELDS.classLevel.label"}}</dt>
  <dd><input type="text" name="system.classLevel" value="{{system.classLevel}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Pc.FIELDS.faction.label"}}</dt>
  <dd><input type="text" name="system.faction" value="{{system.faction}}"></dd>
</dl>
<div class="form-group campaign-record-drop">
  <label>{{localize "CAMPAIGNRECORD.Pc.FIELDS.actor.label"}}</label>
  {{#if enriched.actorLink}}{{{enriched.actorLink}}}{{else}}
    <span class="hint">{{localize "CAMPAIGNRECORD.DropActorHint"}}</span>
  {{/if}}
  <button type="button" data-action="linkActor">
    <i class="fa-solid fa-link"></i> {{localize "CAMPAIGNRECORD.LinkActor"}}
  </button>
</div>
{{> campaign-record.actor-info}}
{{else}}
<dl class="record-facts">
  {{#if system.playerName}}<dt>{{localize "CAMPAIGNRECORD.Pc.FIELDS.playerName.label"}}</dt><dd>{{system.playerName}}</dd>{{/if}}
  {{#if system.classLevel}}<dt>{{localize "CAMPAIGNRECORD.Pc.FIELDS.classLevel.label"}}</dt><dd>{{system.classLevel}}</dd>{{/if}}
  {{#if system.faction}}<dt>{{localize "CAMPAIGNRECORD.Pc.FIELDS.faction.label"}}</dt><dd>{{system.faction}}</dd>{{/if}}
  {{#if enriched.actorLink}}<dt>{{localize "CAMPAIGNRECORD.Pc.FIELDS.actor.label"}}</dt><dd>{{{enriched.actorLink}}}</dd>{{/if}}
</dl>
{{> campaign-record.actor-info}}
{{/if}}
{{> campaign-record.common-view}}
</section>
```

- [ ] **Step 4: Regression e2e**

Run: `npx playwright test tests/e2e/09-pc-item.spec.mjs`
Expected: PASS. (Also covers PC; NPC has no dedicated spec — 02-records exercises it in the final full run.)

- [ ] **Step 5: Commit**

```bash
git add templates/npc/view.hbs templates/pc/view.hbs scripts/sheets/npc-sheet.mjs
git commit -m "feat: inline-editable npc and pc views"
```

---

### Task 8: Place and Item — editable views

**Files:**
- Modify: `templates/place/view.hbs`, `templates/item/view.hbs`
- Modify: `scripts/sheets/place-sheet.mjs` (placeTypeChoices)

**Interfaces:**
- Consumes: `PLACE_TYPES` from `scripts/data/place.mjs`.
- Produces: `context.placeTypeChoices` on place sheets.

- [ ] **Step 1: placeTypeChoices**

In `scripts/sheets/place-sheet.mjs`, import `PLACE_TYPES` from `../data/place.mjs` and add to its `_prepareContext` (create the override if absent, extending `super._prepareContext` as in Task 7):

```js
    context.placeTypeChoices = PLACE_TYPES;
```

- [ ] **Step 2: Replace `templates/place/view.hbs`**

```hbs
<section class="campaign-record-content record-view{{#if inlineEdit}} inline-edit{{/if}}">
{{#if inlineEdit}}
<dl class="record-facts">
  <dt>{{localize "CAMPAIGNRECORD.Place.FIELDS.placeType.label"}}</dt>
  <dd><select name="system.placeType">{{selectOptions placeTypeChoices selected=system.placeType localize=true}}</select></dd>
  <dt>{{localize "CAMPAIGNRECORD.Place.FIELDS.location.label"}}</dt>
  <dd><input type="text" name="system.location" value="{{system.location}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Place.FIELDS.government.label"}}</dt>
  <dd><input type="text" name="system.government" value="{{system.government}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Place.FIELDS.size.label"}}</dt>
  <dd><input type="text" name="system.size" value="{{system.size}}"></dd>
</dl>
<div class="form-group campaign-record-drop">
  <label>{{localize "CAMPAIGNRECORD.Place.FIELDS.scene.label"}}</label>
  {{#if enriched.sceneLink}}{{{enriched.sceneLink}}}{{else}}
    <span class="hint">{{localize "CAMPAIGNRECORD.DropSceneHint"}}</span>
  {{/if}}
</div>
{{else}}
<dl class="record-facts">
  <dt>{{localize "CAMPAIGNRECORD.Place.FIELDS.placeType.label"}}</dt><dd>{{system.placeType}}</dd>
  {{#if system.location}}<dt>{{localize "CAMPAIGNRECORD.Place.FIELDS.location.label"}}</dt><dd>{{system.location}}</dd>{{/if}}
  {{#if system.government}}<dt>{{localize "CAMPAIGNRECORD.Place.FIELDS.government.label"}}</dt><dd>{{system.government}}</dd>{{/if}}
  {{#if system.size}}<dt>{{localize "CAMPAIGNRECORD.Place.FIELDS.size.label"}}</dt><dd>{{system.size}}</dd>{{/if}}
  {{#if enriched.sceneLink}}<dt>{{localize "CAMPAIGNRECORD.Place.FIELDS.scene.label"}}</dt><dd>{{{enriched.sceneLink}}}</dd>{{/if}}
</dl>
{{/if}}
{{> campaign-record.common-view}}
</section>
```

- [ ] **Step 3: Replace `templates/item/view.hbs`**

```hbs
<section class="campaign-record-content record-view{{#if inlineEdit}} inline-edit{{/if}}">
{{#if inlineEdit}}
<dl class="record-facts">
  <dt>{{localize "CAMPAIGNRECORD.Item.FIELDS.itemType.label"}}</dt>
  <dd><input type="text" name="system.itemType" value="{{system.itemType}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Item.FIELDS.rarity.label"}}</dt>
  <dd><input type="text" name="system.rarity" value="{{system.rarity}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Item.FIELDS.attunement.label"}}</dt>
  <dd><input type="text" name="system.attunement" value="{{system.attunement}}"></dd>
</dl>
<div class="form-group campaign-record-drop">
  <label>{{localize "CAMPAIGNRECORD.Item.FIELDS.item.label"}}</label>
  {{#if enriched.itemLink}}{{{enriched.itemLink}}}{{else}}
    <span class="hint">{{localize "CAMPAIGNRECORD.DropItemHint"}}</span>
  {{/if}}
</div>
{{else}}
<dl class="record-facts">
  {{#if system.itemType}}<dt>{{localize "CAMPAIGNRECORD.Item.FIELDS.itemType.label"}}</dt><dd>{{system.itemType}}</dd>{{/if}}
  {{#if system.rarity}}<dt>{{localize "CAMPAIGNRECORD.Item.FIELDS.rarity.label"}}</dt><dd>{{system.rarity}}</dd>{{/if}}
  {{#if system.attunement}}<dt>{{localize "CAMPAIGNRECORD.Item.FIELDS.attunement.label"}}</dt><dd>{{system.attunement}}</dd>{{/if}}
  {{#if enriched.itemLink}}<dt>{{localize "CAMPAIGNRECORD.Item.FIELDS.item.label"}}</dt><dd>{{{enriched.itemLink}}}</dd>{{/if}}
</dl>
{{/if}}
{{> campaign-record.common-view}}
</section>
```

- [ ] **Step 4: Regression e2e**

Run: `npx playwright test tests/e2e/09-pc-item.spec.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add templates/place/view.hbs templates/item/view.hbs scripts/sheets/place-sheet.mjs
git commit -m "feat: inline-editable place and item views"
```

---

### Task 9: Encounter and Checklist — editable views with row partials

**Files:**
- Create: `templates/partials/encounter-combatants.hbs`, `templates/partials/checklist-items.hbs`
- Modify: `templates/encounter/view.hbs`, `templates/encounter/edit.hbs`, `templates/checklist/view.hbs`, `templates/checklist/edit.hbs`
- Modify: `scripts/sheets/registration.mjs`

**Interfaces:**
- Consumes: `context.items` + `context.userOptions` (checklist sheet already provides both unconditionally), `system.combatants`.
- Produces: partials `campaign-record.encounter-combatants`, `campaign-record.checklist-items`.

- [ ] **Step 1: Create `templates/partials/encounter-combatants.hbs`** (extracted verbatim from `templates/encounter/edit.hbs`):

```hbs
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
  <button type="button" data-action="linkActor">
    <i class="fa-solid fa-link"></i> {{localize "CAMPAIGNRECORD.LinkActor"}}
  </button>
  <p class="hint">{{localize "CAMPAIGNRECORD.DropActorHint"}}</p>
</fieldset>
```

- [ ] **Step 2: Create `templates/partials/checklist-items.hbs`** (extracted verbatim from `templates/checklist/edit.hbs`):

```hbs
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
```

- [ ] **Step 3: Register both partials**

In `scripts/sheets/registration.mjs` `loadTemplates` map, add:

```js
    "campaign-record.encounter-combatants": "modules/campaign-record/templates/partials/encounter-combatants.hbs",
    "campaign-record.checklist-items": "modules/campaign-record/templates/partials/checklist-items.hbs"
```

- [ ] **Step 4: Replace `templates/encounter/edit.hbs`**

```hbs
<section class="campaign-record-content record-edit">
<div class="form-fields-grid">
  {{formGroup systemFields.location value=system.location localize=true}}
  {{formGroup systemFields.difficulty value=system.difficulty localize=true}}
  {{formGroup systemFields.outcome value=system.outcome localize=true}}
</div>
{{> campaign-record.encounter-combatants}}
<div class="form-group campaign-record-drop">
  <label>{{localize "CAMPAIGNRECORD.Encounter.FIELDS.scene.label"}}</label>
  {{#if enriched.sceneLink}}{{{enriched.sceneLink}}}{{else}}
    <span class="hint">{{localize "CAMPAIGNRECORD.DropSceneHint"}}</span>
  {{/if}}
</div>
{{> campaign-record.common-edit}}
</section>
```

- [ ] **Step 5: Replace `templates/encounter/view.hbs`**

```hbs
<section class="campaign-record-content record-view{{#if inlineEdit}} inline-edit{{/if}}">
{{#if inlineEdit}}
<dl class="record-facts">
  <dt>{{localize "CAMPAIGNRECORD.Encounter.FIELDS.location.label"}}</dt>
  <dd><input type="text" name="system.location" value="{{system.location}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Encounter.FIELDS.difficulty.label"}}</dt>
  <dd><input type="text" name="system.difficulty" value="{{system.difficulty}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Encounter.FIELDS.outcome.label"}}</dt>
  <dd><input type="text" name="system.outcome" value="{{system.outcome}}"></dd>
</dl>
{{> campaign-record.encounter-combatants}}
<div class="form-group campaign-record-drop">
  <label>{{localize "CAMPAIGNRECORD.Encounter.FIELDS.scene.label"}}</label>
  {{#if enriched.sceneLink}}{{{enriched.sceneLink}}}{{else}}
    <span class="hint">{{localize "CAMPAIGNRECORD.DropSceneHint"}}</span>
  {{/if}}
</div>
{{else}}
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
{{/if}}
{{> campaign-record.common-view}}
</section>
```

- [ ] **Step 6: Replace `templates/checklist/edit.hbs`**

```hbs
<section class="campaign-record-content record-edit">
{{> campaign-record.checklist-items}}
{{> campaign-record.common-edit}}
</section>
```

- [ ] **Step 7: Replace `templates/checklist/view.hbs`**

```hbs
<section class="campaign-record-content record-view{{#if inlineEdit}} inline-edit{{/if}}">
{{#if inlineEdit}}
{{> campaign-record.checklist-items}}
{{else}}
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
{{/if}}
{{> campaign-record.common-view}}
</section>
```

- [ ] **Step 8: Regression e2e**

Run: `npx playwright test tests/e2e/10-encounter.spec.mjs tests/e2e/11-checklist.spec.mjs`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add templates/partials/encounter-combatants.hbs templates/partials/checklist-items.hbs templates/encounter templates/checklist scripts/sheets/registration.mjs
git commit -m "feat: inline-editable encounter and checklist views via shared row partials"
```

---

### Task 10: Shop and Loot — editable views with row partials

**Files:**
- Create: `templates/partials/shop-inventory.hbs`, `templates/partials/loot-items.hbs`
- Modify: `templates/shop/view.hbs`, `templates/shop/edit.hbs`, `templates/loot/view.hbs`, `templates/loot/edit.hbs`
- Modify: `scripts/sheets/registration.mjs`

**Interfaces:**
- Consumes: `system.inventory`, `system.items`, `system.currency`, `enriched.sourceLink`, `enriched.distribution`.
- Produces: partials `campaign-record.shop-inventory`, `campaign-record.loot-items`.

- [ ] **Step 1: Create `templates/partials/shop-inventory.hbs`** (extracted verbatim from `templates/shop/edit.hbs`):

```hbs
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
```

- [ ] **Step 2: Create `templates/partials/loot-items.hbs`** (extracted verbatim from `templates/loot/edit.hbs`):

```hbs
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
```

- [ ] **Step 3: Register both partials**

In `scripts/sheets/registration.mjs` `loadTemplates` map, add:

```js
    "campaign-record.shop-inventory": "modules/campaign-record/templates/partials/shop-inventory.hbs",
    "campaign-record.loot-items": "modules/campaign-record/templates/partials/loot-items.hbs"
```

- [ ] **Step 4: Replace `templates/shop/edit.hbs`**

```hbs
<section class="campaign-record-content record-edit">
<div class="form-fields-grid">
  {{formGroup systemFields.shopType value=system.shopType localize=true}}
  {{formGroup systemFields.location value=system.location localize=true}}
  {{formGroup systemFields.owner value=system.owner localize=true}}
</div>
{{> campaign-record.shop-inventory}}
{{> campaign-record.common-edit}}
</section>
```

- [ ] **Step 5: Replace `templates/shop/view.hbs`**

```hbs
<section class="campaign-record-content record-view{{#if inlineEdit}} inline-edit{{/if}}">
{{#if inlineEdit}}
<dl class="record-facts">
  <dt>{{localize "CAMPAIGNRECORD.Shop.FIELDS.shopType.label"}}</dt>
  <dd><input type="text" name="system.shopType" value="{{system.shopType}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Shop.FIELDS.location.label"}}</dt>
  <dd><input type="text" name="system.location" value="{{system.location}}"></dd>
  <dt>{{localize "CAMPAIGNRECORD.Shop.FIELDS.owner.label"}}</dt>
  <dd><input type="text" name="system.owner" value="{{system.owner}}"></dd>
</dl>
{{> campaign-record.shop-inventory}}
{{else}}
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
{{/if}}
{{> campaign-record.common-view}}
</section>
```

- [ ] **Step 6: Replace `templates/loot/edit.hbs`**

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
{{> campaign-record.loot-items}}
<div class="form-group">
  <label>{{localize "CAMPAIGNRECORD.Loot.FIELDS.source.label"}}</label>
  {{#if enriched.sourceLink}}{{{enriched.sourceLink}}}{{else}}
    <span class="hint">{{localize "CAMPAIGNRECORD.Loot.DropEncounterHint"}}</span>
  {{/if}}
</div>
<div class="form-group stacked">
  <label>{{localize "CAMPAIGNRECORD.Loot.FIELDS.distribution.label"}}</label>
  <prose-mirror name="system.distribution" value="{{system.distribution}}" toggled collaborate data-document-uuid="{{page.uuid}}">{{{enriched.distribution}}}</prose-mirror>
</div>
{{> campaign-record.common-edit}}
</section>
```

- [ ] **Step 7: Replace `templates/loot/view.hbs`**

```hbs
<section class="campaign-record-content record-view{{#if inlineEdit}} inline-edit{{/if}}">
{{#if inlineEdit}}
<fieldset class="loot-currency">
  <legend>{{localize "CAMPAIGNRECORD.Loot.FIELDS.currency.label"}}</legend>
  <dl class="record-facts loot-currency">
    <dt>{{localize "CAMPAIGNRECORD.Loot.FIELDS.currency.pp.label"}}</dt>
    <dd><input type="number" name="system.currency.pp" value="{{system.currency.pp}}" min="0" step="1"></dd>
    <dt>{{localize "CAMPAIGNRECORD.Loot.FIELDS.currency.gp.label"}}</dt>
    <dd><input type="number" name="system.currency.gp" value="{{system.currency.gp}}" min="0" step="1"></dd>
    <dt>{{localize "CAMPAIGNRECORD.Loot.FIELDS.currency.ep.label"}}</dt>
    <dd><input type="number" name="system.currency.ep" value="{{system.currency.ep}}" min="0" step="1"></dd>
    <dt>{{localize "CAMPAIGNRECORD.Loot.FIELDS.currency.sp.label"}}</dt>
    <dd><input type="number" name="system.currency.sp" value="{{system.currency.sp}}" min="0" step="1"></dd>
    <dt>{{localize "CAMPAIGNRECORD.Loot.FIELDS.currency.cp.label"}}</dt>
    <dd><input type="number" name="system.currency.cp" value="{{system.currency.cp}}" min="0" step="1"></dd>
  </dl>
</fieldset>
{{> campaign-record.loot-items}}
<div class="form-group">
  <label>{{localize "CAMPAIGNRECORD.Loot.FIELDS.source.label"}}</label>
  {{#if enriched.sourceLink}}{{{enriched.sourceLink}}}{{else}}
    <span class="hint">{{localize "CAMPAIGNRECORD.Loot.DropEncounterHint"}}</span>
  {{/if}}
</div>
<section class="loot-distribution form-group stacked">
  <h3>{{localize "CAMPAIGNRECORD.Loot.FIELDS.distribution.label"}}</h3>
  <prose-mirror name="system.distribution" value="{{system.distribution}}" collaborate data-inline-prose data-document-uuid="{{page.uuid}}"></prose-mirror>
</section>
{{else}}
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
{{/if}}
{{> campaign-record.common-view}}
</section>
```

- [ ] **Step 8: Regression e2e**

Run: `npx playwright test tests/e2e/12-shop.spec.mjs tests/e2e/13-loot.spec.mjs`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add templates/partials/shop-inventory.hbs templates/partials/loot-items.hbs templates/shop templates/loot scripts/sheets/registration.mjs
git commit -m "feat: inline-editable shop and loot views via shared row partials"
```

---

### Task 11: Media — editable view with images partial

**Files:**
- Create: `templates/partials/media-images.hbs`
- Modify: `templates/media/view.hbs`, `templates/media/edit.hbs`
- Modify: `scripts/sheets/registration.mjs`

**Interfaces:**
- Consumes: `system.images`, `system.slideshowInterval`, `isGM`.
- Produces: partial `campaign-record.media-images`.

- [ ] **Step 1: Create `templates/partials/media-images.hbs`** (extracted verbatim from `templates/media/edit.hbs`, including the slideshow controls):

```hbs
<fieldset class="media-images">
  <legend>{{localize "CAMPAIGNRECORD.Media.FIELDS.images.label"}}</legend>
  <ol data-rows="images">
    {{#each system.images}}
    <li data-row-id="{{this.id}}" class="media-image-row">
      <img src="{{this.src}}" alt="{{this.caption}}">
      <input type="text" data-row-field="caption" value="{{this.caption}}"
             placeholder="{{localize "CAMPAIGNRECORD.Media.CaptionPlaceholder"}}">
      {{#if @root.isGM}}
      <button type="button" data-action="showImage"
              data-tooltip="CAMPAIGNRECORD.Presenter.ShowToPlayers"><i class="fa-solid fa-display"></i></button>
      {{/if}}
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
  {{#if isGM}}
  <button type="button" data-action="startSlideshow">
    <i class="fa-solid fa-play"></i> {{localize "CAMPAIGNRECORD.Presenter.StartSlideshow"}}
  </button>
  <button type="button" data-action="endPresentation">
    <i class="fa-solid fa-stop"></i> {{localize "CAMPAIGNRECORD.Presenter.End"}}
  </button>
  {{/if}}
</fieldset>
```

- [ ] **Step 2: Register the partial**

In `scripts/sheets/registration.mjs` `loadTemplates` map, add:

```js
    "campaign-record.media-images": "modules/campaign-record/templates/partials/media-images.hbs"
```

- [ ] **Step 3: Replace `templates/media/edit.hbs`**

```hbs
<section class="campaign-record-content record-edit">
{{> campaign-record.media-images}}
{{formGroup systemFields.slideshowInterval value=system.slideshowInterval localize=true}}
{{> campaign-record.common-edit}}
</section>
```

- [ ] **Step 4: Replace `templates/media/view.hbs`**

```hbs
<section class="campaign-record-content record-view{{#if inlineEdit}} inline-edit{{/if}}">
{{#if inlineEdit}}
{{> campaign-record.media-images}}
{{formGroup systemFields.slideshowInterval value=system.slideshowInterval localize=true}}
{{else}}
<div class="media-gallery">
  {{#each system.images}}
  <figure data-row-id="{{this.id}}">
    <img src="{{this.src}}" alt="{{this.caption}}">
    {{#if this.caption}}<figcaption>{{this.caption}}</figcaption>{{/if}}
    {{#if @root.isGM}}
    <button type="button" data-action="showImage">
      <i class="fa-solid fa-display"></i> {{localize "CAMPAIGNRECORD.Presenter.ShowToPlayers"}}
    </button>
    {{/if}}
  </figure>
  {{/each}}
</div>
{{/if}}
{{> campaign-record.common-view}}
</section>
```

- [ ] **Step 5: Regression e2e**

Run: `npx playwright test tests/e2e/14-media.spec.mjs tests/e2e/16-presenter.spec.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add templates/partials/media-images.hbs templates/media scripts/sheets/registration.mjs
git commit -m "feat: inline-editable media view via shared images partial"
```

---

### Task 12: Full verification sweep

**Files:**
- Possibly modify: existing e2e specs whose selectors assumed read-only view markup (fix fallout only; do not weaken assertions).

**Interfaces:** none new.

- [ ] **Step 1: Full unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Full e2e suite** (per the foundry-e2e contract — foreground, full suite once)

Run: `npm run test:e2e`
Expected: PASS. Known risk areas if anything fails:
- Specs asserting view-mode markup (`record-facts` `<dd>` text, checklist `<span>` text) now meet editable markup when the acting user owns the record — since groups default to OWNER ownership, player-view assertions may hit `inline-edit` views. Fix by either reading the input's value instead of text, or setting `game.settings.set("campaign-record", "inlineEditing", false)` for that user in the test's setup — choose whichever matches the test's intent (a test about *view-mode visibility* should disable inline editing; a test about *interaction* should assert against inputs).
- `04-collaboration-secrecy.spec.mjs` exercises player view-mode flows — most likely place for fallout.

- [ ] **Step 3: Re-run any spec you had to fix, then the full suite again if fixes were made**

Run: `npm run test:e2e`
Expected: PASS, no retries needed.

- [ ] **Step 4: Sanity-check the deliverable manually via the spec's acceptance list**

Confirm each spec requirement has a passing test or was manually exercised:
- toggle in hub header, client-scoped, default on → e2e 18 (default-on assertion is implicit: first test passes without enabling anything, but the beforeAll sets it explicitly — verify the setting registration default by reading `game.settings.settings.get("campaign-record.inlineEditing").default === true` in an evaluate, and add that one-line assertion to spec 18 if absent).
- all fields editable incl. empty ones → quest e2e covers text/select/rows/prose; other types verified by template review + regression suites.
- auto-save plain/rows/prose-debounced → e2e 18.
- permissions → e2e 18 observer test.
- read-only view unchanged when toggle off → e2e 18.
- edit mode untouched → per-type regression specs + prose value fix test.

- [ ] **Step 5: Commit any test fixes**

```bash
git add tests/e2e
git commit -m "test: adjust e2e selectors for inline-editable views"
```

---

## Deferred / explicitly out of scope

- Page name editing (journal sheet header owns it).
- Core `text` journal pages inside groups.
- Styling polish beyond the CSS in Task 4 (functional-first; visual refinement is a follow-up).
- Editor-session pooling for multi-page (`isMultiple`) journal view — live editors instantiate per rendered page; groups render one page at a time in the default single-page mode.
