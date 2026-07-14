# Auto-link Entry Names on Save — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Campaign Record entry is saved, wrap newly-typed mentions of other entries' names (in the same campaign record) as `@UUID[…]{…}` content links — identical to a drag-drop link.

**Architecture:** A pure, unit-tested logic core (`scripts/logic/auto-link*.mjs`) does the HTML tokenizing, word-diffing, and link splicing. A thin `preUpdateJournalEntryPage` hook (`scripts/hooks/auto-link.mjs`) gates on committed saves, builds the candidate name→uuid list from the page's group, looks up the diff baseline, and rewrites the changed prose fields in place. A small baseline store, snapshotted on sheet render, defeats the quiet-autosave pollution problem.

**Tech Stack:** FoundryVTT 13 module (ES modules), Vitest for unit tests, Playwright for e2e.

## Global Constraints

- **Link markup — emit exactly `@UUID[<uuid>]{<label>}`** (the shorthand form Foundry's `enrichHTML` renders to an in-pane content link). This is the format `doc-export.mjs:10` round-trips and `timeline-links.mjs:100` documents a drop produces. The `<label>` is the user's originally-typed matched text (preserves their casing; honors "make *that* text a link").
- **Trigger — committed saves only.** In the hook, `return` when `options.render === false` (that flag marks the inline editor's quiet ~2s autosave).
- **Scope — same campaign record only.** Candidates come solely from `page.parent.pages` and only when `isGroup(page.parent)`.
- **Matching — case-insensitive, whole-word, all occurrences, longest-name-wins.** Only mentions lying entirely within *added* text are linked. Names < 3 chars are excluded.
- **No new dependencies.** Pure JS + existing Foundry globals only.
- Pure logic modules must not reference Foundry globals (`game`, `foundry`, `ui`) so they stay Vitest-testable, matching `scripts/logic/search-index.mjs`.

---

### Task 1: HTML tokenizer

Splits an HTML string into ordered, lossless segments so that existing links/code are treated as opaque and only visible text is scanned. Reconstruction (`segs.map(s => s.raw).join("")`) must equal the input exactly.

**Files:**
- Create: `scripts/logic/auto-link.mjs`
- Test: `tests/auto-link.test.js`

**Interfaces:**
- Produces: `tokenizeHtml(html: string) => Array<{ type: "text"|"tag"|"link"|"code", raw: string }>`

- [ ] **Step 1: Write the failing test**

```js
// tests/auto-link.test.js
import { describe, it, expect } from "vitest";
import { tokenizeHtml } from "../scripts/logic/auto-link.mjs";

describe("tokenizeHtml", () => {
  it("classifies text, tags, anchors, shorthand links and code; round-trips losslessly", () => {
    const html =
      '<p>Met @UUID[JournalEntry.a.JournalEntryPage.b]{Frodo} and ' +
      '<a class="content-link" data-uuid="x">Sam</a> near <code>town</code>.</p>';
    const segs = tokenizeHtml(html);
    expect(segs.map((s) => s.raw).join("")).toBe(html);
    const types = segs.map((s) => s.type);
    expect(types).toContain("text");
    expect(types).toContain("tag");
    expect(types.filter((t) => t === "link")).toHaveLength(2); // shorthand + anchor
    expect(types).toContain("code");
  });

  it("returns a single text segment for plain prose", () => {
    expect(tokenizeHtml("Just words")).toEqual([{ type: "text", raw: "Just words" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auto-link.test.js`
Expected: FAIL — `tokenizeHtml is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/logic/auto-link.mjs

/**
 * Split HTML into ordered, lossless segments. Only "text" segments are scanned
 * for name mentions; "tag", "link" (existing @UUID shorthand or <a> anchor), and
 * "code" segments are opaque passthrough so we never nest or double-link.
 */
export function tokenizeHtml(html) {
  const specials = [
    { type: "link", re: /@UUID\[[^\]]*\]\{[^}]*\}/y },
    { type: "link", re: /<a\b[^>]*>[\s\S]*?<\/a>/iy },
    { type: "code", re: /<code\b[^>]*>[\s\S]*?<\/code>/iy },
    { type: "code", re: /<pre\b[^>]*>[\s\S]*?<\/pre>/iy },
    { type: "tag", re: /<[^>]+>/y }
  ];
  const segs = [];
  let i = 0;
  let textStart = 0;
  while (i < html.length) {
    let hit = null;
    for (const s of specials) {
      s.re.lastIndex = i;
      const m = s.re.exec(html);
      if (m && m.index === i) {
        hit = { type: s.type, raw: m[0] };
        break;
      }
    }
    if (hit) {
      if (i > textStart) segs.push({ type: "text", raw: html.slice(textStart, i) });
      segs.push(hit);
      i += hit.raw.length;
      textStart = i;
    } else {
      i++;
    }
  }
  if (i > textStart) segs.push({ type: "text", raw: html.slice(textStart) });
  return segs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auto-link.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/auto-link.mjs tests/auto-link.test.js
git commit -m "feat: HTML tokenizer for auto-link core"
```

---

### Task 2: Extract visible words with locations

Produces the ordered word list (from text segments only) that the diff and matcher operate on, each word carrying its segment index and character offsets for later splicing.

**Files:**
- Modify: `scripts/logic/auto-link.mjs`
- Test: `tests/auto-link.test.js`

**Interfaces:**
- Consumes: `tokenizeHtml`
- Produces: `extractWords(segs) => Array<{ text: string, segIndex: number, start: number, end: number }>`

- [ ] **Step 1: Write the failing test**

```js
// append to tests/auto-link.test.js
import { extractWords } from "../scripts/logic/auto-link.mjs";

describe("extractWords", () => {
  it("lists words from text segments only, with segment offsets, skipping links/tags", () => {
    const segs = tokenizeHtml("<p>Met @UUID[x]{Frodo} today</p>");
    const words = extractWords(segs);
    expect(words.map((w) => w.text)).toEqual(["Met", "today"]);
    const met = words[0];
    expect(segs[met.segIndex].raw.slice(met.start, met.end)).toBe("Met");
  });

  it("treats apostrophes and hyphens as intra-word", () => {
    expect(extractWords(tokenizeHtml("Al'Akbar half-elf")).map((w) => w.text))
      .toEqual(["Al'Akbar", "half-elf"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auto-link.test.js`
Expected: FAIL — `extractWords is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// append to scripts/logic/auto-link.mjs

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/** Ordered visible words from "text" segments, with their in-segment offsets. */
export function extractWords(segs) {
  const words = [];
  segs.forEach((seg, segIndex) => {
    if (seg.type !== "text") return;
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(seg.raw))) {
      words.push({ text: m[0], segIndex, start: m.index, end: m.index + m[0].length });
    }
  });
  return words;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auto-link.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/auto-link.mjs tests/auto-link.test.js
git commit -m "feat: visible-word extraction for auto-link core"
```

---

### Task 3: Added-word diff

Flags which words in the new content were inserted relative to the baseline, via an LCS alignment on lowercased words. This is what restricts linking to "newly added text."

**Files:**
- Modify: `scripts/logic/auto-link.mjs`
- Test: `tests/auto-link.test.js`

**Interfaces:**
- Produces: `diffAddedWordFlags(baseWords: string[], newWords: string[]) => boolean[]` (aligned to `newWords`; `true` = added)

- [ ] **Step 1: Write the failing test**

```js
// append to tests/auto-link.test.js
import { diffAddedWordFlags } from "../scripts/logic/auto-link.mjs";

describe("diffAddedWordFlags", () => {
  it("flags only inserted words", () => {
    const base = ["we", "met", "gandalf"];
    const next = ["we", "met", "gandalf", "then", "frodo", "joined"];
    expect(diffAddedWordFlags(base, next)).toEqual([false, false, false, true, true, true]);
  });

  it("flags a new occurrence of a word already present elsewhere", () => {
    const base = ["we", "met", "gandalf"];
    const next = ["we", "met", "gandalf", "gandalf", "grinned"];
    // LCS keeps the first three; the 4th 'gandalf' and 'grinned' are added.
    expect(diffAddedWordFlags(base, next)).toEqual([false, false, false, true, true]);
  });

  it("is case-insensitive when aligning", () => {
    expect(diffAddedWordFlags(["Gandalf"], ["gandalf", "smiled"]))
      .toEqual([false, true]);
  });

  it("flags everything when baseline is empty", () => {
    expect(diffAddedWordFlags([], ["a", "b"])).toEqual([true, true]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auto-link.test.js`
Expected: FAIL — `diffAddedWordFlags is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// append to scripts/logic/auto-link.mjs

/**
 * LCS alignment of lowercased words. Returns a boolean per newWord: true when it
 * is not part of the longest common subsequence with baseWords (i.e. inserted).
 */
export function diffAddedWordFlags(baseWords, newWords) {
  const a = baseWords.map((w) => w.toLowerCase());
  const b = newWords.map((w) => w.toLowerCase());
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const added = new Array(m).fill(true);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      added[j] = false;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return added;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auto-link.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/auto-link.mjs tests/auto-link.test.js
git commit -m "feat: added-word diff for auto-link core"
```

---

### Task 4: Link the added mentions (`autoLinkAdded`)

Ties the core together: tokenizes new HTML, diffs vs baseline, finds candidate-name matches lying wholly within added text (whole-word, case-insensitive, longest-name-wins), and splices `@UUID[…]{…}` around each. Idempotent.

**Files:**
- Modify: `scripts/logic/auto-link.mjs`
- Test: `tests/auto-link.test.js`

**Interfaces:**
- Consumes: `tokenizeHtml`, `extractWords`, `diffAddedWordFlags`
- Produces: `autoLinkAdded(baselineHtml: string, newHtml: string, candidates: Array<{ name: string, uuid: string }>) => string` (candidates MUST be pre-sorted longest-name-first)

- [ ] **Step 1: Write the failing test**

```js
// append to tests/auto-link.test.js
import { autoLinkAdded } from "../scripts/logic/auto-link.mjs";

const cand = (name, uuid) => ({ name, uuid });
// Longest-first, as the caller guarantees.
const CANDS = [cand("Waterdeep Harbor", "u:wh"), cand("Gandalf", "u:g"),
               cand("Frodo", "u:f"), cand("Waterdeep", "u:w")];

describe("autoLinkAdded", () => {
  it("links a newly added name, preserving typed casing as the label", () => {
    const out = autoLinkAdded("We met.", "We met gandalf.", CANDS);
    expect(out).toBe("We met @UUID[u:g]{gandalf}.");
  });

  it("leaves a baseline mention untouched but links a new occurrence of the same name", () => {
    const out = autoLinkAdded("We met Gandalf.", "We met Gandalf. Gandalf grinned.", CANDS);
    expect(out).toBe("We met Gandalf. @UUID[u:g]{Gandalf} grinned.");
  });

  it("matches whole words only (no 'Frodo' inside 'Frodos')", () => {
    expect(autoLinkAdded("", "Frodos bag", CANDS)).toBe("Frodos bag");
  });

  it("prefers the longest candidate name", () => {
    expect(autoLinkAdded("", "at Waterdeep Harbor now", CANDS))
      .toBe("at @UUID[u:wh]{Waterdeep Harbor} now");
  });

  it("does not link inside an existing link, and is idempotent", () => {
    const linked = "met @UUID[u:g]{Gandalf} today";
    expect(autoLinkAdded("met today", linked, CANDS)).toBe(linked);
  });

  it("links every added occurrence", () => {
    expect(autoLinkAdded("", "Frodo and Frodo", CANDS))
      .toBe("@UUID[u:f]{Frodo} and @UUID[u:f]{Frodo}");
  });

  it("returns input unchanged when there are no candidates", () => {
    expect(autoLinkAdded("", "Gandalf", [])).toBe("Gandalf");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auto-link.test.js`
Expected: FAIL — `autoLinkAdded is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// append to scripts/logic/auto-link.mjs

/**
 * Wrap newly-added mentions of candidate names as @UUID content links.
 * `candidates` must be pre-sorted longest-name-first; each match claims its
 * words so shorter/overlapping names can't double-link the same text.
 */
export function autoLinkAdded(baselineHtml, newHtml, candidates) {
  if (!candidates?.length) return newHtml;
  const segs = tokenizeHtml(newHtml);
  const newWords = extractWords(segs);
  if (!newWords.length) return newHtml;
  const added = diffAddedWordFlags(
    extractWords(tokenizeHtml(baselineHtml)).map((w) => w.text),
    newWords.map((w) => w.text)
  );

  const claimed = new Array(newWords.length).fill(false);
  const edits = [];
  for (const c of candidates) {
    const parts = c.name.trim().split(/\s+/).map((p) => p.toLowerCase()).filter(Boolean);
    if (!parts.length) continue;
    for (let k = 0; k + parts.length <= newWords.length; k++) {
      let ok = true;
      for (let p = 0; p < parts.length; p++) {
        const w = newWords[k + p];
        if (
          claimed[k + p] ||
          !added[k + p] ||
          w.segIndex !== newWords[k].segIndex ||
          w.text.toLowerCase() !== parts[p]
        ) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const first = newWords[k];
      const last = newWords[k + parts.length - 1];
      edits.push({
        segIndex: first.segIndex,
        start: first.start,
        end: last.end,
        uuid: c.uuid,
        label: segs[first.segIndex].raw.slice(first.start, last.end)
      });
      for (let p = 0; p < parts.length; p++) claimed[k + p] = true;
    }
  }
  if (!edits.length) return newHtml;

  const bySeg = new Map();
  for (const e of edits) {
    if (!bySeg.has(e.segIndex)) bySeg.set(e.segIndex, []);
    bySeg.get(e.segIndex).push(e);
  }
  for (const [segIndex, list] of bySeg) {
    list.sort((x, y) => y.start - x.start); // right-to-left keeps offsets valid
    let raw = segs[segIndex].raw;
    for (const e of list) {
      raw = raw.slice(0, e.start) + `@UUID[${e.uuid}]{${e.label}}` + raw.slice(e.end);
    }
    segs[segIndex].raw = raw;
  }
  return segs.map((s) => s.raw).join("");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auto-link.test.js`
Expected: PASS (all `autoLinkAdded` cases).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/auto-link.mjs tests/auto-link.test.js
git commit -m "feat: link added name mentions in auto-link core"
```

---

### Task 5: Candidate selection

Pure filter that turns a group's pages into the linkable `{ name, uuid }[]`: drops self, non-indexable, invisible, and sub-3-char names; sorts longest-first; and warns on duplicate names.

**Files:**
- Create: `scripts/logic/auto-link-candidates.mjs`
- Test: `tests/auto-link-candidates.test.js`

**Interfaces:**
- Produces: `selectCandidates({ pages: Array<{ id, uuid, name, indexable: boolean, visible: boolean }>, selfId: string, minLength?: number }) => Array<{ name: string, uuid: string }>` (sorted longest-name-first)

- [ ] **Step 1: Write the failing test**

```js
// tests/auto-link-candidates.test.js
import { describe, it, expect } from "vitest";
import { selectCandidates } from "../scripts/logic/auto-link-candidates.mjs";

const page = (id, name, extra = {}) =>
  ({ id, uuid: `u:${id}`, name, indexable: true, visible: true, ...extra });

describe("selectCandidates", () => {
  it("excludes self, invisible, non-indexable, and short names; sorts longest-first", () => {
    const pages = [
      page("self", "Frodo"),
      page("a", "Waterdeep Harbor"),
      page("b", "Sam"),
      page("c", "Hidden", { visible: false }),
      page("d", "Raw", { indexable: false }),
      page("e", "Ok") // 2 chars → excluded
    ];
    expect(selectCandidates({ pages, selfId: "self" })).toEqual([
      { name: "Waterdeep Harbor", uuid: "u:a" },
      { name: "Sam", uuid: "u:b" }
    ]);
  });

  it("keeps both entries when names collide (first wins downstream)", () => {
    const pages = [page("a", "Inn"), page("b", "Inn")];
    const out = selectCandidates({ pages, selfId: "x" });
    expect(out).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auto-link-candidates.test.js`
Expected: FAIL — `selectCandidates is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/logic/auto-link-candidates.mjs

/**
 * Linkable candidates for a page's own campaign record. Pure: the caller
 * supplies indexable/visible booleans (computed from Foundry) so this stays
 * unit-testable. Sorted longest-name-first for longest-match-wins linking.
 */
export function selectCandidates({ pages, selfId, minLength = 3 }) {
  return pages
    .filter(
      (p) =>
        p.id !== selfId &&
        p.indexable &&
        p.visible &&
        (p.name?.trim().length ?? 0) >= minLength
    )
    .map((p) => ({ name: p.name, uuid: p.uuid }))
    .sort((a, b) => b.name.length - a.name.length);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auto-link-candidates.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/auto-link-candidates.mjs tests/auto-link-candidates.test.js
git commit -m "feat: candidate selection for auto-link"
```

---

### Task 6: Baseline store

An in-memory map of the field content as of the last full render, keyed by `uuid::field`. The diff baseline for typed records (quiet autosaves never refresh it because they don't render).

**Files:**
- Create: `scripts/logic/auto-link-baseline.mjs`
- Test: `tests/auto-link-baseline.test.js`

**Interfaces:**
- Produces:
  - `setBaseline(uuid: string, field: string, html: string) => void`
  - `getBaseline(uuid: string, field: string) => string | undefined`
  - `clearBaseline(uuid: string, field: string) => void`

- [ ] **Step 1: Write the failing test**

```js
// tests/auto-link-baseline.test.js
import { describe, it, expect } from "vitest";
import { setBaseline, getBaseline, clearBaseline } from "../scripts/logic/auto-link-baseline.mjs";

describe("auto-link baseline store", () => {
  it("stores and retrieves per uuid+field", () => {
    setBaseline("p1", "system.description", "<p>hi</p>");
    expect(getBaseline("p1", "system.description")).toBe("<p>hi</p>");
    expect(getBaseline("p1", "system.gmNotes")).toBeUndefined();
  });

  it("clears an entry", () => {
    setBaseline("p2", "text.content", "x");
    clearBaseline("p2", "text.content");
    expect(getBaseline("p2", "text.content")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auto-link-baseline.test.js`
Expected: FAIL — `setBaseline is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/logic/auto-link-baseline.mjs

/** Field content as of the last full sheet render — the auto-link diff baseline. */
const baselines = new Map();
const key = (uuid, field) => `${uuid}::${field}`;

export function setBaseline(uuid, field, html) {
  baselines.set(key(uuid, field), html ?? "");
}
export function getBaseline(uuid, field) {
  return baselines.get(key(uuid, field));
}
export function clearBaseline(uuid, field) {
  baselines.delete(key(uuid, field));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auto-link-baseline.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/auto-link-baseline.mjs tests/auto-link-baseline.test.js
git commit -m "feat: baseline store for auto-link diffing"
```

---

### Task 7: Snapshot the baseline on record-sheet render

Wire the baseline store into the sheet so every full render (open, and the re-render after each committed save) records the current stored prose — before any typing — for typed records.

**Files:**
- Modify: `scripts/sheets/base-record-sheet.mjs` (add import near line 6; add snapshot loop in `_onRender`, after `super._onRender(context, options)` at line 85)

**Interfaces:**
- Consumes: `setBaseline` from `scripts/logic/auto-link-baseline.mjs`

- [ ] **Step 1: Add the import**

At the top of `scripts/sheets/base-record-sheet.mjs`, after the existing `computeInlineEdit` import (line 6), add:

```js
import { setBaseline } from "../logic/auto-link-baseline.mjs";
```

- [ ] **Step 2: Add the snapshot loop**

In `_onRender`, immediately after `super._onRender(context, options);` (currently line 85), add:

```js
    // Snapshot the pre-edit prose as the auto-link diff baseline. Quiet inline
    // autosaves render:false, so they never reach here and never pollute it.
    for (const field of ["system.description", "system.gmNotes", "system.rewards", "system.distribution"]) {
      if (foundry.utils.hasProperty(this.document, field)) {
        setBaseline(this.document.uuid, field, foundry.utils.getProperty(this.document, field) ?? "");
      }
    }
```

- [ ] **Step 3: Verify unit suite still green**

Run: `npx vitest run`
Expected: PASS (no unit test covers the sheet; confirm nothing else broke).

- [ ] **Step 4: Manual sanity note**

This wiring is exercised by the Task 9 e2e. No standalone unit test — the sheet requires the Foundry runtime.

- [ ] **Step 5: Commit**

```bash
git add scripts/sheets/base-record-sheet.mjs
git commit -m "feat: snapshot auto-link baseline on record-sheet render"
```

---

### Task 8: The save interceptor hook

Register `preUpdateJournalEntryPage`, mirroring `guards.mjs`: skip quiet saves, build candidates from the page's group, resolve the baseline (snapshot for typed records, previous stored value for plain text pages), and rewrite each changed prose field via `autoLinkAdded`.

**Files:**
- Create: `scripts/hooks/auto-link.mjs`
- Modify: `scripts/campaign-record.mjs` (import + call in the `init` hook)

**Interfaces:**
- Consumes: `autoLinkAdded` (Task 4), `selectCandidates` (Task 5), `getBaseline` (Task 6), `isGroup` (`scripts/data/groups.mjs`), `isIndexablePage` (`scripts/apps/hub/hub-data.mjs`), `isRecordVisible` (`scripts/logic/visibility.mjs`)
- Produces: `registerAutoLink() => void`

- [ ] **Step 1: Write the hook module**

```js
// scripts/hooks/auto-link.mjs
import { autoLinkAdded } from "../logic/auto-link.mjs";
import { selectCandidates } from "../logic/auto-link-candidates.mjs";
import { getBaseline } from "../logic/auto-link-baseline.mjs";
import { isGroup } from "../data/groups.mjs";
import { isIndexablePage } from "../apps/hub/hub-data.mjs";
import { isRecordVisible } from "../logic/visibility.mjs";

// Rich prose fields that can carry entry-name mentions.
const FIELDS = [
  "system.description",
  "system.gmNotes",
  "system.rewards",
  "system.distribution",
  "text.content"
];

/** Linkable siblings in the page's own campaign record (group). */
function buildCandidates(page) {
  const group = page.parent;
  if (!isGroup(group)) return [];
  const candidates = selectCandidates({
    selfId: page.id,
    pages: group.pages.map((p) => ({
      id: p.id,
      uuid: p.uuid,
      name: p.name,
      indexable: isIndexablePage(p),
      visible: isRecordVisible(game.user, p)
    }))
  });
  const seen = new Set();
  for (const c of candidates) {
    const low = c.name.toLowerCase();
    if (seen.has(low)) {
      console.warn(`campaign-record | duplicate entry name "${c.name}"; auto-link uses the first match`);
    }
    seen.add(low);
  }
  return candidates;
}

/**
 * On a committed save, wrap newly-added entry-name mentions as content links.
 * Quiet inline autosaves pass { render: false } and are skipped so the stored
 * content never drifts from the open editor.
 */
export function registerAutoLink() {
  Hooks.on("preUpdateJournalEntryPage", (page, changes, options) => {
    if (options?.render === false) return;
    const candidates = buildCandidates(page);
    if (!candidates.length) return;
    for (const field of FIELDS) {
      if (!foundry.utils.hasProperty(changes, field)) continue;
      const next = foundry.utils.getProperty(changes, field);
      if (typeof next !== "string" || !next) continue;
      const baseline = getBaseline(page.uuid, field) ?? foundry.utils.getProperty(page, field) ?? "";
      const linked = autoLinkAdded(baseline, next, candidates);
      if (linked !== next) foundry.utils.setProperty(changes, field, linked);
    }
  });
}
```

- [ ] **Step 2: Register it during init**

In `scripts/campaign-record.mjs`, add the import after the `registerUpdateGuards` import (line 3):

```js
import { registerAutoLink } from "./hooks/auto-link.mjs";
```

And call it in the `init` hook, immediately after `registerUpdateGuards();` (line 20):

```js
  registerAutoLink();
```

- [ ] **Step 3: Verify the unit suite still passes**

Run: `npx vitest run`
Expected: PASS (hook module is not unit-tested directly; confirm no import breakage).

- [ ] **Step 4: Lint/load sanity**

Run: `node --check scripts/hooks/auto-link.mjs && node --check scripts/campaign-record.mjs`
Expected: no output (syntax OK).

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/auto-link.mjs scripts/campaign-record.mjs
git commit -m "feat: auto-link entry names on committed journal saves"
```

---

### Task 9: End-to-end test

Prove the feature in a live Foundry: a newly-typed name becomes an in-pane link on focus-out; a pre-existing plain mention is left alone; a cross-record name is not linked.

**Files:**
- Create: `tests/e2e/22-auto-link-entry-names.spec.mjs`

**Interfaces:**
- Consumes: existing e2e helpers (`tests/e2e/helpers/foundry.mjs`), patterned on `tests/e2e/18-inline-edit.spec.mjs` and `21-hub-record-pane.spec.mjs`.

- [ ] **Step 1: Read the e2e contract and a model spec**

**REQUIRED:** Before running anything, read the `foundry-e2e` skill (session locking, symlink ownership, unlock rules). Then read `tests/e2e/18-inline-edit.spec.mjs` and `tests/e2e/21-hub-record-pane.spec.mjs` to copy the setup/teardown, hub-open, and record-open helpers exactly.

- [ ] **Step 2: Write the spec**

Create `tests/e2e/22-auto-link-entry-names.spec.mjs` following the existing specs' structure. It must:

1. Create a campaign-record group with two NPC records in it: `Gandalf` and `Frodo`.
2. Open `Frodo` in the hub pane with inline editing enabled.
3. Focus the description prose editor, type `We met Gandalf today`, then blur (click elsewhere / focus another element) to trigger the committed flush.
4. Assert the stored `system.description` now contains `@UUID[` … `]{Gandalf}` (query the document via `page.evaluate` reading `game`), and that the rendered pane shows an `a.content-link` for Gandalf.
5. Click that link; assert the pane navigates to the `Gandalf` record (in-pane), per `21-hub-record-pane.spec.mjs`'s navigation assertion style.
6. Re-open `Frodo`, note the description already contains the Gandalf link, type ` and Gandalf waved` then blur; assert the *original* Gandalf link is unchanged and the new `Gandalf` occurrence is also linked (two `@UUID[...]{Gandalf}` in stored content), confirming baseline behavior.
7. Negative: create a second group with an NPC `Bilbo`; in `Frodo` (group 1) type `Bilbo appeared` and blur; assert `Bilbo` is NOT linked (cross-record scope).

Use `expect.poll`/`waitForFunction` on the document's stored `system.description` (via `page.evaluate(() => game.journal...)`) to avoid autosave-timing flakiness — assert only after the blur-driven committed save lands.

- [ ] **Step 3: Run the e2e spec**

Follow the `foundry-e2e` skill to acquire the session lock and run:

Run: `npx playwright test tests/e2e/22-auto-link-entry-names.spec.mjs`
Expected: PASS. Release the lock afterward per the skill.

- [ ] **Step 4: Run the full unit suite once more**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/22-auto-link-entry-names.spec.mjs
git commit -m "test: e2e for auto-linking entry names on save"
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- Decision 1 (newly added text only) → Task 3 diff + Task 4 (`added` gate). ✓
- Decision 2 (added-span granularity) → Task 3/4 (only `added` words link; baseline occurrences untouched). ✓ (test: Task 4 "leaves a baseline mention untouched…")
- Decision 3 (committed saves only) → Task 8 `options.render === false` guard. ✓
- Decision 4 (stored-content rewrite) → Task 8 rewrites `changes`. ✓
- Decision 5 (case-insensitive, whole-word, all, longest-wins) → Task 4 tests. ✓
- Decision 6 (same campaign record + visibility) → Task 5 + Task 8 `buildCandidates` (`isGroup`, `isRecordVisible`). ✓
- Decision 7 (all rich prose fields) → Task 8 `FIELDS` list. ✓
- Baseline/quiet-autosave rationale → Task 6 store + Task 7 render snapshot + Task 8 fallback to previous stored value for plain text pages. ✓
- Edge: self-link → Task 5 `selfId` exclusion. ✓
- Edge: skip already-linked/code → Task 1 opaque `link`/`code` segments. ✓
- Edge: longest match → Task 4 sorted candidates + `claimed`. ✓
- Edge: duplicate names → Task 8 `console.warn` + first-wins via `claimed`. ✓
- Edge: min length 3 → Task 5 `minLength`. ✓
- Edge: not-visible entries → Task 8 `isRecordVisible`. ✓
- Format fidelity → Global Constraints + Task 1 recognizes shorthand & anchor; Task 9 asserts real render → `a.content-link` + in-pane nav. ✓
- Testing (unit + e2e) → Tasks 1–6 unit, Task 9 e2e. ✓

**Placeholder scan:** none — every code step contains complete code; every run step names the exact command and expected result.

**Type consistency:** `tokenizeHtml`→`extractWords`→`diffAddedWordFlags`→`autoLinkAdded` signatures match across tasks; `selectCandidates` output `{ name, uuid }[]` is exactly what `autoLinkAdded` consumes; `getBaseline(uuid, field)` matches `setBaseline(uuid, field, html)`; `FIELDS` field names match the baseline snapshot list in Task 7 (plus `text.content`, which is correctly baselined via the previous-stored fallback in Task 8, since plain text pages don't use `BaseRecordSheet`). ✓

**Known limitation (documented):** a name split across an inline tag boundary (e.g. `Water<em>deep</em>`) won't match — matches must lie within one text segment. Acceptable per spec's out-of-scope stance.
