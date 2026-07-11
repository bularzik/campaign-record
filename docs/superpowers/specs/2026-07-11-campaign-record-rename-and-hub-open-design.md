# Campaign Record rename + group double-click opens the hub

**Date:** 2026-07-11
**Branch:** `feature/campaign-record-rename-and-hub-open` (isolated git worktree under `.claude/worktrees/rename-campaign-record`)
**Status:** Approved design — ready for implementation plan

## Summary

Two deliverables in one branch:

1. **Terminology rename (user-facing text only).** Rename the container concept **"Campaign Group" → "Campaign Record"**, and — because the module already calls the typed pages "records" — rename the page-sense term **"record(s)" → "entry/entries"** so the two never collide. A Campaign Record contains entries.
2. **Double-click fix.** Activating a Campaign Record in the Journal sidebar must **deterministically open it in the hub** (`GroupHubSheet`), never fall back to the core journal editor.

## Decisions (locked with the user)

- **Rename depth: user-facing text only.** Change i18n **values** in `lang/en.json`, the `module.json` description, and `README.md`. Do **not** rename code identifiers, filenames, CSS classes, i18n **keys**, or the stored `flags.campaign-record.group` flag.
- **No data migration.** Because no stored keys/flags change, existing worlds need no migration.
- **Page term = "entry/entries."**
- Work happens in a **separate feature branch inside a separate git worktree**.

### Why this is low-risk

- Changing i18n **values** (not keys) keeps `tests/i18n-coverage.test.js` green.
- The e2e suite creates groups programmatically (`createGroup()` imported directly) and locates elements by CSS class / data attributes (`.group-hub`, `.record-row`), **not** by the renamed labels — so the rename does not break existing tests.

---

## Part A — Terminology rename

### A1. `lang/en.json` (values only; keys unchanged)

**Group → Campaign Record**

| Key | New value |
|-----|-----------|
| `CAMPAIGNRECORD.CreateGroup` | `Create Campaign Record` |
| `CAMPAIGNRECORD.GroupName` | `Campaign Record Name` |
| `CAMPAIGNRECORD.Hub.GroupPicker` | `Campaign Record` |
| `CAMPAIGNRECORD.Hub.AllGroups` | `All Campaign Records` |
| `CAMPAIGNRECORD.Hub.NoGroups` | `Create a Campaign Record first.` |
| `CAMPAIGNRECORD.Hub.WrongGroup` | `Entries can only attach to timepoints in their own Campaign Record.` |
| `CAMPAIGNRECORD.Hub.CannotEditTimeline` | `You lack permission to edit this Campaign Record's timeline.` |
| `CAMPAIGNRECORD.Import.NewGroup` | `New Campaign Record…` |
| `CAMPAIGNRECORD.Import.GroupName` | `Campaign Record name` |
| `CAMPAIGNRECORD.Export.GroupButton` | `Export Campaign Record` |
| `CAMPAIGNRECORD.Export.SelectGroup` | `Select a specific Campaign Record to export.` |
| `CAMPAIGNRECORD.Sheets.GroupHub` | `Campaign Hub (Campaign Record Sheet)` |
| `CAMPAIGNRECORD.Warning.CreateGroupFailed` | `Failed to create the Campaign Record. See the console for details.` |

**Record(s) → entry/entries** (page sense)

| Key | New value |
|-----|-----------|
| `CAMPAIGNRECORD.Hub.NewRecord` | `New Entry` |
| `CAMPAIGNRECORD.Hub.NoRecords` | `No entries match the current filters.` |
| `CAMPAIGNRECORD.Hub.HiddenOnly` | `Show hidden entries only` |
| `CAMPAIGNRECORD.Hub.SearchPlaceholder` | `Search all entries…` |
| `CAMPAIGNRECORD.Hub.NoResults` | `No entries match.` |
| `CAMPAIGNRECORD.Hub.EditRecord` | `Edit entry` |
| `CAMPAIGNRECORD.Hub.RecordUnavailable` | `That entry can no longer be displayed.` |
| `CAMPAIGNRECORD.Hub.DeleteTimepointConfirmNamed` | `Delete the timepoint "{label}"? Attached entries stay; only the timepoint is removed.` |
| `CAMPAIGNRECORD.Export.IncludeGM` | `Include GM content (hidden entries, GM notes)` |
| `CAMPAIGNRECORD.Export.HiddenRecord` | `This entry is hidden — check "Include GM content" to export it.` |
| `CAMPAIGNRECORD.Import.Created` | `Imported {pages} entries and {timepoints} timepoints into "{group}".` |
| `CAMPAIGNRECORD.Settings.InlineEditing.Hint` | `Edit entries directly while viewing them; changes save automatically. Turn off for read-only views.` |
| `CAMPAIGNRECORD.Warning.HiddenGMOnly` | `Only a Gamemaster can hide or reveal entries.` |
| `CAMPAIGNRECORD.Warning.SchemaNewer` | `…Entries are read-only until you update the module.` (rest of string unchanged) |
| `CAMPAIGNRECORD.Presenter.NoImages` | `This media entry has no images to present.` |

> Note: the `{pages}` / `{group}` **placeholder names** in `Import.Created` stay as-is (they are code-facing format args, not user-visible); only the surrounding words change.

### A2. Deliberate boundaries — intentionally **unchanged**

- `CAMPAIGNRECORD.RecordsFolder` = **"Campaign Records"** — stays. It names the Journal folder that *contains* the Campaign Records, so it now reads correctly.
- `CAMPAIGNRECORD.Sheets.Npc … Media` (e.g. "Campaign Record NPC Sheet") — **stay**. Here "Campaign Record" is the **module** name labeling a page's sheet in Foundry's Sheet-Config dialog, not the container concept. Renaming would read as "Campaign Record NPC Entry Sheet" (awkward) and these are low-visibility config labels.
- `TYPES.JournalEntryPage.*` (NPC, Place, Quest, …) — unchanged.
- All other keys whose values contain no group/record wording — unchanged.

### A3. `module.json`

- **description**: `"…shared typed records (NPCs, places, quests, and more) organized into groups, with an index…"` → `"…shared typed entries (NPCs, places, quests, and more) organized into Campaign Records, with an index…"`.
- **title** stays `"Campaign Record"`. **id** stays `campaign-record`.

### A4. `README.md`

Prose pass:
- "campaign group(s)" / "Create Campaign Group" / "Groups" (the container) → Campaign Record(s) / Create Campaign Record.
- Page-sense "record(s)" and "record types" → entry/entries and "entry types".
- Leave the module name "Campaign Record", repo URLs, and the migration batch names ("Campaign Record: Core/Hub/Types") unchanged.

### A5. Out of scope (explicitly not touched)

- Code identifiers (`createGroup`, `GroupHubSheet`, `isGroup`, `groupId`, …), filenames (`groups.mjs`, `group-hub-sheet.mjs`, …), CSS classes (`.record-group`, `.record-row`, `.timeline-group`), i18n **keys**.
- The stored `flags.campaign-record.group` flag and `flags.core.sheetClass` values.
- Historical `docs/superpowers/specs/*` and `docs/superpowers/plans/*`.
- Code comments (not user-facing).

### A6. Straggler sweep

Grep `scripts/` and `templates/` for any **hardcoded** user-facing "group"/"record" text (initial scan found none — all UI text is i18n-driven). Convert any found; leave comments and code identifiers alone.

---

## Part B — Double-click opens the Campaign Record in the hub

### B1. Current behavior

- Foundry's sidebar entry activation (`DocumentDirectory._onClickEntry`) calls `document.sheet.render(true)`.
- A Campaign Record's `sheet` resolves to `GroupHubSheet` via `flags.core.sheetClass = "campaign-record.GroupHubSheet"`, which is set on creation (`createGroup`) and back-filled by the schema **v2** migration.
- e2e **test 22** confirms the `sheet` **getter** resolves to `GroupHubSheet` — **but it never simulates the real sidebar activation**, which is exactly the reported gap. If a Campaign Record lacks the `sheetClass` flag (worlds migrated before the v2 step existed, or entries not created through `createGroup`), activation falls back to the **core `JournalEntrySheet`** — the "regular journal editor" the user sees.

### B2. Approach (reproduce-first, then deterministic interception)

1. **Reproduce** with systematic-debugging on the Foundry test world (World B) to capture the exact failing path and confirm the missing-flag hypothesis (or reveal the true cause).
2. **Fix:** in the existing `renderJournalDirectory` hook (`scripts/hooks/directory.mjs` or `hub-ui.mjs`), add a **capture-phase click handler** on the directory that, when the activated row is `isGroup(entry)`, opens that entry's hub (`GroupHubSheet`) and **stops the default action** (`stopImmediatePropagation` / `preventDefault`). This makes activation **deterministic regardless of world-flag state** — it can never fall through to the journal editor.
   - `GroupHubSheet` **remains** the registered sheet resolved by `flags.core.sheetClass`, so `@UUID` content-links and any other `entry.sheet` callers still land in the hub. The interceptor is the guarantee for the sidebar path specifically.
   - The interceptor renders the **scoped** hub (the group's own `GroupHubSheet`, `showsGroupPicker === false`) — same surface as today's intended behavior.
   - **Alternative considered & rejected:** only re-assert the flag / rely on migration. Weaker — players cannot write document flags, and it stays coupled to migration timing.

### B3. Tests

Add e2e coverage that drives the **real** sidebar activation (not the getter):

- **Flagged Campaign Record:** click the sidebar row → `.group-hub` renders, scoped (no `select[name="group-select"]`), showing its entries.
- **Legacy-shaped Campaign Record:** an entry whose `flags.core.sheetClass` is deliberately unset → sidebar activation **still** opens `.group-hub` (locks in the robustness of the interception).
- Confirm the core `JournalEntrySheet` does **not** open for a Campaign Record row.

---

## Verification / definition of done

- `lang/en.json`, `module.json`, `README.md` reflect the rename; no i18n **keys** changed.
- Double-click / sidebar activation of any Campaign Record opens the scoped hub; new e2e tests (flagged + legacy-shaped) pass.
- Full unit suite (`vitest`) and the e2e suite are green (including the existing i18n-coverage and test 22).
- All work committed on `feature/campaign-record-rename-and-hub-open` in the worktree.
