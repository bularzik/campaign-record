# New-Creation Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alphabetize the New Record dialog's type list with "Journal" preselected, and prefill the Add Timepoint dialog's campaign date from the current world time.

**Architecture:** Two independent pure helpers following the repo's logic-module pattern — `buildNewRecordTypeOptions` in `scripts/logic/new-record-form.mjs` and `currentWorldComponents` in `scripts/logic/campaign-calendar.mjs` — each unit-tested with vitest, then wired into `scripts/apps/hub/hub-mixin.mjs` (`#onNewRecord` and `#onAddTimepoint`).

**Tech Stack:** Foundry VTT v13 module, plain ESM (.mjs), vitest for unit tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-17-new-creation-defaults-design.md`.
- Campaign-date storage shape is `{ year, month, day, hour, minute }` with **0-based month** and **1-based day** (see `parseCampaignDateInput` in `scripts/logic/campaign-date.mjs`). Foundry v13 `timeToComponents` returns a **0-based `dayOfMonth`** — the helper must add 1.
- The Edit Timepoint dialog must not change behavior; only Add prefills.
- Helpers must stay pure (no Foundry globals in `new-record-form.mjs`; `campaign-calendar.mjs` already reads `game`, which tests stub with `vi.stubGlobal`).
- Run tests from the repo root (`campaign-record/`) with `npx vitest run <file>`; finish with the full `npm test`.

---

### Task 1: Alphabetized type list with Journal default

**Files:**
- Modify: `scripts/logic/new-record-form.mjs`
- Modify: `scripts/apps/hub/hub-mixin.mjs:366-406` (`#onNewRecord`) and its constants import (lines 3-6)
- Test: `tests/new-record-form.test.js`

**Interfaces:**
- Consumes: `RECORD_TYPES` (string[]) and `typeId(type) => "campaign-record.<type>"` from `scripts/constants.mjs`.
- Produces: `buildNewRecordTypeOptions(localize: (key: string) => string) => { value: string, label: string, selected: boolean }[]` — alphabetical by label; exactly one entry (`value: "text"`) has `selected: true`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/new-record-form.test.js` (add `buildNewRecordTypeOptions` to the existing import from `../scripts/logic/new-record-form.mjs`):

```js
const TYPE_LABELS = {
  "TYPES.JournalEntryPage.campaign-record.npc": "NPC",
  "TYPES.JournalEntryPage.campaign-record.place": "Place",
  "TYPES.JournalEntryPage.campaign-record.quest": "Quest",
  "TYPES.JournalEntryPage.campaign-record.pc": "PC",
  "TYPES.JournalEntryPage.campaign-record.item": "Item",
  "TYPES.JournalEntryPage.campaign-record.encounter": "Encounter",
  "TYPES.JournalEntryPage.campaign-record.checklist": "Checklist",
  "TYPES.JournalEntryPage.campaign-record.shop": "Shop",
  "TYPES.JournalEntryPage.campaign-record.loot": "Loot",
  "TYPES.JournalEntryPage.campaign-record.media": "Media",
  "CAMPAIGNRECORD.Hub.JournalPage": "Journal"
};
const localize = (k) => TYPE_LABELS[k] ?? k;

describe("buildNewRecordTypeOptions", () => {
  it("lists all record types plus the core text page, alphabetized by label", () => {
    const options = buildNewRecordTypeOptions(localize);
    expect(options.map((o) => o.label)).toEqual([
      "Checklist", "Encounter", "Item", "Journal", "Loot",
      "Media", "NPC", "PC", "Place", "Quest", "Shop"
    ]);
    expect(options.find((o) => o.label === "NPC").value).toBe("campaign-record.npc");
  });

  it("marks only the Journal (text) option selected", () => {
    const options = buildNewRecordTypeOptions(localize);
    expect(options.filter((o) => o.selected).map((o) => o.value)).toEqual(["text"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/new-record-form.test.js`
Expected: FAIL — `buildNewRecordTypeOptions` is not exported.

- [ ] **Step 3: Implement the helper**

In `scripts/logic/new-record-form.mjs`, add at the top:

```js
import { RECORD_TYPES, typeId } from "../constants.mjs";
```

and append:

```js
/**
 * Option list for the New Record dialog's type select: every record kind plus
 * the core text page, alphabetized by localized label. The text page ("text",
 * shown as "Journal") is the default selection.
 * @param {(key: string) => string} localize  i18n resolver
 * @returns {{value: string, label: string, selected: boolean}[]}
 */
export function buildNewRecordTypeOptions(localize) {
  const options = RECORD_TYPES.map((t) => ({
    value: typeId(t),
    label: localize(`TYPES.JournalEntryPage.${typeId(t)}`),
    selected: false
  }));
  options.push({ value: "text", label: localize("CAMPAIGNRECORD.Hub.JournalPage"), selected: true });
  return options.sort((a, b) => a.label.localeCompare(b.label));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/new-record-form.test.js`
Expected: PASS (all describe blocks, old and new).

- [ ] **Step 5: Wire into the dialog**

In `scripts/apps/hub/hub-mixin.mjs`:

1. Extend the new-record-form import:

```js
import { buildNewRecordGroupField, buildNewRecordTypeOptions } from "../../logic/new-record-form.mjs";
```

2. In the constants import (lines 3-6), remove `RECORD_TYPES` — after this change it is unused in the file (`typeId` is still used at line 337 and must stay):

```js
import {
  MODULE_ID, RAIL_SETTING, INLINE_EDIT_SETTING, SNIPPETS_SETTING, typeId, GROUP_SHEET_CLASS,
  TIMELINE_ORDER_SETTING
} from "../../constants.mjs";
```

3. In `#onNewRecord`, replace the `typeOptions` construction (currently lines 370-372):

```js
      const typeOptions = buildNewRecordTypeOptions((k) => game.i18n.localize(k)).map((o) =>
        `<option value="${o.value}"${o.selected ? " selected" : ""}>${foundry.utils.escapeHTML(o.label)}</option>`
      ).join("");
```

Nothing else in `#onNewRecord` changes — the `ok` callback still reads `button.form.elements.type.value`, and `"text"` was already a valid value there.

- [ ] **Step 6: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS — no other suite depends on the option order.

- [ ] **Step 7: Commit**

```bash
git add scripts/logic/new-record-form.mjs scripts/apps/hub/hub-mixin.mjs tests/new-record-form.test.js
git commit -m "feat: alphabetize New Record types and default to Journal"
```

---

### Task 2: Prefill Add Timepoint from world time

**Files:**
- Modify: `scripts/logic/campaign-calendar.mjs`
- Modify: `scripts/apps/hub/hub-mixin.mjs:519-527` (`#onAddTimepoint`) and the campaign-calendar import (line 22)
- Test: `tests/campaign-calendar.test.js`

**Interfaces:**
- Consumes: the module-private `calendar()` accessor already in `campaign-calendar.mjs`; `game.time.worldTime`.
- Produces: `currentWorldComponents() => { year: number, month: number, day: number, hour: number, minute: number } | null` — month 0-based, day 1-based (dialog-ready), `null` when no calendar.

- [ ] **Step 1: Write the failing tests**

Append to `tests/campaign-calendar.test.js` (add `currentWorldComponents` to the existing import from `../scripts/logic/campaign-calendar.mjs`):

```js
describe("currentWorldComponents", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps the current world time to dialog-ready components", () => {
    const timeToComponents = vi.fn(() => ({
      year: 1492, month: 1, dayOfMonth: 14, day: 44, hour: 9, minute: 30, second: 0
    }));
    vi.stubGlobal("game", {
      time: {
        worldTime: 123456,
        calendar: {
          timeToComponents,
          months: { values: [] },
          days: { hoursPerDay: 24, minutesPerHour: 60 }
        }
      }
    });
    expect(currentWorldComponents()).toEqual({ year: 1492, month: 1, day: 15, hour: 9, minute: 30 });
    expect(timeToComponents).toHaveBeenCalledWith(123456);
  });

  it("returns null when no calendar is available", () => {
    vi.stubGlobal("game", { time: {} });
    expect(currentWorldComponents()).toBe(null);
  });
});
```

(The first stub's `dayOfMonth: 14` is Foundry v13's 0-based day-of-month; the expected `day: 15` checks the 1-based conversion. `day: 44` is the v13 day-of-year field and must be ignored.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/campaign-calendar.test.js`
Expected: FAIL — `currentWorldComponents` is not exported.

- [ ] **Step 3: Implement the helper**

Append to `scripts/logic/campaign-calendar.mjs`:

```js
/**
 * The current world time as stored campaign-date components (0-based month,
 * 1-based day), for prefilling new timepoints; null when no calendar.
 */
export function currentWorldComponents() {
  const cal = calendar();
  if (!cal) return null;
  const c = cal.timeToComponents(game.time.worldTime);
  return {
    year: c.year,
    month: c.month ?? 0,
    day: (c.dayOfMonth ?? 0) + 1,
    hour: c.hour ?? 0,
    minute: c.minute ?? 0
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/campaign-calendar.test.js`
Expected: PASS (all describe blocks, old and new).

- [ ] **Step 5: Wire into the Add Timepoint dialog**

In `scripts/apps/hub/hub-mixin.mjs`:

1. Extend the campaign-calendar import (line 22):

```js
import { getCalendarMonths, calendarBounds, hasCalendar, formatCampaignDate, currentWorldComponents } from "../../logic/campaign-calendar.mjs";
```

2. In `#onAddTimepoint` (line 524), pass the prefill as the initial campaign date:

```js
      const result = await HubBase.#promptTimepoint(
        { campaignDate: currentWorldComponents() },
        { titleKey: "CAMPAIGNRECORD.Hub.AddTimepoint" }
      );
```

`#promptTimepoint` already renders `initial.campaignDate` into the year/month/day/HH:MM fields (its `initial.campaignDate ?? null` handles the no-calendar `null`), and `#onEditTimepoint` is untouched, so edits keep showing only the stored date.

- [ ] **Step 6: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/logic/campaign-calendar.mjs scripts/apps/hub/hub-mixin.mjs tests/campaign-calendar.test.js
git commit -m "feat: prefill Add Timepoint campaign date from current world time"
```

---

### Task 3: Full-suite verification

**Files:**
- No new files; verification only.

**Interfaces:**
- Consumes: everything above.
- Produces: a green `npm test` on the branch.

- [ ] **Step 1: Run the complete test suite**

Run: `npm test` (from the repo root)
Expected: PASS — same totals as main plus the 4 new tests, no regressions.

- [ ] **Step 2: Commit any stragglers**

```bash
git status --short
```

Expected: clean tree (both feature commits already made). If anything is uncommitted, review and commit it with an appropriate message before finishing.
