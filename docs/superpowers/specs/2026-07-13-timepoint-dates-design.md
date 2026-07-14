# Timepoint create & campaign dates — design

**Date:** 2026-07-13
**Status:** Approved (design), pending implementation plan

## Summary

Add two dates to timeline timepoints:

- **Create date** — a real-world timestamp set automatically when a timepoint is created; not user-editable.
- **Campaign date** — an in-world date the user sets and modifies in the timepoint modal, expressed in whatever calendar the world's dnd5e (or core Foundry v13) configuration provides.

The timeline gains a per-user **order mode** (Manual / Create date / Campaign date) chosen from the hub settings menu, and a redesigned row layout that shows the relevant date to the left of the timepoint name, separated by a continuous vertical divider.

## Context (current state)

- Timepoints are stored as an array in a group journal's flag (`GROUP_FLAG`), each `{ id, label, sort, links }` — see `scripts/data/timepoints.mjs`.
- Ordering today is **manual drag-and-drop** via fractional `sort` keys (`scripts/logic/timeline-sort.mjs`, `sortKeyBetween` / `sortTimepoints`).
- The timeline renders in `templates/hub/timeline.hbs`; each `<li class="timepoint">` stacks `.timepoint-head` (label + edit buttons) over `.timepoint-records` (link chips).
- Add/Rename use `DialogV2.prompt` with a single label input (`hub-mixin.mjs` `#promptLabel`, `#onAddTimepoint`, `#onRenameTimepoint`).
- The gear **settings menu** lives in `templates/hub/header.hbs`; existing toggles (inline-edit, snippets, auto-target) are wired through `hub-mixin.mjs` and module settings.
- dnd5e integration degrades gracefully off-5e (`scripts/integrations/dnd5e.mjs`). No calendar code exists yet.

### Calendar API facts (Foundry v13 / dnd5e 5.x, confirmed from shipped source)

- `game.time.calendar` is a `CalendarData` instance, **always non-null** in v13 (defaults to Simplified Gregorian). Feature-detect v13+ with `typeof game.time.calendar?.timeToComponents === "function"`.
- Month list: `calendar.months.values` → `{ name (i18n key), abbreviation, ordinal (1-based), days }`; the array index is the **0-based** `month` used in components.
- Components shape: `{ year, month (0-based), day (0-based day-of-year), dayOfMonth (0-based), hour, minute, second, ... }`. Displayed year = `year + calendar.years.yearZero`.
- `calendar.timeToComponents(seconds)` / `calendar.componentsToTime(components)` convert; `componentsToTime` reads `day` as **day-of-year**, not day-of-month.
- `calendar.format(timeOrComponents, formatterKey)` formats a date; core ships `"timestamp"` and `"ago"`; dnd5e adds `"monthDay"`, `"monthDayYear"`, etc.
- dnd5e registers its calendar on `init` from world setting `game.settings.get("dnd5e", "calendar")` (default `"gregorian"`; also ships greyhawk / harptos / khorvaire). `CalendarData5e#jumpToDate` exists but **advances the world clock** — not used here.

**This feature never mutates `game.time`.** The calendar is used only to interpret and format per-timepoint metadata.

## Data model

Extend the timepoint object in `scripts/data/timepoints.mjs`:

```js
{
  id, label, sort, links,   // existing
  createdAt,                // NEW — epoch ms (Date.now()) set once at creation
  campaignDate              // NEW — null, or calendar components (see below)
}
```

`campaignDate` is either `null` (unset) or:

```js
{
  year,          // visible year (yearZero already applied), integer, may be negative
  month,         // 0-based index into calendar.months.values
  day,           // 1-based day of month
  hour,          // optional integer, null when time not set
  minute         // optional integer, null when time not set
}
```

**Storage rationale:** components (not raw world-seconds) survive calendar reconfiguration and repopulate the edit form directly. Ordering derives a comparable key from the components; display formats them through the live calendar.

**Known limitation (documented):** switching the world's calendar after dates are entered re-interprets stored month indices under the new calendar — numeric slots persist, month *names* change. Acceptable since calendar changes are rare.

## Calendar wrapper — new `scripts/logic/campaign-calendar.mjs`

A thin, feature-detected wrapper so the rest of the code never reaches into `game.time` directly:

- `hasCalendar()` → `!!game.time?.calendar && typeof game.time.calendar.timeToComponents === "function"`.
- `getCalendarMonths()` → `[{ index, name }]` from `calendar.months.values` with localized names; `[]` when no calendar. Drives the month `<select>`.
- `calendarBounds()` → `{ hoursPerDay, minutesPerHour }` from `calendar.days` (for time validation), with sane defaults (24/60).
- `formatCampaignDate(components)` → localized string via `calendar.format()` — prefer `"monthDayYear"` when available (dnd5e), else core `"timestamp"`, else a hand-built `"<MonthName> <day>, <year>"`. Append ` HH:MM` when `hour`/`minute` are set. Returns `""` for `null`.
- `campaignSortKey(components)` → monotonic number: `((((year * 100) + month) * 100) + day) * 10000 + ((hour ?? 0) * 100 + (minute ?? 0))`. Month < 100, day < 100, hour < 100, minute < 100 hold for every shipped calendar, so the key is order-preserving without calendar month-length math. `null` → treated as "no key" by the sorter (see ordering).

Off-v13 / no calendar: campaign-date entry is hidden or disabled with a hint; existing data is untouched; created/manual order modes still work.

## Ordering — `scripts/logic/timeline-sort.mjs`

`sortTimepoints(timepoints, mode)` gains a `mode` argument (`"manual" | "created" | "campaign"`, default `"manual"` to preserve current behavior):

- **manual** — existing fractional `sort` key, ties by label. Drag/insert active.
- **created** — ascending `createdAt`; ties broken by `sort` key (keeps the migration-backfilled batch and same-ms creates in their curated order).
- **campaign** — ascending `campaignSortKey`; **timepoints with no campaign date rise to the top**, ordered among themselves by `createdAt`. (Dated timepoints follow, ascending by campaign date.)

The order mode is read from a **per-user client setting** `timelineOrder` (see settings). It is hub-wide (applies to every group), not stored per group.

## Timepoint editor modal — `hub-mixin.mjs`

`#promptLabel` becomes `#promptTimepoint(initial)`, used by both **Add** and **Edit** (the "Rename" action becomes "Edit timepoint"):

Fields:
- **Label** — required text (unchanged behavior).
- **Campaign date** (all optional, as a group; blank = unset):
  - **Year** — number input.
  - **Month** — `<select>` from `getCalendarMonths()`.
  - **Day** — number input.
  - **Time** — optional `HH:MM` text input.

Validation: day within the selected month's length; time within `calendarBounds()`. If the date fields are partially filled, either require the y/m/d trio or treat as unset (implementation plan to specify exact rule — default: y+m+d all required together, time optional). When `hasCalendar()` is false, the campaign-date fields are omitted and a short hint explains the calendar is unavailable.

New exported data function: `editTimepoint(group, id, { label, campaignDate })` (generalizes the existing private `updateTimepoint`). `renameTimepoint` is superseded by `editTimepoint` (or kept as a thin wrapper).

`addTimepoint(group, label, position, campaignDate = null)` also stamps `createdAt = Date.now()`.

## Settings-menu toggle — `templates/hub/header.hbs`

Add a labelled group of three `menuitemradio` entries to the gear popup: **Manual · Create date · Campaign date**, reflecting the `timelineOrder` client setting. Selecting one writes the setting and re-renders the timeline part only (`this.render({ parts: ["timeline"] })` or equivalent). A new client setting `timelineOrder` is registered (scope `client`, `config: false`, default `"manual"`).

## Timeline display — `templates/hub/timeline.hbs` + CSS

Each row becomes a horizontal two-column layout:

```
[ date column ]  │  [ name + edit buttons + record chips ]
```

- **Date column** (left): right-justified. Shows the **create date** in created mode (localized short date from `createdAt`), the **campaign date** in campaign mode (`formatCampaignDate`), and is **hidden** in manual mode.
- **Divider**: a single continuous vertical line down the pane between the two columns (not per-row segments — implemented so it reads as one straight rule). Hidden in manual mode.
- **Right column**: timepoint name, edit/delete buttons, and link chips (today's `.timepoint-head` + `.timepoint-records` content).
- **Manual mode**: no date column, no divider — names only, exactly as today.
- Drag handles and the per-row "insert before" (up-arrow) button render **only in manual mode**; in date modes only the bottom "Add timepoint" button remains (new timepoints append with `createdAt = now`, campaign date set afterward via Edit).

`#timelineGroups()` in `hub-mixin.mjs` passes the current `timelineOrder`, per-timepoint formatted date strings, and a `showDateColumn` flag to the template; drag/drop wiring is gated on manual mode.

## Migration — `scripts/data/migration-runner.mjs`

Add a migration step that backfills every existing timepoint with `createdAt = <migration timestamp>` and leaves `campaignDate = null`. True original creation time is unrecoverable; Manual mode preserves the existing curated order regardless, and Created-mode ties fall back to the `sort` key so the backfilled batch keeps today's order.

## Testing

**Unit (vitest):**
- `campaignSortKey` produces order-preserving keys across year/month/day/time boundaries.
- `sortTimepoints` in each mode: manual unchanged; created orders by `createdAt` with `sort`-key tiebreak; campaign puts undated first (by `createdAt`) then dated ascending.
- `campaign-calendar` wrapper: `hasCalendar` detection, month list localization, `formatCampaignDate` with/without time and with no calendar, bounds defaults.
- Migration backfill stamps `createdAt`, leaves `campaignDate` null, is idempotent.

**E2E (Playwright):**
- Add a timepoint, open Edit, set a campaign date (year/month/day + time), confirm it persists and displays.
- Switch order mode Manual → Create → Campaign via the settings menu; verify row order and that the date column + divider show in date modes and hide in manual.

## Out of scope

- Editing/creating the world calendar itself (owned by core/dnd5e).
- Any change to `game.time.worldTime` or the world clock.
- Per-group order overrides (order mode is hub-wide, per-user).
