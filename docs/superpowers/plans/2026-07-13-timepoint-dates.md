# Timepoint Create & Campaign Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give timeline timepoints an auto-set real-world create date and a user-editable in-world campaign date, let each user order the timeline by Manual / Create date / Campaign date, and redesign the row so the active date sits right-justified left of a continuous vertical divider.

**Architecture:** Pure ordering/parsing/formatting logic lives in `scripts/logic/` (vitest-tested, no Foundry globals except through a thin feature-detected calendar wrapper). The data layer (`timepoints.mjs`) stamps `createdAt` and stores `campaignDate` components on each timepoint. The hub reorders only for *display* (`getTimepoints` stays canonical manual order for drag/auto-capture/export). A schema-v4 migration backfills `createdAt`.

**Tech Stack:** Foundry VTT v13 module (ES modules), Handlebars templates, vitest (unit), Playwright + quench (e2e), `game.time.calendar` (Foundry v13 CalendarData) for month names and bounds.

## Global Constraints

- Module id is `campaign-record`; all settings/flags namespace under it (`MODULE_ID`).
- Never call `game.time.set` / `game.time.advance` / `calendar.jumpToDate` — campaign date is per-timepoint metadata, the world clock is never touched.
- Feature-detect the calendar with `typeof game.time.calendar?.timeToComponents === "function"`; degrade gracefully when absent (no calendar UI, existing data untouched).
- `getTimepoints(group)` MUST keep returning canonical **manual** (`sort`-key) order — it feeds drag-position math, auto-capture, export, and quench. Display reordering happens only in `#timelineGroups()`.
- Pure logic in `scripts/logic/*.mjs` is vitest-tested and must not read Foundry globals at module top level.
- All user-facing strings are i18n keys under `CAMPAIGNRECORD.*` in `lang/en.json`.
- Calendar month index is 0-based; campaign `day` is 1-based day-of-month; campaign `year` is the visible year.
- Commit after every task with the shown message.

---

### Task 1: Ordering logic — `campaignSortKey` + `orderTimepoints`

**Files:**
- Create: `scripts/logic/campaign-date.mjs`
- Modify: `scripts/logic/timeline-sort.mjs`
- Test: `tests/campaign-date.test.js`, `tests/timeline-sort.test.js`

**Interfaces:**
- Produces: `campaignSortKey(campaignDate) → number | null` (in `campaign-date.mjs`); `orderTimepoints(timepoints, mode) → Timepoint[]` where `mode ∈ "manual"|"created"|"campaign"` (in `timeline-sort.mjs`).
- Consumes: existing `sortTimepoints(timepoints)` from `timeline-sort.mjs`.
- Timepoint shape used here: `{ sort:number, createdAt?:number, campaignDate?: {year,month,day,hour,minute}|null, label:string }`.

- [ ] **Step 1: Write the failing test for `campaignSortKey`**

Create `tests/campaign-date.test.js`:

```js
import { describe, it, expect } from "vitest";
import { campaignSortKey } from "../scripts/logic/campaign-date.mjs";

describe("campaignSortKey", () => {
  it("returns null when the campaign date is unset", () => {
    expect(campaignSortKey(null)).toBe(null);
    expect(campaignSortKey(undefined)).toBe(null);
  });

  it("orders by year, then month, then day, then time", () => {
    const k = (d) => campaignSortKey(d);
    const base = { year: 1492, month: 6, day: 15, hour: null, minute: null };
    expect(k({ ...base, year: 1491 })).toBeLessThan(k(base));
    expect(k({ ...base, month: 5 })).toBeLessThan(k(base));
    expect(k({ ...base, day: 14 })).toBeLessThan(k(base));
    expect(k({ ...base, hour: 9, minute: 0 })).toBeGreaterThan(k(base));
    expect(k({ ...base, hour: 9, minute: 5 })).toBeGreaterThan(k({ ...base, hour: 9, minute: 0 }));
  });

  it("treats missing time as midnight for ordering", () => {
    const noTime = { year: 1492, month: 6, day: 15, hour: null, minute: null };
    const midnight = { year: 1492, month: 6, day: 15, hour: 0, minute: 0 };
    expect(campaignSortKey(noTime)).toBe(campaignSortKey(midnight));
  });

  it("handles negative (pre-epoch) years monotonically", () => {
    const a = { year: -5, month: 0, day: 1, hour: null, minute: null };
    const b = { year: -4, month: 0, day: 1, hour: null, minute: null };
    expect(campaignSortKey(a)).toBeLessThan(campaignSortKey(b));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/campaign-date.test.js`
Expected: FAIL — `campaign-date.mjs` does not exist / `campaignSortKey is not a function`.

- [ ] **Step 3: Implement `campaign-date.mjs`**

Create `scripts/logic/campaign-date.mjs`:

```js
/**
 * Order-preserving numeric key for a campaign date's components, or null when
 * unset. month/day/hour/minute stay < 100 for every shipped calendar, so this
 * needs no calendar month-length math. Missing time sorts as midnight.
 */
export function campaignSortKey(campaignDate) {
  if (!campaignDate) return null;
  const { year, month, day, hour, minute } = campaignDate;
  return ((((year * 100) + month) * 100) + day) * 10000 + ((hour ?? 0) * 100 + (minute ?? 0));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/campaign-date.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `orderTimepoints`**

Append to `tests/timeline-sort.test.js` (add `orderTimepoints` to the existing import from `../scripts/logic/timeline-sort.mjs`):

```js
import { SORT_GAP, sortKeyBetween, sortTimepoints, orderTimepoints } from "../scripts/logic/timeline-sort.mjs";

describe("orderTimepoints", () => {
  const tps = [
    { id: "a", label: "A", sort: 300000, createdAt: 30, campaignDate: { year: 1492, month: 6, day: 20, hour: null, minute: null } },
    { id: "b", label: "B", sort: 100000, createdAt: 10, campaignDate: null },
    { id: "c", label: "C", sort: 200000, createdAt: 20, campaignDate: { year: 1492, month: 6, day: 15, hour: null, minute: null } }
  ];

  it("manual mode preserves sort-key order", () => {
    expect(orderTimepoints(tps, "manual").map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("created mode orders by createdAt ascending, tie-broken by sort key", () => {
    const tie = [
      { id: "x", label: "X", sort: 200000, createdAt: 5, campaignDate: null },
      { id: "y", label: "Y", sort: 100000, createdAt: 5, campaignDate: null }
    ];
    expect(orderTimepoints(tie, "created").map((t) => t.id)).toEqual(["y", "x"]);
    expect(orderTimepoints(tps, "created").map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("campaign mode floats undated to the top (by createdAt), then dated ascending", () => {
    expect(orderTimepoints(tps, "campaign").map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("does not mutate its input", () => {
    const copy = tps.map((t) => ({ ...t }));
    orderTimepoints(tps, "campaign");
    expect(tps).toEqual(copy);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/timeline-sort.test.js`
Expected: FAIL — `orderTimepoints is not a function`.

- [ ] **Step 7: Implement `orderTimepoints`**

Add to `scripts/logic/timeline-sort.mjs` (add the import at the top, keep existing exports):

```js
import { campaignSortKey } from "./campaign-date.mjs";
```

```js
/**
 * Timepoints ordered for display. "manual" is the canonical sort-key order;
 * "created" sorts by createdAt (sort-key tiebreak); "campaign" floats undated
 * timepoints to the top (ordered by createdAt) then dated ascending. Non-mutating.
 */
export function orderTimepoints(timepoints, mode) {
  const byCreated = (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0);
  if (mode === "created") {
    return [...timepoints].sort((a, b) => byCreated(a, b) || a.sort - b.sort);
  }
  if (mode === "campaign") {
    return [...timepoints].sort((a, b) => {
      const ka = campaignSortKey(a.campaignDate);
      const kb = campaignSortKey(b.campaignDate);
      if (ka == null && kb == null) return byCreated(a, b);
      if (ka == null) return -1;   // undated rises to the top
      if (kb == null) return 1;
      return ka - kb || byCreated(a, b);
    });
  }
  return sortTimepoints(timepoints);
}
```

- [ ] **Step 8: Run both test files to verify they pass**

Run: `npx vitest run tests/campaign-date.test.js tests/timeline-sort.test.js`
Expected: PASS (all).

- [ ] **Step 9: Commit**

```bash
git add scripts/logic/campaign-date.mjs scripts/logic/timeline-sort.mjs tests/campaign-date.test.js tests/timeline-sort.test.js
git commit -m "feat: campaign-date sort key and display ordering"
```

---

### Task 2: Campaign-date input parsing + display formatting (pure)

**Files:**
- Modify: `scripts/logic/campaign-date.mjs`
- Test: `tests/campaign-date.test.js`

**Interfaces:**
- Produces:
  - `parseCampaignDateInput(raw, bounds) → { components: Components|null, error: string|null }` where `raw = { year, month, day, time }` (strings from form inputs) and `bounds = { monthCount:number, monthDayCounts:number[], hoursPerDay:number, minutesPerHour:number }`. `error` is an i18n key or null. `components` is `{ year, month, day, hour, minute }` with `hour`/`minute` null when time blank, or null when the date is left entirely blank.
  - `formatComponentsFallback(components, monthName) → string` e.g. `"Flamerule 15, 1492"` (+ ` 14:30` when time set).
  - `formatCreateDate(ms) → string` short locale date, `""` when not a finite number.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

Append to `tests/campaign-date.test.js` (extend the import):

```js
import {
  campaignSortKey, parseCampaignDateInput, formatComponentsFallback, formatCreateDate
} from "../scripts/logic/campaign-date.mjs";

const BOUNDS = { monthCount: 12, monthDayCounts: [31,28,31,30,31,30,31,31,30,31,30,31], hoursPerDay: 24, minutesPerHour: 60 };

describe("parseCampaignDateInput", () => {
  it("returns unset (null components, no error) when year/month/day all blank", () => {
    expect(parseCampaignDateInput({ year: "", month: "", day: "", time: "" }, BOUNDS))
      .toEqual({ components: null, error: null });
  });

  it("errors when the date is partially filled", () => {
    const r = parseCampaignDateInput({ year: "1492", month: "6", day: "", time: "" }, BOUNDS);
    expect(r.components).toBe(null);
    expect(r.error).toBe("CAMPAIGNRECORD.Hub.CampaignDatePartial");
  });

  it("parses a full date with no time", () => {
    expect(parseCampaignDateInput({ year: "1492", month: "6", day: "15", time: "" }, BOUNDS))
      .toEqual({ components: { year: 1492, month: 6, day: 15, hour: null, minute: null }, error: null });
  });

  it("parses a full date with time", () => {
    expect(parseCampaignDateInput({ year: "1492", month: "6", day: "15", time: "14:30" }, BOUNDS))
      .toEqual({ components: { year: 1492, month: 6, day: 15, hour: 14, minute: 30 }, error: null });
  });

  it("rejects a day beyond the selected month's length", () => {
    const r = parseCampaignDateInput({ year: "1492", month: "1", day: "30", time: "" }, BOUNDS); // Feb=28
    expect(r.error).toBe("CAMPAIGNRECORD.Hub.CampaignDateBadDay");
  });

  it("rejects an out-of-range month", () => {
    const r = parseCampaignDateInput({ year: "1492", month: "12", day: "1", time: "" }, BOUNDS);
    expect(r.error).toBe("CAMPAIGNRECORD.Hub.CampaignDateBadMonth");
  });

  it("rejects malformed or out-of-range time", () => {
    expect(parseCampaignDateInput({ year: "1492", month: "0", day: "1", time: "9am" }, BOUNDS).error)
      .toBe("CAMPAIGNRECORD.Hub.CampaignDateBadTime");
    expect(parseCampaignDateInput({ year: "1492", month: "0", day: "1", time: "24:00" }, BOUNDS).error)
      .toBe("CAMPAIGNRECORD.Hub.CampaignDateBadTime");
    expect(parseCampaignDateInput({ year: "1492", month: "0", day: "1", time: "12:60" }, BOUNDS).error)
      .toBe("CAMPAIGNRECORD.Hub.CampaignDateBadTime");
  });
});

describe("formatComponentsFallback", () => {
  it("builds a name/day/year string, appending time when set", () => {
    expect(formatComponentsFallback({ year: 1492, month: 6, day: 15, hour: null, minute: null }, "Flamerule"))
      .toBe("Flamerule 15, 1492");
    expect(formatComponentsFallback({ year: 1492, month: 6, day: 15, hour: 14, minute: 5 }, "Flamerule"))
      .toBe("Flamerule 15, 1492 14:05");
  });
});

describe("formatCreateDate", () => {
  it("returns a non-empty string for a timestamp and empty for non-numbers", () => {
    expect(formatCreateDate(1_700_000_000_000)).not.toBe("");
    expect(formatCreateDate(null)).toBe("");
    expect(formatCreateDate(undefined)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/campaign-date.test.js`
Expected: FAIL — `parseCampaignDateInput is not a function`.

- [ ] **Step 3: Implement the three functions**

Append to `scripts/logic/campaign-date.mjs`:

```js
/**
 * Validate raw modal inputs into campaign-date components, or null when blank.
 * Returns { components, error } where error is an i18n key or null. bounds:
 * { monthCount, monthDayCounts[], hoursPerDay, minutesPerHour }.
 */
export function parseCampaignDateInput(raw, bounds) {
  const y = (raw.year ?? "").trim();
  const m = (raw.month ?? "").trim();
  const d = (raw.day ?? "").trim();
  const t = (raw.time ?? "").trim();

  if (!y && !m && !d) return { components: null, error: null };
  if (!y || !m || !d) return { components: null, error: "CAMPAIGNRECORD.Hub.CampaignDatePartial" };

  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!Number.isInteger(year)) return { components: null, error: "CAMPAIGNRECORD.Hub.CampaignDateBadYear" };
  if (!Number.isInteger(month) || month < 0 || month >= bounds.monthCount) {
    return { components: null, error: "CAMPAIGNRECORD.Hub.CampaignDateBadMonth" };
  }
  const maxDay = bounds.monthDayCounts[month] ?? 31;
  if (!Number.isInteger(day) || day < 1 || day > maxDay) {
    return { components: null, error: "CAMPAIGNRECORD.Hub.CampaignDateBadDay" };
  }

  let hour = null;
  let minute = null;
  if (t) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!match) return { components: null, error: "CAMPAIGNRECORD.Hub.CampaignDateBadTime" };
    hour = Number(match[1]);
    minute = Number(match[2]);
    if (hour < 0 || hour >= bounds.hoursPerDay || minute < 0 || minute >= bounds.minutesPerHour) {
      return { components: null, error: "CAMPAIGNRECORD.Hub.CampaignDateBadTime" };
    }
  }
  return { components: { year, month, day, hour, minute }, error: null };
}

/** In-world date label built from components + a resolved month name. */
export function formatComponentsFallback(components, monthName) {
  if (!components) return "";
  const time = components.hour != null
    ? ` ${String(components.hour).padStart(2, "0")}:${String(components.minute ?? 0).padStart(2, "0")}`
    : "";
  return `${monthName} ${components.day}, ${components.year}${time}`;
}

/** Real-world create date as a short locale date; "" when unset. */
export function formatCreateDate(ms) {
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString() : "";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/campaign-date.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/campaign-date.mjs tests/campaign-date.test.js
git commit -m "feat: campaign-date input parsing and formatting helpers"
```

---

### Task 3: Calendar wrapper (`campaign-calendar.mjs`)

**Files:**
- Create: `scripts/logic/campaign-calendar.mjs`
- Test: `tests/campaign-calendar.test.js`

**Interfaces:**
- Produces:
  - `hasCalendar() → boolean`
  - `getCalendarMonths() → [{ index:number, name:string, days:number }]` (localized names; `[]` when no calendar)
  - `calendarBounds() → { monthCount, monthDayCounts:number[], hoursPerDay, minutesPerHour }`
  - `formatCampaignDate(components) → string` (uses `getCalendarMonths()` for the month name + `formatComponentsFallback`; `""` when unset)
- Consumes: `formatComponentsFallback` from `campaign-date.mjs`; reads `game.time.calendar` and `game.i18n` at call time only.

- [ ] **Step 1: Write the failing test (stubbing `game`)**

Create `tests/campaign-calendar.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  hasCalendar, getCalendarMonths, calendarBounds, formatCampaignDate
} from "../scripts/logic/campaign-calendar.mjs";

function stubCalendar() {
  vi.stubGlobal("game", {
    i18n: { localize: (k) => k.replace("MONTH.", "") },
    time: {
      calendar: {
        timeToComponents: () => ({}),
        months: { values: [
          { name: "MONTH.Hammer", days: 30 },
          { name: "MONTH.Alturiak", days: 30 },
          { name: "MONTH.Ches", days: 30 }
        ] },
        days: { hoursPerDay: 24, minutesPerHour: 60 }
      }
    }
  });
}

describe("campaign-calendar with a calendar present", () => {
  beforeEach(stubCalendar);
  afterEach(() => vi.unstubAllGlobals());

  it("detects the calendar", () => {
    expect(hasCalendar()).toBe(true);
  });

  it("lists localized months with 0-based indices", () => {
    expect(getCalendarMonths()).toEqual([
      { index: 0, name: "Hammer", days: 30 },
      { index: 1, name: "Alturiak", days: 30 },
      { index: 2, name: "Ches", days: 30 }
    ]);
  });

  it("reports bounds from the calendar", () => {
    expect(calendarBounds()).toEqual({
      monthCount: 3, monthDayCounts: [30, 30, 30], hoursPerDay: 24, minutesPerHour: 60
    });
  });

  it("formats a campaign date with the localized month name", () => {
    expect(formatCampaignDate({ year: 1492, month: 1, day: 15, hour: null, minute: null }))
      .toBe("Alturiak 15, 1492");
    expect(formatCampaignDate(null)).toBe("");
  });
});

describe("campaign-calendar with no calendar", () => {
  beforeEach(() => vi.stubGlobal("game", { i18n: { localize: (k) => k }, time: {} }));
  afterEach(() => vi.unstubAllGlobals());

  it("reports absence and empty months, with default bounds", () => {
    expect(hasCalendar()).toBe(false);
    expect(getCalendarMonths()).toEqual([]);
    expect(calendarBounds()).toEqual({
      monthCount: 12, monthDayCounts: [], hoursPerDay: 24, minutesPerHour: 60
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/campaign-calendar.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `campaign-calendar.mjs`**

Create `scripts/logic/campaign-calendar.mjs`:

```js
import { formatComponentsFallback } from "./campaign-date.mjs";

/** The active in-world calendar, or null on pre-v13 cores / when unavailable. */
function calendar() {
  const cal = game.time?.calendar;
  return cal && typeof cal.timeToComponents === "function" ? cal : null;
}

export function hasCalendar() {
  return calendar() != null;
}

/** Localized months with 0-based indices; [] when no calendar. */
export function getCalendarMonths() {
  const cal = calendar();
  if (!cal) return [];
  return cal.months.values.map((m, index) => ({
    index,
    name: game.i18n.localize(m.name),
    days: m.leapDays ?? m.days
  }));
}

/** Validation bounds for campaign-date entry; safe defaults when no calendar. */
export function calendarBounds() {
  const cal = calendar();
  const days = cal?.days ?? {};
  return {
    monthCount: cal ? cal.months.values.length : 12,
    monthDayCounts: cal ? cal.months.values.map((m) => m.leapDays ?? m.days) : [],
    hoursPerDay: days.hoursPerDay ?? 24,
    minutesPerHour: days.minutesPerHour ?? 60
  };
}

/** Localized in-world date label for stored components; "" when unset. */
export function formatCampaignDate(components) {
  if (!components) return "";
  const monthName = getCalendarMonths()[components.month]?.name ?? `Month ${components.month + 1}`;
  return formatComponentsFallback(components, monthName);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/campaign-calendar.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/campaign-calendar.mjs tests/campaign-calendar.test.js
git commit -m "feat: feature-detected calendar wrapper for campaign dates"
```

---

### Task 4: `timelineOrder` client setting

**Files:**
- Modify: `scripts/constants.mjs`, `scripts/hooks/hub-ui.mjs`

**Interfaces:**
- Produces: constant `TIMELINE_ORDER_SETTING = "timelineOrder"`; a registered client setting (values `"manual"|"created"|"campaign"`, default `"manual"`) whose `onChange` re-renders open hubs' `header` + `timeline` parts.
- Consumes: existing `registerHubSettings()` and its imported `CampaignHub` / `GroupHubSheet` classes.

- [ ] **Step 1: Add the constant**

In `scripts/constants.mjs`, after the `SNIPPETS_SETTING` line (~55):

```js
/** Client setting: timeline order mode — "manual" | "created" | "campaign". */
export const TIMELINE_ORDER_SETTING = "timelineOrder";
```

- [ ] **Step 2: Register the setting**

In `scripts/hooks/hub-ui.mjs`, add `TIMELINE_ORDER_SETTING` to the import from `../constants.mjs`, then inside `registerHubSettings()` (after the `INLINE_EDIT_SETTING` block, before the closing brace):

```js
  game.settings.register(MODULE_ID, TIMELINE_ORDER_SETTING, {
    scope: "client",
    config: false,
    type: String,
    default: "manual",
    onChange: () => {
      // Reorders the timeline and refreshes the settings-menu radios.
      for (const app of foundry.applications.instances.values()) {
        if (!app.rendered) continue;
        if (app instanceof CampaignHub || app instanceof GroupHubSheet) {
          app.render({ parts: ["header", "timeline"] });
        }
      }
    }
  });
```

- [ ] **Step 3: Verify the module loads (unit suite still green)**

Run: `npx vitest run`
Expected: PASS (no unit test depends on this; this confirms no syntax/import error).

- [ ] **Step 4: Commit**

```bash
git add scripts/constants.mjs scripts/hooks/hub-ui.mjs
git commit -m "feat: register timelineOrder client setting"
```

---

### Task 5: Data layer — stamp `createdAt`, add `editTimepoint`

**Files:**
- Modify: `scripts/data/timepoints.mjs`
- Modify: `scripts/testing/quench.mjs`

**Interfaces:**
- Produces:
  - `addTimepoint(group, label, position = null, campaignDate = null)` — now also stamps `createdAt: Date.now()` and stores `campaignDate`.
  - `editTimepoint(group, id, { label, campaignDate })` — updates label and/or campaignDate (only the keys present are written).
  - `renameTimepoint(group, id, label)` — retained, now delegates to `editTimepoint`.
- Consumes: existing private `updateTimepoint(group, id, patch)`, `getTimepoints`, `sortKeyBetween`.

- [ ] **Step 1: Modify `addTimepoint` to stamp createdAt + campaignDate**

In `scripts/data/timepoints.mjs`, replace the `addTimepoint` body's `tp` object and signature:

```js
export async function addTimepoint(group, label, position = null, campaignDate = null) {
  // Concurrent edits to a group's timepoints are last-write-wins on the whole
  // flag array (accepted: the array is small and edits are rare).
  if (!Number.isInteger(position)) position = null;
  const tps = getTimepoints(group);
  const i = position == null ? tps.length : Math.max(0, Math.min(position, tps.length));
  const tp = {
    id: foundry.utils.randomID(),
    label,
    sort: sortKeyBetween(tps[i - 1]?.sort ?? null, tps[i]?.sort ?? null),
    createdAt: Date.now(),
    campaignDate: campaignDate ?? null
  };
  await setTimepoints(group, [...tps, tp]);
  return tp;
}
```

- [ ] **Step 2: Add `editTimepoint` and delegate `renameTimepoint`**

Replace the existing `renameTimepoint` function with:

```js
/** Update a timepoint's label and/or campaign date. Only provided keys change. */
export async function editTimepoint(group, id, { label, campaignDate } = {}) {
  const patch = {};
  if (label !== undefined) patch.label = label;
  if (campaignDate !== undefined) patch.campaignDate = campaignDate;
  if (Object.keys(patch).length) await updateTimepoint(group, id, patch);
}

export async function renameTimepoint(group, id, label) {
  await editTimepoint(group, id, { label });
}
```

(`updateTimepoint` is defined lower in the file; hoisted `async function` declarations are in scope.)

- [ ] **Step 3: Add quench coverage**

In `scripts/testing/quench.mjs`, add `editTimepoint` to the import from `../data/timepoints.mjs`, and add these assertions inside the timepoints test group (mirror the existing `getTimepoints`/`addTimepoint` style already in that file):

```js
        it("stamps createdAt on add and stores a campaign date via editTimepoint", async () => {
          const tp = await addTimepoint(group, "Dated");
          let stored = getTimepoints(group).find((t) => t.id === tp.id);
          assert.ok(Number.isFinite(stored.createdAt), "createdAt is set");
          assert.equal(stored.campaignDate, null);

          await editTimepoint(group, tp.id, {
            campaignDate: { year: 1492, month: 6, day: 15, hour: null, minute: null }
          });
          stored = getTimepoints(group).find((t) => t.id === tp.id);
          assert.equal(stored.campaignDate.day, 15);
          assert.equal(stored.label, "Dated", "label unchanged when only date edited");
        });
```

- [ ] **Step 4: Run the unit suite (guards against import/syntax errors)**

Run: `npx vitest run`
Expected: PASS. (Quench assertions run in-Foundry during Task 10's e2e; this step just confirms nothing else broke.)

- [ ] **Step 5: Commit**

```bash
git add scripts/data/timepoints.mjs scripts/testing/quench.mjs
git commit -m "feat: stamp timepoint createdAt and add editTimepoint"
```

---

### Task 6: Schema-v4 migration — backfill `createdAt`

**Files:**
- Modify: `scripts/constants.mjs`, `scripts/data/migration-runner.mjs`

**Interfaces:**
- Produces: `MIGRATIONS` entry `version: 4` backfilling `createdAt` on existing timepoints; `SCHEMA_VERSION` bumped to `4`.
- Consumes: existing `getGroups`, `MODULE_ID`, `GROUP_FLAG`.

- [ ] **Step 1: Bump the schema version**

In `scripts/constants.mjs`, change:

```js
export const SCHEMA_VERSION = 4;
```

- [ ] **Step 2: Add the migration**

In `scripts/data/migration-runner.mjs`, append a new entry to the `MIGRATIONS` array (after the `version: 3` entry, inside the array):

```js
  ,{
    version: 4,
    // Timepoints gained a real-world createdAt and an in-world campaignDate.
    // True creation time is unrecoverable, so stamp existing timepoints with
    // the migration time; campaignDate stays unset. Idempotent: a group whose
    // timepoints all already carry createdAt is skipped.
    async run() {
      const now = Date.now();
      for (const group of getGroups()) {
        const flag = group.getFlag(MODULE_ID, GROUP_FLAG);
        const tps = flag?.timepoints;
        if (!Array.isArray(tps) || !tps.length) continue;
        if (tps.every((t) => Number.isFinite(t.createdAt))) continue;
        const stamped = tps.map((t) =>
          Number.isFinite(t.createdAt) ? t : { ...t, createdAt: now });
        await group.setFlag(MODULE_ID, GROUP_FLAG, { ...flag, timepoints: stamped });
      }
    }
  }
```

- [ ] **Step 3: Run the unit suite**

Run: `npx vitest run`
Expected: PASS (confirms no syntax error; migration itself is exercised in Foundry).

- [ ] **Step 4: Commit**

```bash
git add scripts/constants.mjs scripts/data/migration-runner.mjs
git commit -m "feat: schema v4 migration backfills timepoint createdAt"
```

---

### Task 7: Timepoint editor modal (label + campaign date)

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs`
- Modify: `lang/en.json`

**Interfaces:**
- Produces: `#promptTimepoint(initial)` returning `{ label, campaignDate } | null`; `#onAddTimepoint` and `#onEditTimepoint` (renamed from `#onRenameTimepoint`) using it; template action key `editTimepoint`.
- Consumes: `getCalendarMonths`, `calendarBounds`, `hasCalendar` (campaign-calendar), `parseCampaignDateInput` (campaign-date), `Timepoints.addTimepoint`, `Timepoints.editTimepoint`, `Timepoints.getTimepoints`.

- [ ] **Step 1: Add imports**

In `scripts/apps/hub/hub-mixin.mjs`, add near the other logic imports:

```js
import { getCalendarMonths, calendarBounds, hasCalendar } from "../../logic/campaign-calendar.mjs";
import { parseCampaignDateInput } from "../../logic/campaign-date.mjs";
```

- [ ] **Step 2: Replace `#promptLabel` with `#promptTimepoint`**

Replace the entire `#promptLabel` static method with:

```js
    /**
     * Prompt for a timepoint's label and optional campaign date. `initial` may
     * carry `{ label, campaignDate }`. Returns `{ label, campaignDate }` or null
     * when cancelled / on an invalid date (a warning is shown for the latter).
     */
    static async #promptTimepoint(initial = {}, { titleKey, okKey = "CAMPAIGNRECORD.Create" } = {}) {
      const label = initial.label ?? "";
      const cd = initial.campaignDate ?? null;
      const months = getCalendarMonths();
      const bounds = calendarBounds();
      const esc = foundry.utils.escapeHTML;

      const monthOptions = months.map((m) =>
        `<option value="${m.index}"${cd && cd.month === m.index ? " selected" : ""}>${esc(m.name)}</option>`
      ).join("");
      const timeValue = cd && cd.hour != null
        ? `${String(cd.hour).padStart(2, "0")}:${String(cd.minute ?? 0).padStart(2, "0")}` : "";

      const dateFields = hasCalendar() ? `
        <fieldset class="cr-campaign-date">
          <legend>${game.i18n.localize("CAMPAIGNRECORD.Hub.CampaignDate")}</legend>
          <div class="form-group">
            <label>${game.i18n.localize("CAMPAIGNRECORD.Hub.CampaignYear")}</label>
            <input type="number" name="year" value="${cd ? cd.year : ""}" step="1">
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("CAMPAIGNRECORD.Hub.CampaignMonth")}</label>
            <select name="month"><option value="">—</option>${monthOptions}</select>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("CAMPAIGNRECORD.Hub.CampaignDay")}</label>
            <input type="number" name="day" value="${cd ? cd.day : ""}" min="1" step="1">
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("CAMPAIGNRECORD.Hub.CampaignTime")}</label>
            <input type="text" name="time" value="${esc(timeValue)}" placeholder="HH:MM">
          </div>
        </fieldset>` : `<p class="notes">${game.i18n.localize("CAMPAIGNRECORD.Hub.CampaignDateUnavailable")}</p>`;

      return foundry.applications.api.DialogV2.prompt({
        window: { title: titleKey },
        content: `<div class="form-group">
            <label>${game.i18n.localize("CAMPAIGNRECORD.Hub.TimepointLabel")}</label>
            <input type="text" name="label" value="${esc(label)}" required autofocus>
          </div>${dateFields}`,
        ok: {
          label: okKey,
          callback: (event, button) => {
            const form = button.form.elements;
            const newLabel = form.label.value.trim();
            if (!newLabel) return null;
            if (!hasCalendar()) return { label: newLabel, campaignDate: undefined };
            const { components, error } = parseCampaignDateInput({
              year: form.year.value, month: form.month.value,
              day: form.day.value, time: form.time.value
            }, bounds);
            if (error) {
              ui.notifications.warn(game.i18n.localize(error));
              return null;
            }
            return { label: newLabel, campaignDate: components };
          }
        },
        rejectClose: false
      });
    }
```

Note: when there is no calendar, `campaignDate` is returned as `undefined` so `editTimepoint` leaves any existing date untouched; when a calendar is present, `components` (possibly `null` to clear) is returned.

- [ ] **Step 3: Update `#onAddTimepoint`**

Replace `#onAddTimepoint` with:

```js
    static async #onAddTimepoint(event, target) {
      const group = game.journal.get(target.closest("[data-group-id]").dataset.groupId);
      if (!group) return;
      const raw = Number(target.dataset.position);
      const position = target.dataset.position != null && Number.isInteger(raw) ? raw : null;
      const result = await HubBase.#promptTimepoint({}, { titleKey: "CAMPAIGNRECORD.Hub.AddTimepoint" });
      if (!result) return;
      await Timepoints.addTimepoint(group, result.label, position, result.campaignDate ?? null);
    }
```

- [ ] **Step 4: Rename `#onRenameTimepoint` → `#onEditTimepoint`**

Replace `#onRenameTimepoint` with:

```js
    static async #onEditTimepoint(event, target) {
      const group = game.journal.get(target.closest("[data-group-id]").dataset.groupId);
      if (!group) return;
      const id = target.closest("[data-timepoint-id]").dataset.timepointId;
      const current = Timepoints.getTimepoints(group).find((t) => t.id === id);
      if (!current) return;
      const result = await HubBase.#promptTimepoint(
        { label: current.label, campaignDate: current.campaignDate ?? null },
        { titleKey: "CAMPAIGNRECORD.Hub.EditTimepoint", okKey: "CAMPAIGNRECORD.Hub.Save" }
      );
      if (!result) return;
      await Timepoints.editTimepoint(group, id, { label: result.label, campaignDate: result.campaignDate });
    }
```

- [ ] **Step 5: Update the action map**

In `static DEFAULT_OPTIONS` `actions` (~line 53-54), change the `renameTimepoint` entry to `editTimepoint`:

```js
        addTimepoint: HubBase.#onAddTimepoint,
        editTimepoint: HubBase.#onEditTimepoint,
```

- [ ] **Step 6: Add localization keys**

In `lang/en.json`, inside the `CAMPAIGNRECORD.Hub` object (near the existing `RenameTimepoint`/`TimepointLabel` keys), add:

```json
      "EditTimepoint": "Edit Timepoint",
      "Save": "Save",
      "CampaignDate": "Campaign date",
      "CampaignYear": "Year",
      "CampaignMonth": "Month",
      "CampaignDay": "Day",
      "CampaignTime": "Time (HH:MM)",
      "CampaignDateUnavailable": "No in-world calendar is configured, so a campaign date can't be set.",
      "CampaignDatePartial": "Enter year, month, and day together, or leave all three blank.",
      "CampaignDateBadYear": "Enter a whole-number year.",
      "CampaignDateBadMonth": "Choose a month.",
      "CampaignDateBadDay": "That day is outside the selected month.",
      "CampaignDateBadTime": "Enter time as HH:MM within the calendar's day.",
```

(Keep the existing `RenameTimepoint` key — the tooltip in Task 8's template switches to `EditTimepoint`; leaving the old key avoids breaking anything that still references it.)

- [ ] **Step 7: Verify unit suite + JSON validity**

Run: `npx vitest run && node -e "JSON.parse(require('fs').readFileSync('lang/en.json','utf8')); console.log('lang ok')"`
Expected: vitest PASS; prints `lang ok`.

- [ ] **Step 8: Commit**

```bash
git add scripts/apps/hub/hub-mixin.mjs lang/en.json
git commit -m "feat: timepoint editor modal with campaign date fields"
```

---

### Task 8: Timeline display — ordering, date column, divider

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs` (`#timelineGroups`, `_prepareContext`)
- Modify: `templates/hub/timeline.hbs`
- Modify: `styles/campaign-record.css`

**Interfaces:**
- Consumes: `orderTimepoints` (timeline-sort), `formatCampaignDate` (campaign-calendar), `formatCreateDate` (campaign-date), `TIMELINE_ORDER_SETTING`.
- Produces: timeline context with per-group `manualMode` and per-timepoint `dateLabel`, plus root `showDateColumn`; the two-column row layout with a continuous divider.

- [ ] **Step 1: Add imports**

In `scripts/apps/hub/hub-mixin.mjs`, add these imports (the file does not currently import from `timeline-sort.mjs`, so add a fresh line):

```js
import { orderTimepoints } from "../../logic/timeline-sort.mjs";
import { formatCampaignDate } from "../../logic/campaign-calendar.mjs";
import { formatCreateDate } from "../../logic/campaign-date.mjs";
```

Also add `TIMELINE_ORDER_SETTING` to the existing multi-symbol import from `../../constants.mjs` (the `MODULE_ID, RAIL_SETTING, INLINE_EDIT_SETTING, SNIPPETS_SETTING, RECORD_TYPES, ...` line ~4). This single import covers Tasks 8 and 9.

- [ ] **Step 2: Reorder for display in `#timelineGroups`**

Replace the `#timelineGroups` method body so it orders by the setting and computes each `dateLabel`:

```js
    #timelineGroups() {
      const mode = game.settings.get(MODULE_ID, TIMELINE_ORDER_SETTING);
      return getScopedGroups(this.groupScopeId).map((group) => {
        const canEdit = group.canUserModify(game.user, "update");
        const ordered = orderTimepoints(Timepoints.getTimepoints(group), mode);
        return {
          id: group.id,
          name: group.name,
          canEdit,
          manualMode: mode === "manual",
          timepoints: ordered.map((tp, i) => ({
            ...tp,
            position: i,
            canEdit,
            dateLabel: mode === "campaign"
              ? formatCampaignDate(tp.campaignDate)
              : formatCreateDate(tp.createdAt),
            links: Timepoints.resolveLinks(tp, game.user).map((entry) => ({
              ...entry,
              broken: entry.kind === "broken",
              thumb: entry.img || null,
              canToggleVisibility: canEdit && game.user.isGM && entry.kind === "image"
            }))
          }))
        };
      });
    }
```

(In manual mode `dateLabel` is computed but unused — the template hides the column.)

- [ ] **Step 3: Expose `showDateColumn` on the context**

In `_prepareContext`, on the line after `context.timelineGroups = this.#timelineGroups();` (~613), add:

```js
      context.showDateColumn = game.settings.get(MODULE_ID, TIMELINE_ORDER_SETTING) !== "manual";
```

- [ ] **Step 4: Rewrite the timepoint row in `timeline.hbs`**

Replace the `<ol class="timepoints">` … `</ol>` block with the two-column layout (date column + body; drag/insert gated on manual mode via `@root.showDateColumn`):

```hbs
    <ol class="timepoints{{#unless @root.showDateColumn}} manual{{/unless}}{{#if @root.showDateColumn}} with-dates{{/if}}">
      {{#each this.timepoints}}
      <li class="timepoint" data-timepoint-id="{{this.id}}" data-position="{{this.position}}"
          {{#unless @root.showDateColumn}}data-drag-timepoint data-drop-timepoint draggable="true"{{/unless}}>
        {{#if @root.showDateColumn}}<div class="timepoint-date">{{this.dateLabel}}</div>{{/if}}
        <div class="timepoint-body">
          <div class="timepoint-head">
            <span class="timepoint-label">{{this.label}}</span>
            {{#if this.canEdit}}
            {{#unless @root.showDateColumn}}
            <button type="button" data-action="addTimepoint" data-position="{{this.position}}"
                    data-tooltip="CAMPAIGNRECORD.Hub.InsertBefore"><i class="fa-solid fa-arrow-up"></i></button>
            {{/unless}}
            <button type="button" data-action="editTimepoint"
                    data-tooltip="CAMPAIGNRECORD.Hub.EditTimepoint"><i class="fa-solid fa-pen"></i></button>
            <button type="button" data-action="deleteTimepoint"
                    data-tooltip="CAMPAIGNRECORD.Hub.DeleteTimepoint"><i class="fa-solid fa-trash"></i></button>
            {{/if}}
          </div>
          <div class="timepoint-records">
            {{#each this.links}}
            <span class="record-chip link-chip{{#if this.broken}} broken{{/if}}"
                  data-link-id="{{this.id}}" data-action="openLink" data-name="{{this.name}}"
                  {{#if this.uuid}}data-uuid="{{this.uuid}}"{{/if}}
                  {{#if this.src}}data-src="{{this.src}}"{{/if}}>
              {{#if this.thumb}}<img class="link-thumb" src="{{this.thumb}}" alt="">{{else}}<i class="{{this.icon}}"></i>{{/if}}
              {{this.name}}
              {{#if this.canToggleVisibility}}
              <a data-action="toggleLinkShowPlayers" data-tooltip="CAMPAIGNRECORD.Hub.ToggleShowPlayers"><i class="fa-solid {{#if this.showPlayers}}fa-eye{{else}}fa-eye-slash{{/if}}"></i></a>
              {{/if}}
              {{#if ../canEdit}}
              <a data-action="removeLink" data-tooltip="CAMPAIGNRECORD.Hub.RemoveLink"><i class="fa-solid fa-xmark"></i></a>
              {{/if}}
            </span>
            {{/each}}
          </div>
        </div>
      </li>
      {{else}}
      <li class="hint">{{localize "CAMPAIGNRECORD.Hub.NoTimepoints"}}</li>
      {{/each}}
    </ol>
```

- [ ] **Step 5: Add the CSS for the date column + continuous divider**

In `styles/campaign-record.css`, after the existing `.campaign-hub .timepoint-head .timepoint-label` rule block (~262), add:

```css
/* Date-ordered timeline: right-justified date column + one continuous divider. */
.campaign-hub .timepoints.with-dates {
  position: relative;
  border-left: none;
}
.campaign-hub .timepoints.with-dates::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--cr-date-col-width, 7rem);
  width: 2px;
  background: var(--color-border-light-primary, #7a7971);
}
.campaign-hub .timepoints.with-dates .timepoint {
  display: grid;
  grid-template-columns: var(--cr-date-col-width, 7rem) 1fr;
  column-gap: 0.75rem;
  margin-left: 0;
}
.campaign-hub .timepoint-date {
  text-align: right;
  padding-right: 0.5rem;
  align-self: start;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-dark-secondary, #4b4a44);
}
```

- [ ] **Step 6: Manual verification in Foundry (build + smoke)**

Run: `npx vitest run`
Expected: PASS.

Then load the module in Foundry (or rely on Task 10's e2e). Manual smoke: open the hub → gear menu shows order radios (Task 9) → in Manual mode the timeline looks exactly as before (left rail, no date column); in Create/Campaign mode a right-justified date column appears with a straight vertical line separating it from names.

- [ ] **Step 7: Commit**

```bash
git add scripts/apps/hub/hub-mixin.mjs templates/hub/timeline.hbs styles/campaign-record.css
git commit -m "feat: date-ordered timeline row with divider column"
```

---

### Task 9: Settings-menu order toggle

**Files:**
- Modify: `templates/hub/header.hbs`
- Modify: `scripts/apps/hub/hub-mixin.mjs` (`_prepareContext`, action handler, action map)
- Modify: `lang/en.json`
- Modify: `styles/campaign-record.css`

**Interfaces:**
- Produces: `orderOptions` on the header context (`[{ value, label, selected }]`); action `setTimelineOrder`; the three-radio group in the gear panel.
- Consumes: `TIMELINE_ORDER_SETTING`.

- [ ] **Step 1: Build `orderOptions` in `_prepareContext`**

In `_prepareContext`, near the other header context assignments (e.g. after `context.settingsMenuOpen = this.state.settingsMenuOpen;` ~615), add:

```js
      const orderMode = game.settings.get(MODULE_ID, TIMELINE_ORDER_SETTING);
      context.orderOptions = ["manual", "created", "campaign"].map((value) => ({
        value,
        label: game.i18n.localize(`CAMPAIGNRECORD.Hub.Order.${value}`),
        selected: orderMode === value
      }));
```

- [ ] **Step 2: Add the radio group to `header.hbs`**

In `templates/hub/header.hbs`, inside `.hub-settings-panel`, after the snippets toggle button and its following `<hr>` (before the `hub-auto-target` label), add:

```hbs
      <div class="hub-order-group" role="group" aria-label="{{localize "CAMPAIGNRECORD.Hub.OrderBy"}}">
        <span class="hub-order-title">{{localize "CAMPAIGNRECORD.Hub.OrderBy"}}</span>
        {{#each orderOptions}}
        <button type="button" role="menuitemradio" data-action="setTimelineOrder" data-order="{{this.value}}"
                aria-checked="{{#if this.selected}}true{{else}}false{{/if}}">
          <i class="fa-solid {{#if this.selected}}fa-circle-dot{{else}}fa-circle{{/if}}"></i>
          {{this.label}}
        </button>
        {{/each}}
      </div>
      <hr>
```

- [ ] **Step 3: Add the action handler**

In `scripts/apps/hub/hub-mixin.mjs`, add a handler near `#onToggleSnippets`:

```js
    static async #onSetTimelineOrder(event, target) {
      const order = target.dataset.order;
      if (!["manual", "created", "campaign"].includes(order)) return;
      // The setting's onChange re-renders header + timeline for every open hub.
      await game.settings.set(MODULE_ID, TIMELINE_ORDER_SETTING, order);
    }
```

- [ ] **Step 4: Register the action**

In `DEFAULT_OPTIONS` `actions`, add:

```js
        setTimelineOrder: HubBase.#onSetTimelineOrder,
```

- [ ] **Step 5: Add localization keys**

In `lang/en.json`, inside `CAMPAIGNRECORD.Hub`, add:

```json
      "OrderBy": "Timeline order",
      "Order": { "manual": "Manual", "created": "Create date", "campaign": "Campaign date" },
```

- [ ] **Step 6: Style the group**

In `styles/campaign-record.css`, add near the other settings-panel rules (search for `.hub-settings-panel` and add after it; if none, append at end of file):

```css
.campaign-hub .hub-order-group {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.campaign-hub .hub-order-group .hub-order-title {
  font-size: var(--font-size-11, 11px);
  opacity: 0.7;
  padding: 0 0.25rem;
}
```

- [ ] **Step 7: Verify unit suite + JSON validity**

Run: `npx vitest run && node -e "JSON.parse(require('fs').readFileSync('lang/en.json','utf8')); console.log('lang ok')"`
Expected: vitest PASS; prints `lang ok`.

- [ ] **Step 8: Commit**

```bash
git add templates/hub/header.hbs scripts/apps/hub/hub-mixin.mjs lang/en.json styles/campaign-record.css
git commit -m "feat: timeline order toggle in hub settings menu"
```

---

### Task 10: End-to-end coverage

**Files:**
- Modify: `tests/e2e/08-hub-timeline.spec.mjs` (add cases; follow the file's existing helper/import patterns)

**Interfaces:**
- Consumes: `addTimepoint`, `editTimepoint`, `getTimepoints` from the module (imported inside `page.evaluate` as the existing cases do); the hub UI (gear menu, timeline part).

> **Before running e2e:** read the `foundry-e2e` skill (session locking, symlink ownership, unlock). Follow it for every server start / e2e run.

- [ ] **Step 1: Add an e2e case — campaign date persists and displays**

Add a Playwright test to `tests/e2e/08-hub-timeline.spec.mjs` that:
1. Creates a group and a timepoint (via the existing evaluate-import pattern already used in this file).
2. In `page.evaluate`, imports `editTimepoint`/`getTimepoints` and sets a campaign date `{ year: 1492, month: 6, day: 15, hour: 14, minute: 30 }`, then asserts `getTimepoints(group).find(...)` round-trips it.
3. Switches the client setting to campaign order: `await game.settings.set("campaign-record", "timelineOrder", "campaign")`.
4. Opens/re-renders the hub and asserts a `.timepoint-date` element is visible and its text contains `1492` and `15`.

```js
  test("stores a campaign date and shows it in the date column", async ({ page }) => {
    // ... create group + timepoint using this file's existing helpers ...
    const groupId = /* group id from setup */;
    const tpId = await page.evaluate(async (gid) => {
      const { addTimepoint, editTimepoint, getTimepoints } =
        await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = game.journal.get(gid);
      const tp = await addTimepoint(group, "Dated point");
      await editTimepoint(group, tp.id, {
        campaignDate: { year: 1492, month: 6, day: 15, hour: 14, minute: 30 }
      });
      const stored = getTimepoints(group).find((t) => t.id === tp.id);
      if (stored.campaignDate.day !== 15) throw new Error("campaign date not stored");
      await game.settings.set("campaign-record", "timelineOrder", "campaign");
      return tp.id;
    }, groupId);

    // re-open/refresh the hub per this file's pattern, then:
    const dateText = await page.locator(`.timepoint[data-timepoint-id="${tpId}"] .timepoint-date`).innerText();
    expect(dateText).toContain("1492");
    expect(dateText).toContain("15");
  });
```

- [ ] **Step 2: Add an e2e case — order toggle shows/hides the date column**

```js
  test("order toggle shows the date column outside manual mode and hides it in manual", async ({ page }) => {
    // ... open hub on a group with >=1 timepoint ...
    await page.evaluate(() => game.settings.set("campaign-record", "timelineOrder", "manual"));
    // refresh hub per file pattern
    expect(await page.locator(".timepoints .timepoint-date").count()).toBe(0);
    expect(await page.locator(".timepoints.with-dates").count()).toBe(0);

    await page.evaluate(() => game.settings.set("campaign-record", "timelineOrder", "created"));
    // refresh hub per file pattern
    expect(await page.locator(".timepoints.with-dates").count()).toBeGreaterThan(0);
    expect(await page.locator(".timepoints .timepoint-date").count()).toBeGreaterThan(0);
  });
```

- [ ] **Step 3: Run the affected e2e spec (per foundry-e2e skill)**

Run (following the foundry-e2e locking protocol): `npm run test:e2e -- 08-hub-timeline`
Expected: PASS, including the two new cases. If the hub-refresh mechanics differ, align with how the other cases in this file re-render (they already open the group sheet / re-render the hub).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/08-hub-timeline.spec.mjs
git commit -m "test: e2e for campaign date display and order toggle"
```

---

## Final verification

- [ ] Run the full unit suite: `npx vitest run` → all green.
- [ ] Validate lang JSON: `node -e "JSON.parse(require('fs').readFileSync('lang/en.json','utf8'))"`.
- [ ] Run the timeline e2e (per foundry-e2e skill): `npm run test:e2e -- 08-hub-timeline`.
- [ ] Manual smoke in Foundry: add a timepoint with a campaign date; toggle Manual → Create → Campaign; confirm the date column + continuous divider appear in date modes and vanish in manual; confirm drag works only in manual mode; confirm undated timepoints float to the top in campaign mode.

## Notes / deviations from the spec

- **Display formatting** uses the pure `formatComponentsFallback` (`"<MonthName> <day>, <year>"` + optional `HH:MM`) rather than `calendar.format()`. This avoids the day-of-year / yearZero conversion pitfalls of the core formatter, works identically on and off dnd5e, and is fully unit-testable. Month names still come from the live calendar.
- **Invalid campaign date on submit** shows a warning and cancels the whole modal (label edit included). Simple and safe for v1; a keep-open-on-error flow can come later if desired.
- `getTimepoints` is deliberately left as canonical manual order; only `#timelineGroups` reorders for display.
