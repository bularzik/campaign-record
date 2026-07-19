# Fix: Stale Group Sheet-Class Flag + Duplicate Name Editors — Design

**Date:** 2026-07-19
**Status:** Approved

## Problem

Two regressions reported after installing the unreleased build (main `c77ef3b`):

1. **Inline editing ignored.** With the "toggle inline editing" setting ON, entries in
   some groups render read-only and require the manual edit toggle (pencil). Root
   cause: groups created before v1.1.0 carry
   `flags.core.sheetClass = "campaign-record.CampaignGroupSheet"`. v1.1.0 renamed the
   sheet to `GroupHubSheet`, and the schema-v2 migration skips any group whose flag is
   already set (`scripts/data/migration-runner.mjs:35`), so old groups were never
   updated. Every `inGroup` check (`computeInlineEdit`, `isInlineEditableView`,
   `RecordPane`'s `TextPageSheet` selection) compares against the new name and fails.
   Side effect: those group journals also open with the system default journal sheet
   (verified live: `JournalEntrySheet5e`) instead of the hub, because the stale class
   name is not a registered sheet.

2. **Duplicate name editors in pane edit mode.** Since PR #32 the pane title bar
   becomes a name `<input>` in edit mode (`isNameEditable` is true whenever
   `editing`). The embedded edit form additionally inherits Foundry core's
   `EDIT_PARTS.header` (`templates/journal/parts/page-header.hbs`), which renders
   core's own page-name input plus a heading-level select. Every record sheet spreads
   `...super.EDIT_PARTS`, and `TextPageSheet` extends `BaseRecordSheet`, so nearly all
   entry edit forms show two name editors.

## Decisions (user-approved 2026-07-19)

- Bug 1: fix the data with a **schema v6 migration**, not by accepting both class
  names at check sites.
- Bug 2: the **title-bar input** is the single name editor in pane edit mode; core's
  header part is dropped from pane-embedded edit forms.

## Fix 1: Schema v6 migration

- `scripts/constants.mjs`: `SCHEMA_VERSION` 5 → 6.
- `scripts/data/migration-runner.mjs`: append a `version: 6` entry to `MIGRATIONS`.
  It iterates the same group set migration v2 iterates (journals with the module's
  `GROUP_FLAG`) and, for each with
  `flags.core.sheetClass === "campaign-record.CampaignGroupSheet"`, updates it to
  `GROUP_SHEET_CLASS`. Groups with the correct flag, a foreign flag value, or no flag
  are untouched (v2 already fills missing flags).
- The legacy string `"campaign-record.CampaignGroupSheet"` appears nowhere in code
  except this migration (as a local constant inside it).
- Decision logic is a pure function in `scripts/logic/` (no Foundry globals):
  given a flag value, return whether it must be rewritten — unit-testable.

**Effects:** pre-v1.1.0 groups honor the inline-editing setting again, and open with
the hub sheet (`GroupHubSheet`) instead of the system journal sheet.

## Fix 2: Single name editor in pane edit mode

- `scripts/sheets/base-record-sheet.mjs`: when the sheet is pane-embedded — detected
  by `this.options.window.frame === false`, which `RecordPane` already sets — remove
  the inherited `header` part from the parts rendered in edit mode (via
  `_configureRenderParts` or the equivalent v13 AppV2 hook). View mode has no header
  part concern; only `EDIT_PARTS` carry it.
- The pane title-bar input (PR #32) is then the only name editor in pane edit mode,
  matching where the name is edited in inline view mode.
- Framed/standalone page sheets (e.g. a record page added to an ordinary, non-hub
  journal, opened through core's journal UI) are unaffected and keep core's name
  field — they have no pane title bar.
- `TextPageSheet` extends `BaseRecordSheet`, so pane-mounted text pages get the same
  single-editor behavior.
- **Accepted trade-off:** core's heading-level select, "Show Title" checkbox, and
  journal-category select (all part of the same header part) disappear from pane
  edit forms. They only affect core journal TOC/heading display and categories,
  which the hub does not use; core's UI still offers them for pages in ordinary
  journals.

## Not in scope

- Gating the #36 title-bar image/tag controls on the inline-editing setting (they
  remain permission-gated only, per the approved #36 design).
- Any change to `shouldShowEditToggle` / `isNameEditable` semantics.
- Deduplicating the tag-popover markup (deferred minor from #36 review).

## Testing

Per the test-tier policy (2026-07-18): smoke + affected specs only during
development; the full suite runs at the next publish gate.

- **Unit (vitest):**
  - Pure flag-rewrite decision function: legacy string → rewrite; current string,
    unrelated string, `undefined` → no rewrite.
  - Migration-runner test for v6 mirroring the existing v2–v5 tests (stale-flag
    group is updated; correct-flag and foreign-flag groups untouched; setting
    advances to 6).
  - Part-config logic: if extracted as a pure function, cover frameless-drop vs
    framed-keep; otherwise covered by e2e only.
- **E2E (affected specs):**
  - Migration coverage: create a group with the legacy flag value, trigger
    migration, assert the flag is rewritten and an inline-editable record in it
    shows always-open editors with no edit toggle.
  - Edit-mode coverage: in an existing edit-mode spec, assert exactly one visible
    name input while editing (the pane title input) and that renaming through it
    still persists.
  - `npm run e2e:smoke` green.
- **Manual checklist** (`docs/manual-test-checklist.md`): one line — a pre-v1.1.0
  group opens as the hub and inline-edits after migration.

## Release note obligation

The next release's changelog must note schema v6 (in addition to the pending v5
note): worlds migrated to v6 are treated as read-only by older module versions.
