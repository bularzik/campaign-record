# DOCX Import Wizard cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three DOCX-import UX problems — collapse the two redundant file sources into one, add explicit busy/Cancel affordances to the wizard flow, and make the review step let the user merge and split how the document is broken up.

**Architecture:** The import feature is a Foundry VTT `ApplicationV2` two-step dialog (`ImportWizard`) backed by pure logic in `scripts/logic/doc-import.mjs`. The core change makes each parsed section carry its ordered list of block HTML strings (`blocks: string[]`), so `html` is derived (`blocks.join("\n")`) and structural edits become array operations: **merge** = concatenate two sections' blocks, **split** = partition one section's blocks. Merge is a per-row button; split opens a `DialogV2` modal. Pure helpers are unit-tested with vitest; UI is verified manually in Foundry plus the existing test suite for no regressions.

**Tech Stack:** Foundry VTT `ApplicationV2` + `HandlebarsApplicationMixin`, Handlebars `.hbs` templates, ESM `.mjs`, `mammoth` (docx→HTML), `DialogV2` for dialogs, `vitest` + `jsdom` for tests.

## Global Constraints

- **Pure logic stays Foundry-free.** `scripts/logic/doc-import.mjs` must not reference `game`, `ui`, `foundry`, or DOM globals beyond nodes passed in by the caller. All new pure helpers go here and are unit-tested.
- **Section invariant:** every section object has `blocks: string[]` and `html === blocks.join("\n")`. All existing section fields stay: `title`, `level`, `isSession`, `date`, `html`, `wordCount`, `empty`.
- **i18n coverage:** every `{{localize "KEY"}}`, `data-tooltip="CAMPAIGNRECORD…"`, `game.i18n.localize/format("KEY")`, and `label: "CAMPAIGNRECORD…"` reference must resolve in `lang/en.json` (enforced by `tests/i18n-coverage.test.js`). Add every new key.
- **Dialog idiom:** use `foundry.applications.api.DialogV2` (see `scripts/apps/create-group-dialog.mjs`); button `label` values are lang keys that Foundry localizes.
- **Test command:** `npx vitest run` (full suite) or `npx vitest run tests/doc-import.test.js` (focused). No build step.
- **Commit** after each task's tests pass.

---

### Task 1: Block-aware `splitSections`

Expose each section's ordered block list so `html` becomes derived. Purely additive — existing `splitSections` behavior is unchanged.

**Files:**
- Modify: `scripts/logic/doc-import.mjs:87-120`
- Test: `tests/doc-import.test.js` (add to the existing `splitSections` area)

**Interfaces:**
- Produces: `splitSections(root)` returns `{ title, sections }` where each section now also has `blocks: string[]`, and a module-private `measureBlocks(blocks) → { html, wordCount, empty }` used by later tasks.

- [ ] **Step 1: Write the failing test**

Add to `tests/doc-import.test.js` (inside the existing `describe("splitSections", …)` block, after the last `it`):

```js
  it("exposes blocks whose join reconstructs the section html", () => {
    const { sections } = splitSections(body(`
      <h2>Bastion</h2>
      <p>Room one.</p>
      <p>Room two.</p>`));
    expect(sections[0].blocks).toEqual(["<p>Room one.</p>", "<p>Room two.</p>"]);
    expect(sections[0].blocks.join("\n")).toBe(sections[0].html);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/doc-import.test.js -t "reconstructs the section html"`
Expected: FAIL — `sections[0].blocks` is `undefined`.

- [ ] **Step 3: Add `measureBlocks` and include `blocks` in output**

In `scripts/logic/doc-import.mjs`, add this helper just above `splitSections` (after the `sectionBoundary` function, around line 81):

```js
function measureBlocks(blocks) {
  const html = blocks.join("\n");
  const text = blocks.join(" ").replace(/<[^>]+>/g, " ");
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return { html, wordCount, empty: blocks.length === 0 };
}
```

Then replace the return block of `splitSections` (lines 111-119) with:

```js
  return {
    title,
    sections: sections.map(({ htmlParts, ...s }) => ({
      ...s,
      blocks: htmlParts,
      ...measureBlocks(htmlParts)
    }))
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/doc-import.test.js`
Expected: PASS — the new test and all existing `splitSections` tests pass (html join uses `"\n"`, identical to before).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/doc-import.mjs tests/doc-import.test.js
git commit -m "feat(import): expose block list on parsed sections"
```

---

### Task 2: `mergeSections` pure helper

Merge a section into its predecessor by concatenating blocks; the merged section keeps the upper section's title/metadata.

**Files:**
- Modify: `scripts/logic/doc-import.mjs` (add exported `mergeSections`)
- Test: `tests/doc-import.test.js`

**Interfaces:**
- Consumes: `measureBlocks` (Task 1).
- Produces: `mergeSections(sections, index) → Section[]` — a new array; merges `sections[index]` into `sections[index-1]`. Returns a shallow copy unchanged when `index <= 0` or out of range.

- [ ] **Step 1: Write the failing test**

Add to `tests/doc-import.test.js` (append near the bottom, after the `buildImportPlan` describe):

```js
import { mergeSections } from "../scripts/logic/doc-import.mjs";

describe("mergeSections", () => {
  const blk = (over = {}) => ({
    title: "S", level: 1, date: null, isSession: false,
    blocks: ["<p>x</p>"], html: "<p>x</p>", wordCount: 1, empty: false, ...over
  });

  it("merges a section into the previous one, keeping the upper title", () => {
    const before = [
      blk({ title: "One", blocks: ["<p>a</p>"], html: "<p>a</p>", wordCount: 1 }),
      blk({ title: "Two", blocks: ["<p>b</p>", "<p>c</p>"], html: "<p>b</p>\n<p>c</p>", wordCount: 2 })
    ];
    const after = mergeSections(before, 1);
    expect(after).toHaveLength(1);
    expect(after[0].title).toBe("One");
    expect(after[0].blocks).toEqual(["<p>a</p>", "<p>b</p>", "<p>c</p>"]);
    expect(after[0].html).toBe("<p>a</p>\n<p>b</p>\n<p>c</p>");
    expect(after[0].wordCount).toBe(3);
  });

  it("returns a copy and ignores index 0 or out of range", () => {
    const before = [blk(), blk()];
    expect(mergeSections(before, 0)).not.toBe(before);
    expect(mergeSections(before, 0)).toHaveLength(2);
    expect(mergeSections(before, 9)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/doc-import.test.js -t "mergeSections"`
Expected: FAIL — `mergeSections` is not exported.

- [ ] **Step 3: Implement `mergeSections`**

In `scripts/logic/doc-import.mjs`, add after `splitSections` (after its closing `}` near line 120):

```js
/** Merge sections[index] into sections[index-1] (blocks concatenated). */
export function mergeSections(sections, index) {
  if (index <= 0 || index >= sections.length) return sections.slice();
  const prev = sections[index - 1];
  const cur = sections[index];
  const blocks = [...prev.blocks, ...cur.blocks];
  const merged = {
    title: prev.title, level: prev.level, isSession: prev.isSession, date: prev.date,
    blocks, ...measureBlocks(blocks)
  };
  return [...sections.slice(0, index - 1), merged, ...sections.slice(index + 1)];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/doc-import.test.js -t "mergeSections"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/doc-import.mjs tests/doc-import.test.js
git commit -m "feat(import): add mergeSections helper"
```

---

### Task 3: `splitSectionAt` pure helper

Partition one section's blocks into contiguous runs at the given cut indices. The first run keeps the original section's title/metadata; later runs re-run title/session/date detection from their first block.

**Files:**
- Modify: `scripts/logic/doc-import.mjs` (add exported `splitSectionAt` + two private builders)
- Test: `tests/doc-import.test.js`

**Interfaces:**
- Consumes: `measureBlocks` (Task 1), `cleanTitle`, `detectSessionHeader`, `parseSectionDate` (existing).
- Produces: `splitSectionAt(sections, index, cutIndices) → Section[]` — replaces `sections[index]` with N+1 sections. `cutIndices` are block positions where a new run starts (valid range `1..blocks.length-1`); invalid/duplicate indices are ignored; no valid cuts → unchanged copy.

- [ ] **Step 1: Write the failing test**

Add to `tests/doc-import.test.js` (after the `mergeSections` describe):

```js
import { splitSectionAt } from "../scripts/logic/doc-import.mjs";

describe("splitSectionAt", () => {
  const base = {
    title: "Big", level: 1, date: null, isSession: false,
    blocks: ["<p>Alpha</p>", "<p>Beta</p>", "<p>Gamma</p>"],
    html: "<p>Alpha</p>\n<p>Beta</p>\n<p>Gamma</p>", wordCount: 3, empty: false
  };

  it("splits blocks into contiguous runs at the cut indices", () => {
    const after = splitSectionAt([base], 0, [2]);
    expect(after).toHaveLength(2);
    expect(after[0].blocks).toEqual(["<p>Alpha</p>", "<p>Beta</p>"]);
    expect(after[0].title).toBe("Big"); // first run keeps the original title
    expect(after[1].blocks).toEqual(["<p>Gamma</p>"]);
    expect(after[1].title).toBe("Gamma"); // derived from its first block
    expect(after[1].html).toBe("<p>Gamma</p>");
  });

  it("supports multiple cuts producing N+1 sections", () => {
    const after = splitSectionAt([base], 0, [1, 2]);
    expect(after.map((s) => s.blocks)).toEqual([
      ["<p>Alpha</p>"], ["<p>Beta</p>"], ["<p>Gamma</p>"]
    ]);
  });

  it("re-detects session/date on new runs and ignores invalid cuts", () => {
    const sec = {
      ...base,
      blocks: ["<p>Intro</p>", "<p>Session Zero 10/6/2024</p>", "<p>We begin.</p>"],
      html: "x", wordCount: 3
    };
    const after = splitSectionAt([sec], 0, [1, 0, 99]); // 0 and 99 are invalid
    expect(after).toHaveLength(2);
    expect(after[1].title).toBe("Session Zero 10/6/2024");
    expect(after[1].isSession).toBe(true);
    expect(after[1].date).toBe("2024-10-06");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/doc-import.test.js -t "splitSectionAt"`
Expected: FAIL — `splitSectionAt` is not exported.

- [ ] **Step 3: Implement `splitSectionAt` and its builders**

In `scripts/logic/doc-import.mjs`, add after `mergeSections`:

```js
function firstBlockTitle(blocks) {
  const text = (blocks[0] ?? "").replace(/<[^>]+>/g, " ");
  return cleanTitle(text).slice(0, 80) || "Untitled";
}

// First run after a split keeps the original section's title/metadata.
function keepRun(blocks, orig) {
  return {
    title: orig.title, level: orig.level, isSession: orig.isSession, date: orig.date,
    blocks, ...measureBlocks(blocks)
  };
}

// Later runs derive title + detection from their own first block.
function newRun(blocks) {
  const title = firstBlockTitle(blocks);
  return {
    title, level: 1, isSession: detectSessionHeader(title), date: parseSectionDate(title),
    blocks, ...measureBlocks(blocks)
  };
}

/** Split sections[index] into contiguous runs at the given block cut indices. */
export function splitSectionAt(sections, index, cutIndices) {
  const section = sections[index];
  if (!section) return sections.slice();
  const n = section.blocks.length;
  const cuts = [...new Set(cutIndices)]
    .filter((i) => Number.isInteger(i) && i > 0 && i < n)
    .sort((a, b) => a - b);
  if (!cuts.length) return sections.slice();
  const bounds = [0, ...cuts, n];
  const runs = [];
  for (let i = 0; i < bounds.length - 1; i++) runs.push(section.blocks.slice(bounds[i], bounds[i + 1]));
  const rebuilt = runs.map((run, i) => (i === 0 ? keepRun(run, section) : newRun(run)));
  return [...sections.slice(0, index), ...rebuilt, ...sections.slice(index + 1)];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/doc-import.test.js`
Expected: PASS — new `splitSectionAt` tests plus the whole file green.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/doc-import.mjs tests/doc-import.test.js
git commit -m "feat(import): add splitSectionAt helper"
```

---

### Task 4: Collapse the two file sources into one

Remove the redundant "Google Docs" source; keep a single `.docx` picker whose hint covers Google/Word export. The source-registry array stays so a future real integration slots in.

**Files:**
- Modify: `scripts/integrations/doc-sources.mjs:15-30`
- Modify: `lang/en.json` (Import block, lines ~87-90)
- Test: `tests/i18n-coverage.test.js` (run only), `tests/doc-import.test.js` (run only)

**Interfaces:**
- Produces: `DOC_SOURCES` is a one-element array `[{ id: "docx-file", … }]`.

- [ ] **Step 1: Reduce `DOC_SOURCES` to one entry**

Replace `scripts/integrations/doc-sources.mjs` lines 15-30 (the whole `export const DOC_SOURCES = [ … ];`) with:

```js
export const DOC_SOURCES = [
  {
    id: "docx-file",
    labelKey: "CAMPAIGNRECORD.Import.SourceLocal",
    hintKey: "CAMPAIGNRECORD.Import.SourceLocalHint",
    accept: ".docx",
    parse: parseDocx
  }
];
```

Leave the doc comment above it (lines 10-14) intact — it still documents the future `google-oauth` extension point.

- [ ] **Step 2: Update lang keys**

In `lang/en.json`, inside the `"Import"` block: change `SourceLocal` and `SourceLocalHint`, and delete the `SourceGoogle` and `SourceGoogleHint` lines. Result:

```json
      "SourceLocal": "Word document (.docx)",
      "SourceLocalHint": "Choose a .docx file. In Google Docs use File → Download → Microsoft Word (.docx); from Word, any .docx works.",
```

(Remove these two lines entirely:)

```json
      "SourceGoogle": "Google Docs",
      "SourceGoogleHint": "In Google Docs choose File → Download → Microsoft Word (.docx), then select that file here.",
```

- [ ] **Step 3: Run the suite**

Run: `npx vitest run tests/i18n-coverage.test.js tests/doc-import.test.js`
Expected: PASS — no references to the removed `SourceGoogle*` keys remain; `SourceLocal*` still resolve.

- [ ] **Step 4: Commit**

```bash
git add scripts/integrations/doc-sources.mjs lang/en.json
git commit -m "feat(import): collapse Google-doc source into single .docx picker"
```

---

### Task 5: Busy state + Cancel buttons + row-building refactor

Give the source step feedback while mammoth parses, add a Cancel affordance to both steps, and extract row-building into a reusable helper (used by split in Task 6).

**Files:**
- Modify: `templates/import/wizard.hbs` (source step + review footer)
- Modify: `scripts/apps/import-wizard.mjs` (actions, `#onFileChosen`, new `#setReading`, `#rowFromSection`, module `sectionPreview`)
- Modify: `lang/en.json` (add `ReadingDocument`, `Cancel`)
- Verify: `npx vitest run`; manual Foundry check

**Interfaces:**
- Consumes: `suggestType`, `splitSections` (existing).
- Produces: module fn `sectionPreview(html) → string`; instance method `#rowFromSection(section) → row`; instance method `#setReading(on)`; action `cancel`.

- [ ] **Step 1: Add lang keys**

In `lang/en.json` `"Import"` block, add (e.g. after `"ChooseFile"`):

```json
      "ReadingDocument": "Reading document…",
      "Cancel": "Cancel",
```

- [ ] **Step 2: Update the template — source busy state, Cancel, review footer**

In `templates/import/wizard.hbs`, replace the source block (lines 2-12, the `{{#if isSource}} … {{/if}}`) with:

```hbs
  {{#if isSource}}
  <p class="hint">{{localize "CAMPAIGNRECORD.Import.ReviewHint"}}</p>
  {{#each sources}}
  <fieldset class="import-source" data-source-id="{{this.id}}">
    <legend>{{localize this.labelKey}}</legend>
    <p class="hint">{{localize this.hintKey}}</p>
    <input type="file" name="file-{{this.id}}" accept="{{this.accept}}"
           aria-label="{{localize "CAMPAIGNRECORD.Import.ChooseFile"}}">
  </fieldset>
  {{/each}}
  <p class="cr-reading" hidden>{{localize "CAMPAIGNRECORD.Import.ReadingDocument"}}</p>
  <footer class="form-footer">
    <button type="button" data-action="cancel">{{localize "CAMPAIGNRECORD.Import.Cancel"}}</button>
  </footer>
  {{/if}}
```

Then replace the review `<footer>` (lines 53-58) with (adds Cancel first):

```hbs
    <footer class="form-footer">
      <button type="button" data-action="cancel">{{localize "CAMPAIGNRECORD.Import.Cancel"}}</button>
      <button type="button" data-action="backToSource">{{localize "CAMPAIGNRECORD.Import.Back"}}</button>
      <button type="button" data-action="createImport" class="bright">
        {{localize "CAMPAIGNRECORD.Import.Create"}}
      </button>
    </footer>
```

- [ ] **Step 3: Register the `cancel` action**

In `scripts/apps/import-wizard.mjs`, replace the `actions` object (lines 19-22) with:

```js
    actions: {
      cancel: ImportWizard.#onCancel,
      backToSource: ImportWizard.#onBackToSource,
      createImport: ImportWizard.#onCreate
    }
```

And add the handler (place next to `#onBackToSource`, near line 129):

```js
  static #onCancel() {
    this.close();
  }
```

- [ ] **Step 4: Add `sectionPreview`, `#rowFromSection`, `#setReading`; refactor `#onFileChosen`**

In `scripts/apps/import-wizard.mjs`, add this module-level function near the other module functions (e.g. above `dataUriToFile`, line 196):

```js
function sectionPreview(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}
```

Add these two instance methods (e.g. just above `#onFileChosen`, line 83):

```js
  #rowFromSection(section) {
    return {
      title: section.title === "Introduction"
        ? game.i18n.localize("CAMPAIGNRECORD.Import.Introduction")
        : section.title,
      type: section.empty ? "skip" : suggestType(section, RECORD_TYPES).type,
      timepoint: section.isSession,
      date: section.date,
      wordCount: section.wordCount,
      preview: sectionPreview(section.html)
    };
  }

  #setReading(on) {
    for (const input of this.element.querySelectorAll('.import-source input[type="file"]')) {
      input.disabled = on;
    }
    const status = this.element.querySelector(".cr-reading");
    if (status) status.hidden = !on;
  }
```

Replace the body of `#onFileChosen` (lines 83-111) with:

```js
  async #onFileChosen(sourceId, file) {
    this.#setReading(true);
    const source = DOC_SOURCES.find((s) => s.id === sourceId);
    let parsed;
    try {
      parsed = await source.parse(file);
    } catch (error) {
      console.error("campaign-record | docx parse failed", error);
      this.#setReading(false);
      return ui.notifications.error(game.i18n.localize("CAMPAIGNRECORD.Import.ParseError"));
    }
    const root = new DOMParser().parseFromString(parsed.html, "text/html").body;
    const { title, sections } = splitSections(root);
    if (!sections.length) {
      this.#setReading(false);
      return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Import.NoSections"));
    }
    this.state.docTitle = title ?? file.name.replace(/\.docx$/i, "");
    this.state.sections = sections;
    this.state.rows = sections.map((section) => this.#rowFromSection(section));
    this.state.step = "review";
    this.render();
  }
```

- [ ] **Step 5: Run the suite (no regressions)**

Run: `npx vitest run`
Expected: PASS — all tests green (i18n-coverage picks up the new `ReadingDocument`/`Cancel` keys).

- [ ] **Step 6: Manual Foundry check**

In Foundry: open the Campaign Hub → Import Document. Confirm: (a) only ONE file field, with the updated hint; (b) selecting a `.docx` disables the field and shows "Reading document…" briefly before the review step; (c) a **Cancel** button on both the source and review steps closes the dialog. Note any deviation.

- [ ] **Step 7: Commit**

```bash
git add templates/import/wizard.hbs scripts/apps/import-wizard.mjs lang/en.json
git commit -m "feat(import): add reading busy-state and Cancel to wizard flow"
```

---

### Task 6: Merge-up + Split controls and the split modal

Add per-row **Merge up** and **Split** controls to the review table (replacing the buried "Merge into previous" dropdown option), wire merge/split to the pure helpers while preserving unsaved row edits, and implement the split `DialogV2` modal.

**Files:**
- Modify: `scripts/apps/import-wizard.mjs` (imports, actions, `_prepareContext`, `#typeOptions`, `#formRows`/`_readForm`, `#onMergeUp`, `#onSplitSection`, `#promptSplit`)
- Modify: `templates/import/wizard.hbs` (Adjust column + buttons)
- Modify: `lang/en.json` (add `Adjust`, `MergeUp`, `Split`, `SplitTitle`, `SplitHere`, `SplitConfirm`)
- Verify: `npx vitest run`; manual Foundry check

**Interfaces:**
- Consumes: `mergeSections`, `splitSectionAt` (Tasks 2-3); `#rowFromSection`, `sectionPreview` (Task 5).
- Produces: actions `mergeUp`, `splitSection`; `#formRows() → row[]`; `#promptSplit(section) → number[] | null`.

- [ ] **Step 1: Add lang keys**

In `lang/en.json` `"Import"` block, add:

```json
      "Adjust": "Adjust",
      "MergeUp": "Merge into previous",
      "Split": "Split section",
      "SplitTitle": "Split “{title}”",
      "SplitHere": "Split before this",
      "SplitConfirm": "Split",
```

- [ ] **Step 2: Import the new helpers and register actions**

In `scripts/apps/import-wizard.mjs`, update the logic import (line 3) to:

```js
import { splitSections, suggestType, buildImportPlan, mergeSections, splitSectionAt } from "../logic/doc-import.mjs";
```

Replace the `actions` object (now the 3-entry version from Task 5) with:

```js
    actions: {
      cancel: ImportWizard.#onCancel,
      backToSource: ImportWizard.#onBackToSource,
      createImport: ImportWizard.#onCreate,
      mergeUp: ImportWizard.#onMergeUp,
      splitSection: ImportWizard.#onSplitSection
    }
```

- [ ] **Step 3: Add `canMergeUp`/`canSplit` to the row context; drop the merge dropdown option**

In `_prepareContext`, replace the `context.rows = …` assignment (lines 40-43) with:

```js
    context.rows = this.state.rows.map((row, index) => ({
      ...row, index,
      canMergeUp: index > 0,
      canSplit: (this.state.sections[index]?.blocks?.length ?? 0) > 1,
      typeOptions: this.#typeOptions(row.type)
    }));
```

In `#typeOptions`, remove the "merge" option so merge is button-only. Replace the `options` array (lines 48-55) with:

```js
    const options = [
      { value: "text", label: game.i18n.localize("CAMPAIGNRECORD.Import.TypeText") },
      ...RECORD_TYPES.map((t) => ({
        value: t, label: game.i18n.localize(`TYPES.JournalEntryPage.${typeId(t)}`)
      })),
      { value: "skip", label: game.i18n.localize("CAMPAIGNRECORD.Import.TypeSkip") }
    ];
```

- [ ] **Step 4: Refactor form-reading and add merge/split handlers**

In `scripts/apps/import-wizard.mjs`, replace `_readForm` (lines 113-127) with a shared `#formRows` plus a slimmed `_readForm`:

```js
  /** Read the per-row fields back out of the review form. */
  #formRows() {
    const form = this.element.querySelector("form.import-review");
    return this.state.rows.map((row, i) => ({
      ...row,
      title: form.elements[`title-${i}`].value.trim(),
      type: form.elements[`type-${i}`].value,
      timepoint: form.elements[`timepoint-${i}`].checked
    }));
  }

  /** Read the review form back into rows + group choice. */
  _readForm() {
    const form = this.element.querySelector("form.import-review");
    return {
      rows: this.#formRows(),
      groupId: form.elements["target-group"].value || null,
      groupName: form.elements["group-name"].value.trim()
    };
  }
```

Add the two handlers next to `#onBackToSource` (near line 129):

```js
  static #onMergeUp(event, target) {
    const index = Number(target.closest("[data-index]").dataset.index);
    this.state.rows = this.#formRows();
    this.state.sections = mergeSections(this.state.sections, index);
    this.state.rows.splice(index, 1);
    this.render();
  }

  static async #onSplitSection(event, target) {
    const index = Number(target.closest("[data-index]").dataset.index);
    this.state.rows = this.#formRows();
    const cutIndices = await this.#promptSplit(this.state.sections[index]);
    if (!cutIndices?.length) return;
    const before = this.state.sections.length;
    this.state.sections = splitSectionAt(this.state.sections, index, cutIndices);
    const count = this.state.sections.length - before + 1;
    const original = this.state.rows[index];
    const newRows = [];
    for (let i = 0; i < count; i++) {
      const section = this.state.sections[index + i];
      newRows.push(i === 0
        ? { ...original, wordCount: section.wordCount, preview: sectionPreview(section.html) }
        : this.#rowFromSection(section));
    }
    this.state.rows.splice(index, 1, ...newRows);
    this.render();
  }
```

- [ ] **Step 5: Implement the split modal**

Add this instance method to `ImportWizard` (e.g. after `#onSplitSection`):

```js
  async #promptSplit(section) {
    const blocks = section.blocks;
    if (blocks.length < 2) return null;
    const escapeHTML = foundry.utils.escapeHTML;
    const parts = blocks.map((html, i) => {
      const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
      const gap = i > 0
        ? `<label class="cr-split-gap"><input type="checkbox" name="cut-${i}"> `
          + `${game.i18n.localize("CAMPAIGNRECORD.Import.SplitHere")}</label>`
        : "";
      return `${gap}<p class="cr-split-block">${escapeHTML(text)}</p>`;
    });
    const content = `<div class="cr-split-modal">${parts.join("")}</div>`;
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format("CAMPAIGNRECORD.Import.SplitTitle", { title: section.title }) },
      content,
      buttons: [
        { action: "cancel", label: "CAMPAIGNRECORD.Import.Cancel" },
        {
          action: "split", label: "CAMPAIGNRECORD.Import.SplitConfirm", default: true,
          callback: (event, button) => [...button.form.elements]
            .filter((el) => el.name?.startsWith("cut-") && el.checked)
            .map((el) => Number(el.name.slice(4)))
        }
      ],
      rejectClose: false
    });
    return Array.isArray(result) ? result : null;
  }
```

- [ ] **Step 6: Add the Adjust column to the template**

In `templates/import/wizard.hbs`, add a header cell to the `<thead>` row (after the Timepoint `<th>`, line 29):

```hbs
        <th>{{localize "CAMPAIGNRECORD.Import.Adjust"}}</th>
```

And add a matching cell at the end of each row (after the timepoint `<td>` closes, before `</tr>`, around line 48):

```hbs
          <td class="cr-adjust">
            <button type="button" data-action="mergeUp" data-tooltip="CAMPAIGNRECORD.Import.MergeUp"
                    aria-label="{{localize "CAMPAIGNRECORD.Import.MergeUp"}}"
                    {{#unless this.canMergeUp}}disabled{{/unless}}>
              <i class="fa-solid fa-arrow-up-to-line"></i>
            </button>
            <button type="button" data-action="splitSection" data-tooltip="CAMPAIGNRECORD.Import.Split"
                    aria-label="{{localize "CAMPAIGNRECORD.Import.Split"}}"
                    {{#unless this.canSplit}}disabled{{/unless}}>
              <i class="fa-solid fa-scissors"></i>
            </button>
          </td>
```

- [ ] **Step 7: Run the suite (no regressions)**

Run: `npx vitest run`
Expected: PASS — full suite green. i18n-coverage resolves the new keys (including `data-tooltip` and `label:` references); `buildImportPlan`'s existing merge/skip tests still pass (the function is unchanged; only the UI dropdown option was removed).

- [ ] **Step 8: Manual Foundry check**

In Foundry, import a `.docx` with at least one multi-paragraph section:
- Each review row shows **merge-up** (disabled on row 1) and **split** (disabled when the section has one block) icons.
- **Merge up** joins a row into the one above; other rows' edited titles/types are preserved.
- **Split** opens the modal titled `Split "<section>"`, listing block previews with "Split before this" checkboxes in the gaps; choosing one or more and clicking **Split** replaces the row with the resulting sections (first keeps your title/type; the rest get fresh suggestions); **Cancel**/✕ makes no change.
- A full import still creates the expected pages and timepoints.

Record any deviation.

- [ ] **Step 9: Commit**

```bash
git add scripts/apps/import-wizard.mjs templates/import/wizard.hbs lang/en.json
git commit -m "feat(import): add merge-up and split controls to review step"
```

---

## Self-Review

**Spec coverage:**
- Point 1 (one source) → Task 4. ✓
- Point 2 (proceed/cancel + busy feedback) → Task 5 (Cancel both steps, "Reading document…"). ✓
- Point 3 (change how the doc is broken up) → block model Task 1; merge Task 2; split Task 3; UI + modal Task 6. ✓
- Block-aware section invariant (`html === blocks.join("\n")`) → Task 1 + Global Constraints. ✓
- Registry kept extensible → Task 4 (comment retained, array kept). ✓
- Re-detection on split → Task 3 `newRun`; merge keeps upper metadata → Task 2. ✓
- Edge cases: merge-up disabled row 0 (Task 6 `canMergeUp`), split disabled ≤1 block (Task 6 `canSplit` + `#promptSplit` guard), invalid cuts ignored (Task 3), markers travel with blocks (unchanged `buildImportPlan`/`stripTypeMarker`; blocks are element `outerHTML` so a marker paragraph stays intact in its block). ✓
- Parse failure re-enables input → Task 5 `#setReading(false)` on both error paths. ✓
- Testing: pure helpers unit-tested (Tasks 1-3); UI manual + full-suite regression (Tasks 5-6). ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — every code step shows full code. ✓

**Type consistency:** `mergeSections(sections, index)`, `splitSectionAt(sections, index, cutIndices)`, `measureBlocks(blocks)`, `sectionPreview(html)`, `#rowFromSection(section)`, `#formRows()`, `#promptSplit(section)`, `#setReading(on)` are named identically at definition and every call site. Section fields (`blocks`, `html`, `title`, `level`, `isSession`, `date`, `wordCount`, `empty`) are consistent across helpers and consumers. Cut-index semantics (new run starts at index, valid `1..n-1`) match between `splitSectionAt`, its tests, and the modal's `cut-{i}` checkbox names. ✓
