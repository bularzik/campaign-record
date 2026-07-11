# DOCX Import Wizard cleanup — Design

**Date:** 2026-07-11
**Branch:** `feature/docx-import-cleanup`
**Status:** Approved (design), pending implementation plan

## Problem

The DOCX Import Wizard (`ImportWizard`, a two-step Foundry `ApplicationV2` dialog) has three UX problems raised during review:

1. **Redundant sources.** The source step shows two separate file-pick fields — "Local .docx" and "Google Docs" — but both call the identical `parseDocx` (mammoth) function. The "Google Docs" path just tells you to download a `.docx` from Google and pick it. There is no real API/OAuth integration, so the two fields are functionally identical and confusing.

2. **Unclear how to proceed / cancel.** The review step has an "Import" button and a "Back" button, but the **source step has no button at all** — selecting a file silently auto-advances, and mammoth parsing happens with no feedback (dead air, then a jump). There is **no Cancel** anywhere (only the window ✕).

3. **Can't change how the doc is broken up.** The review table lets you edit each detected section's title, type, and timepoint, and the Type dropdown hides "Merge into previous" and "Skip" options. But you **cannot split** a section the parser lumped together, and the merge capability is buried in a dropdown labeled "Type," so it doesn't read as a split control. Net effect: a validation UI that appears to offer no control over the split.

## Current architecture (for reference)

- **`scripts/apps/import-wizard.mjs`** — `ImportWizard` class; `state.step` is `"source"` or `"review"`; wires file-input `change` → `#onFileChosen` (auto-advance), and review actions `backToSource` / `createImport`.
- **`templates/import/wizard.hbs`** — renders one `<fieldset>` per source (step 1) and the section table + target-group selector + footer buttons (step 2).
- **`scripts/integrations/doc-sources.mjs`** — `DOC_SOURCES` registry with `docx-file` and `google-docs`, both `parse: parseDocx`. `parseDocx` lazy-loads `vendor/mammoth.browser.min.js` and returns `{ html, messages }`.
- **`scripts/logic/doc-import.mjs`** — pure logic: `splitSections(root)` splits on headings (h1–h3) and detected session-header paragraphs; `suggestType`, `parseSectionDate`, `buildImportPlan(sections, rows, recordTypes)` (honors skip/merge, strips round-trip markers).
- **`lang/en.json`** — import strings (`~84–113`).

## Goals

- One file source in the UI; keep the source-registry so a *real* future Google/OAuth integration is a genuine additional path (not a duplicate).
- Explicit feedback and a Cancel affordance; keep auto-advance on file select.
- Let the user re-cut section boundaries in review: **merge** adjacent sections and **split** an over-large section.

## Non-goals

- Real Google Drive / OAuth integration (registry left extensible; no implementation now).
- Splitting mid-paragraph. Splits happen only at block (top-level element) boundaries mammoth produced.
- Changing the export side (`doc-export.mjs`) or the round-trip marker format.
- Reworking timepoint/type detection heuristics beyond re-running them on split/merge results.

## Design

### 1. One file source (point 1)

`DOC_SOURCES` collapses to a single `docx-file` entry. The template renders **one** `<input type="file" accept=".docx">` with a hint:

> Exported from Google Docs (File → Download → Microsoft Word), Word, or any .docx.

The registry array and the source-driven rendering stay intact, so a future `google-oauth` source (with a genuinely different `parse`/auth flow) can be added without reintroducing a duplicate file field. The `google-docs` entry and its lang strings are removed; the guidance is folded into the single source's hint.

### 2. Flow, buttons, busy state (point 2)

- Selecting a file still **auto-advances** (chosen behavior).
- On selection, before/while mammoth parses: the file input is **disabled** and a **"Reading document…"** indicator is shown. On success → transition to review. On parse failure → re-enable the input, show the error inline, stay on the source step.
- A **Cancel** button is added to **both** steps (closes the dialog).
- The review step keeps **← Back** and **Import**.
- Rationale for wording: the actual page creation happens on the review step's **Import** button, so the parse phase is labeled **"Reading document…"** to avoid two "Importing" states.

### 3. Block-aware sections (core model change, point 3)

Today a section carries only a joined `html` string, which allows merge (concatenate html) but makes split impossible. Refactor so each section carries an ordered array of blocks:

- `splitSections` attaches **`blocks: string[]`** to each section — the `outerHTML` of each top-level element assigned to that section, in order.
- `html` becomes a derived value: `blocks.join("")`.
- Invariant: **a section is an ordered list of blocks plus metadata** (title, type, date/timepoint, empty flag).
  - **Merge** = concatenate two sections' `blocks`.
  - **Split** = partition one section's `blocks` into two or more contiguous runs.

`buildImportPlan`, `suggestType`, `parseSectionDate`, and marker stripping continue to operate on the joined html, so downstream code is unaffected beyond deriving html from blocks.

New pure helpers in `doc-import.mjs` (unit-tested):

- `mergeSections(sections, index)` → merges `sections[index]` into `sections[index-1]` (blocks concatenated; result keeps the upper section's title/type; re-detect timepoint). Returns a new sections array.
- `splitSectionAt(sections, index, blockCutIndices)` → replaces `sections[index]` with N+1 sections partitioned at the given block indices; each resulting section re-runs title/type/timepoint detection (leading heading → title; keyword → type; date → timepoint). Returns a new sections array.

### 4. Review table — merge & split controls (point 3)

Each section row gains two explicit affordances, replacing the buried dropdown options:

- **Merge up** (icon button) — merges this section into the one above. **Disabled on the first row.** Replaces the "Merge into previous" Type option.
- **Split** (icon button) — opens the split modal. **Disabled when the section has ≤1 block** (nothing to cut).
- **Skip** stays available (kept as a Type-dropdown option for now — out of scope to redesign).

After a merge or split, `state.sections` is mutated via the helpers and `state.rows` is rebuilt from it, then the dialog re-renders.

### 5. Split modal (point 3)

Opened for a single section:

- Shows that section's blocks in order, each rendered as a short text preview (truncated).
- A **"split before this"** divider appears in every gap **between** blocks (not before the first block).
- The user selects **one or more** cut points, then:
  - **Split** → calls `splitSectionAt`, replacing the original section with the resulting N+1 sections in order; new rows appear in the table.
  - **Cancel** → discards, no change.

### 6. Data flow

```
file
  → parseDocx (mammoth → html)         [doc-sources.mjs]
  → DOMParser → body                    [import-wizard.mjs]
  → splitSections (block-aware)         [doc-import.mjs]  → state.sections
  → rows built from sections            [import-wizard.mjs] → state.rows
  → user edits title/type/timepoint,
    merge up, split (modal)             → mutate state.sections, rebuild state.rows, re-render
  → Import → buildImportPlan            [doc-import.mjs]
  → JournalEntryPage creation + timepoints  [import-wizard.mjs]
```

### 7. Error handling & edge cases

- **Parse failure** → re-enable file input, inline error, stay on source step.
- **Merge up on row 0** → control disabled (no previous section).
- **Split on a 1-block section** → control disabled (no internal gap to cut).
- **Round-trip markers** (`Campaign Record type:` paragraphs) travel with their block, so split/merge preserve them; `buildImportPlan` still strips them.
- **Empty sections** after split → still flagged `empty`, same treatment as today.
- **Re-detection on split** → each new section's title/type/timepoint recomputed from its own blocks, so a split that isolates an NPC block correctly re-suggests the npc type.

## Files changed

| File | Change |
|------|--------|
| `scripts/integrations/doc-sources.mjs` | Remove `google-docs`; single `docx-file` source. |
| `scripts/logic/doc-import.mjs` | Block-aware `splitSections`; add `mergeSections`, `splitSectionAt`; derive html from blocks. |
| `scripts/apps/import-wizard.mjs` | Busy "Reading document…" state; Cancel action; merge-up/split actions; split modal wiring; rebuild rows from sections after mutation. |
| `templates/import/wizard.hbs` | Single source field + hint; Cancel buttons; per-row merge-up/split controls; split modal markup. |
| `lang/en.json` | New strings (hint, Reading document…, Cancel, Merge up, Split, modal); remove `google-docs` strings. |

## Testing

- **Unit (vitest)** on `doc-import.mjs` — highest value, pure logic:
  - block-aware `splitSections`: `blocks.join("")` reconstructs the section html; boundaries unchanged vs. current behavior.
  - `mergeSections`: blocks concatenated in order; upper title/type retained; timepoint re-detected.
  - `splitSectionAt`: partitions at given indices; N cut points → N+1 sections; each re-runs detection; markers preserved.
  - `buildImportPlan` still correct against block-derived html.
- **Manual / e2e** for wizard UI (busy state, Cancel on both steps, split modal interaction) — documented as manual steps; Foundry UI e2e is heavier, so logic tests carry the automated coverage.
