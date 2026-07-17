# New-Creation Defaults: Alphabetized Entry Types & World-Time Timepoints

**Date:** 2026-07-17
**Status:** Approved

## Overview

Two small usability fixes to the Campaign Hub's creation dialogs:

1. **New Record dialog** — the entry type list is alphabetized by localized
   label, and the default selection is the core "Journal Page" type.
2. **Add Timepoint dialog** — the campaign date fields (year, month, day,
   HH:MM) are prefilled from the current world time when a calendar is
   available.

## Current Behavior

- `#onNewRecord` (`scripts/apps/hub/hub-mixin.mjs`) renders type options in
  `RECORD_TYPES` declaration order (npc, place, quest, pc, item, encounter,
  checklist, shop, loot, media) with "Journal Page" (`value: "text"`)
  appended last. The browser defaults the select to the first option (NPC).
- `#onAddTimepoint` calls `#promptTimepoint({})`, so the campaign date
  fieldset renders with all fields blank even though Foundry v13 exposes the
  current world clock via `game.time.calendar.timeToComponents(game.time.worldTime)`.

## Design

### Fix 1 — New Record type list

Add a pure helper to `scripts/logic/new-record-form.mjs`, alongside the
existing `buildNewRecordGroupField`:

```
buildNewRecordTypeOptions(localize) →
  [{ value, label, selected }]
```

- Builds entries for all `RECORD_TYPES` (value `typeId(t)`, label
  `localize("TYPES.JournalEntryPage." + typeId(t))`) plus the core text page
  (value `"text"`, label `localize("CAMPAIGNRECORD.Hub.JournalPage")`).
- Sorts alphabetically by label using `localeCompare` — the Journal Page
  option is alphabetized into the list like any other type, not pinned.
- Marks the `"text"` option `selected: true`; all others `false`.
- Takes the localizer as a parameter so the helper stays pure and unit-testable
  without a Foundry global.

`#onNewRecord` renders its `<select name="type">` from this list (emitting
`selected` on the flagged option) instead of mapping `RECORD_TYPES` inline.
Opening the dialog and typing only a name now creates a plain journal page.

### Fix 2 — Add Timepoint campaign date

Add to `scripts/logic/campaign-calendar.mjs`:

```
currentWorldComponents() → { year, month, day, hour, minute } | null
```

- Returns the components of `game.time.worldTime` via the active calendar's
  `timeToComponents`; returns `null` when no calendar is available (pre-v13
  cores or worlds without one), matching the existing `hasCalendar()` guard
  style.

`#onAddTimepoint` passes the result as `initial.campaignDate` to
`#promptTimepoint`, whose existing rendering already fills year, month, day,
and HH:MM from `initial.campaignDate` — no dialog changes needed.

Scope guards:

- **Edit Timepoint is untouched.** It continues to show the stored date, or
  blank fields when the timepoint has no date; world time never overwrites an
  edit.
- All fields remain editable and clearable before saving.
- With no calendar, the Add dialog behaves exactly as today (notice text, no
  date fields).

## Testing

Unit tests in the existing vitest suites:

- `buildNewRecordTypeOptions`: options are in alphabetical label order; the
  text option is present and the only one selected; all ten record types are
  included.
- `currentWorldComponents`: maps calendar components through correctly; returns
  `null` when no calendar is active.

Full `npm test` run must stay green.

## Out of Scope

- Remembering the last-used type per user.
- Any change to timepoint sorting or the timeline order setting.
