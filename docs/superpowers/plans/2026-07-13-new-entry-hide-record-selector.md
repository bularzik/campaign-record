# Hide New Entry Record Selector When Hub Is Scoped — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the New Entry dialog, hide the campaign-record (`group`) selector when the hub is scoped to a concrete group, defaulting the new entry into that group.

**Architecture:** Follow the codebase convention of extracting the decision into a pure, unit-tested view-model function under `scripts/logic/` (mirroring `buildSortMenu`), then consume it from the Foundry-bound `#onNewRecord` handler in `scripts/apps/hub/hub-mixin.mjs`. The handler renders the group field only when the view model says to, and resolves the destination group from the select value or falls back to the hub's scope.

**Tech Stack:** Vanilla ES modules (`.mjs`), Foundry VTT DialogV2 API, Vitest (unit), jsdom.

## Global Constraints

- No new dependencies. Pure logic module must import nothing from Foundry (so it runs under Vitest without Foundry globals).
- Match existing style in `scripts/logic/`: named exports, JSDoc, no side effects.
- The standalone hub scoped to the `"all"` sentinel must keep its current behavior (selector shown).

---

### Task 1: Pure view-model helper `buildNewRecordGroupField`

**Files:**
- Create: `scripts/logic/new-record-form.mjs`
- Test: `tests/new-record-form.test.js`

**Interfaces:**
- Consumes: nothing (pure function over plain data).
- Produces: `buildNewRecordGroupField(groups, current)` where `groups` is `{id: string, name: string}[]` and `current` is `string` (the hub's `groupScopeId`). Returns `{ showGroupPicker: boolean, options: {value: string, label: string, selected: boolean}[] }`. `showGroupPicker` is `false` exactly when `current` matches the `id` of some group in `groups` (the hub is scoped to a concrete group); `true` otherwise (including the `"all"` sentinel or an unknown/stale id). `options` always lists every group with `selected` set on the matching id.

- [ ] **Step 1: Write the failing test**

Create `tests/new-record-form.test.js`:

```js
import { describe, it, expect } from "vitest";
import { buildNewRecordGroupField } from "../scripts/logic/new-record-form.mjs";

const GROUPS = [
  { id: "g1", name: "Group One" },
  { id: "g2", name: "Group Two" }
];

describe("buildNewRecordGroupField", () => {
  it("hides the picker when scoped to a concrete group", () => {
    const vm = buildNewRecordGroupField(GROUPS, "g2");
    expect(vm.showGroupPicker).toBe(false);
  });

  it("shows the picker for the 'all' sentinel", () => {
    const vm = buildNewRecordGroupField(GROUPS, "all");
    expect(vm.showGroupPicker).toBe(true);
  });

  it("shows the picker for an unknown/stale scope id", () => {
    const vm = buildNewRecordGroupField(GROUPS, "deleted-id");
    expect(vm.showGroupPicker).toBe(true);
  });

  it("lists every group and marks the scoped one selected", () => {
    const vm = buildNewRecordGroupField(GROUPS, "g2");
    expect(vm.options.map((o) => o.value)).toEqual(["g1", "g2"]);
    expect(vm.options.filter((o) => o.selected).map((o) => o.value)).toEqual(["g2"]);
  });

  it("marks nothing selected when scope is 'all'", () => {
    const vm = buildNewRecordGroupField(GROUPS, "all");
    expect(vm.options.some((o) => o.selected)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/new-record-form.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/new-record-form.mjs` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `scripts/logic/new-record-form.mjs`:

```js
/** New Record dialog group field view model, mirroring the sort-menu pattern. */

/**
 * Decide whether the New Record dialog should show the group picker, and build
 * its options. The picker is hidden when the hub is scoped to a concrete group
 * (its scope id matches a group in the list); it is shown for the "all" sentinel
 * or any unknown/stale scope id.
 * @param {{id: string, name: string}[]} groups  campaign record groups
 * @param {string} current  the hub's current group scope id (`groupScopeId`)
 * @returns {{showGroupPicker: boolean, options: {value: string, label: string, selected: boolean}[]}}
 */
export function buildNewRecordGroupField(groups, current) {
  const scoped = groups.some((g) => g.id === current);
  return {
    showGroupPicker: !scoped,
    options: groups.map((g) => ({ value: g.id, label: g.name, selected: g.id === current }))
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/new-record-form.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/new-record-form.mjs tests/new-record-form.test.js
git commit -m "feat: add buildNewRecordGroupField view model for New Entry dialog"
```

---

### Task 2: Wire the helper into `#onNewRecord`

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs` (import block near line 1–12; handler `#onNewRecord` at lines 339–375)

**Interfaces:**
- Consumes: `buildNewRecordGroupField(groups, current)` from Task 1.
- Produces: no new exported interface. Behavioral change to `#onNewRecord` only.

- [ ] **Step 1: Add the import**

In `scripts/apps/hub/hub-mixin.mjs`, add after the existing `buildSortMenu` import (line 8):

```js
import { buildNewRecordGroupField } from "../../logic/new-record-form.mjs";
```

- [ ] **Step 2: Build the group field from the view model**

In `#onNewRecord`, replace the current `groupOptions` construction (lines 346–348):

```js
      const groupOptions = groups.map((g) =>
        `<option value="${g.id}" ${g.id === current ? "selected" : ""}>${foundry.utils.escapeHTML(g.name)}</option>`
      ).join("");
```

with a view-model-driven build of both the options and the field markup:

```js
      const groupField = buildNewRecordGroupField(groups, current);
      const groupOptions = groupField.options.map((o) =>
        `<option value="${o.value}" ${o.selected ? "selected" : ""}>${foundry.utils.escapeHTML(o.label)}</option>`
      ).join("");
      const groupFormGroup = groupField.showGroupPicker
        ? `<div class="form-group"><label>${game.i18n.localize("CAMPAIGNRECORD.Hub.GroupPicker")}</label>
            <select name="group">${groupOptions}</select></div>`
        : "";
```

- [ ] **Step 3: Use the conditional field in the dialog content**

Replace the hardcoded group `form-group` in the `content` template (lines 356–357) so it uses `groupFormGroup`. The `content` block becomes:

```js
        content: `
          <div class="form-group"><label>${game.i18n.localize("CAMPAIGNRECORD.Hub.RecordName")}</label>
            <input type="text" name="name" required autofocus></div>
          <div class="form-group"><label>${game.i18n.localize("CAMPAIGNRECORD.Hub.RecordType")}</label>
            <select name="type">${typeOptions}</select></div>
          ${groupFormGroup}`,
```

- [ ] **Step 4: Resolve groupId with a scope fallback in the ok callback**

In the `ok.callback` (lines 360–364), change the `groupId` line so it falls back to the hub scope when the select is absent. The callback is an arrow function, so `this` is the hub instance:

```js
          callback: (event, button) => ({
            name: button.form.elements.name.value.trim(),
            type: button.form.elements.type.value,
            groupId: button.form.elements.group?.value ?? this.groupScopeId
          })
```

- [ ] **Step 5: Run the full unit suite to verify nothing regressed**

Run: `npx vitest run`
Expected: PASS, including `tests/new-record-form.test.js`. No existing test references `#onNewRecord` directly, so none should break.

- [ ] **Step 6: Manual smoke check (record the observation)**

In a Foundry world with the module active and at least two groups:
- Open a group's own hub sheet (`GroupHubSheet`) → click New Entry → confirm the dialog shows **only Name and Type** (no group selector) and the created page lands in that group.
- Open the standalone hub, set its group filter to a specific group → New Entry → confirm no group selector, entry lands in that group.
- Set the standalone hub filter to "all" → New Entry → confirm the group selector **is** shown and the chosen group is used.

- [ ] **Step 7: Commit**

```bash
git add scripts/apps/hub/hub-mixin.mjs
git commit -m "feat: hide New Entry record selector when hub is scoped to a group"
```

---

## Self-Review

**Spec coverage:**
- "Hub scoped to a concrete group → dialog shows only Name and Type, entry auto-lands in scoped group" → Task 1 (`showGroupPicker: false`) + Task 2 Steps 2–4.
- "Standalone hub scoped to 'all' → selector still shown" → Task 1 (`"all"` → `showGroupPicker: true`) + Task 2 Step 3.
- Edge: `current` not in groups (sentinel / deleted) → selector shown → Task 1 unknown-id test.
- Edge: empty group list → unchanged early return in `#onNewRecord` (untouched by this plan; the `getGroups().length` guard at line 341 remains above the new code).
- Testing section (both branches covered) → Task 1 tests + Task 2 Step 6 manual matrix.

**Placeholder scan:** No TBD/TODO/vague steps; every code step shows complete code.

**Type consistency:** `buildNewRecordGroupField(groups, current) → {showGroupPicker, options:[{value,label,selected}]}` is defined identically in Task 1's implementation and interface and consumed with those exact property names in Task 2 Step 2. `groupId` resolution uses `this.groupScopeId`, consistent with the spec and existing handler.
