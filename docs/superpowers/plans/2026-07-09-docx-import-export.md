# docx / Google Docs Import & Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a `.docx` (including one downloaded from Google Docs) into a campaign group via a review wizard, and export a group or single record to a native `.docx`.

**Architecture:** Pure, unit-tested logic in `scripts/logic/` (docx-HTML → section tree; record snapshots → intermediate doc model) with thin app layers (`import-wizard.mjs`, `export-dialog.mjs`) doing Foundry document I/O and vendored-library calls. mammoth.js converts docx → HTML on import; the `docx` library renders the doc model to a real Word file on export. A doc-source registry leaves room for a Google OAuth source later.

**Tech Stack:** Foundry VTT v13 module (plain browser ESM, no build step), vendored mammoth 1.12.0 (UMD global `mammoth`) and docx 9.7.1 (IIFE global `docx`), Vitest + jsdom for logic tests, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-07-09-docx-import-export-design.md`

## Global Constraints

- Foundry v13 module, plain ESM, **no build step** — vendored libs are checked-in files loaded lazily via script tag, never listed in `module.json`.
- All user-facing strings go through `lang/en.json` under `CAMPAIGNRECORD.*`.
- Pure logic modules (`scripts/logic/*.mjs`) must not reference `game`, `ui`, `foundry`, or `document` — dependencies are injected.
- No schema/migration changes; `SCHEMA_VERSION` stays 1.
- E2E follows the `foundry-e2e` skill contract: run only `npm run test:e2e` / `npx playwright test <spec>`, all test data named with the `E2E ` prefix, iterate on one spec then run the full suite once at the end.
- Work happens on branch `feature/docx-import-export` in the worktree `.claude/worktrees/docx-import-export`.
- GM-only content (hidden records, `gmNotes`, `gmOnly` objectives) is exported only when a GM checks "Include GM content" (default off).

## File Structure

| File | Responsibility |
| --- | --- |
| `vendor/mammoth.browser.min.js` | Checked-in mammoth 1.12.0 UMD browser build (import) |
| `vendor/docx.iife.js` | Checked-in docx 9.7.1 IIFE build (export) |
| `scripts/integrations/vendor-loader.mjs` | Lazy script-tag loader resolving a vendored global |
| `scripts/logic/doc-import.mjs` | Pure: section titles/dates/session detection, HTML → section tree, type suggestion, wizard rows → creation plan |
| `scripts/logic/doc-export.mjs` | Pure: HTML → doc-model nodes, per-type field renderers, record snapshots → doc model with GM stripping |
| `scripts/integrations/doc-sources.mjs` | Doc-source registry; `docx-file` source (mammoth) |
| `scripts/apps/import-wizard.mjs` | ApplicationV2 wizard: source → review → create documents |
| `templates/import/wizard.hbs` | Wizard template |
| `scripts/apps/export-dialog.mjs` | Export dialog, doc model → `docx` rendering, image embedding, download |
| `tests/doc-import.test.js`, `tests/doc-export.test.js` | Vitest suites |
| `tests/e2e/fixtures/adventure-notes.docx` | Real test document fixture |
| `tests/e2e/21-import-export.spec.mjs` | E2E import + export |

Wiring edits: `scripts/apps/hub/campaign-hub.mjs` (two header actions), `templates/hub/header.hbs` (two buttons), `scripts/sheets/base-record-sheet.mjs` (header control), `lang/en.json`, `README.md`, `docs/manual-test-checklist.md`.

---

### Task 1: Vendor libraries + loader

**Files:**
- Create: `vendor/mammoth.browser.min.js`, `vendor/docx.iife.js`
- Create: `scripts/integrations/vendor-loader.mjs`

**Interfaces:**
- Produces: `loadVendorGlobal(file, globalName) → Promise<any>` — injects `<script src="modules/campaign-record/vendor/<file>">` once and resolves the named global. Used by Tasks 7 and 9.

- [ ] **Step 1: Fetch and copy the vendor builds**

```bash
cd "$(git rev-parse --show-toplevel)"
mkdir -p vendor
cd /tmp && npm pack mammoth@1.12.0 docx@9.7.1 --silent
tar xzf mammoth-1.12.0.tgz package/mammoth.browser.min.js
cp package/mammoth.browser.min.js "$OLDPWD/vendor/mammoth.browser.min.js"
rm -rf package && tar xzf docx-9.7.1.tgz package/dist/index.iife.js
cp package/dist/index.iife.js "$OLDPWD/vendor/docx.iife.js"
cd "$OLDPWD"
```

- [ ] **Step 2: Verify the globals each build defines**

Run: `head -c 120 vendor/docx.iife.js && echo && head -c 120 vendor/mammoth.browser.min.js`
Expected: docx file starts `var docx = (function(exports)`; mammoth file starts with a UMD wrapper (`!function(f){if("object"==typeof exports...`). Both attach `docx` / `mammoth` to the page global when loaded via script tag.

- [ ] **Step 3: Write the loader**

Create `scripts/integrations/vendor-loader.mjs`:

```js
import { MODULE_ID } from "../constants.mjs";

const pending = new Map();

/**
 * Load a checked-in vendor bundle (UMD/IIFE) via script tag and return the
 * global it defines. Idempotent; concurrent callers share one load.
 */
export async function loadVendorGlobal(file, globalName) {
  if (globalThis[globalName]) return globalThis[globalName];
  if (!pending.has(file)) {
    pending.set(file, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `modules/${MODULE_ID}/vendor/${file}`;
      script.onload = resolve;
      script.onerror = () => {
        pending.delete(file);
        reject(new Error(`campaign-record | failed to load vendor/${file}`));
      };
      document.head.append(script);
    }));
  }
  await pending.get(file);
  const global = globalThis[globalName];
  if (!global) throw new Error(`campaign-record | vendor/${file} did not define ${globalName}`);
  return global;
}
```

- [ ] **Step 4: Commit**

```bash
git add vendor scripts/integrations/vendor-loader.mjs
git commit -m "feat: vendor mammoth and docx builds with lazy script-tag loader"
```

---

### Task 2: doc-import — titles, dates, session detection

**Files:**
- Create: `scripts/logic/doc-import.mjs`
- Test: `tests/doc-import.test.js`

**Interfaces:**
- Produces (all pure, exported from `scripts/logic/doc-import.mjs`):
  - `cleanTitle(text: string) → string` — trims, strips stray `*` bold markers and trailing colons.
  - `detectSessionHeader(text: string) → boolean` — true for short session-header lines.
  - `parseSectionDate(text: string) → string|null` — ISO `YYYY-MM-DD` from a heading line, null when absent/invalid.

- [ ] **Step 1: Install jsdom (dev-only, used by Task 3 tests too)**

```bash
npm install --save-dev jsdom
```

- [ ] **Step 2: Write the failing tests**

Create `tests/doc-import.test.js`:

```js
import { describe, it, expect } from "vitest";
import { cleanTitle, detectSessionHeader, parseSectionDate } from "../scripts/logic/doc-import.mjs";

describe("cleanTitle", () => {
  it("strips stray bold markers and trailing colons", () => {
    expect(cleanTitle("Character List**")).toBe("Character List");
    expect(cleanTitle("**Arc 5, Session 1**")).toBe("Arc 5, Session 1");
    expect(cleanTitle("  Loot:  ")).toBe("Loot");
  });
});

describe("detectSessionHeader", () => {
  it.each([
    "Session Zero 10/6/2024",
    "Arc 1 Session 1 10/26/24",
    "Arc 2 Session 3 2/23/25",
    "Arc 5, Session 1",
    "Arc 3 Session 2 5/18/25  part 1",
    "IN PERSON SESSION 1 11/14/25",
    "Out of Arc - 3/2/23  - Sidequest",
    "Arc 6  Session 6  6/14/26"
  ])("accepts %s", (line) => {
    expect(detectSessionHeader(line)).toBe(true);
  });

  it.each([
    "We talked about the session yesterday",
    "The session ended when Arc told us to stop by the tavern for a long rest",
    "Loot:",
    ""
  ])("rejects %s", (line) => {
    expect(detectSessionHeader(line)).toBe(false);
  });
});

describe("parseSectionDate", () => {
  it("parses numeric dates with 2- and 4-digit years", () => {
    expect(parseSectionDate("Session Zero 10/6/2024")).toBe("2024-10-06");
    expect(parseSectionDate("Arc 2 Session 3 2/23/25")).toBe("2025-02-23");
  });

  it("parses spelled-out month dates", () => {
    expect(parseSectionDate("Radiant Citadel - April 27th 2025")).toBe("2025-04-27");
  });

  it("returns null for missing or invalid dates", () => {
    expect(parseSectionDate("Arc 5, Session 1")).toBeNull();
    expect(parseSectionDate("Arc 3 Session 1 3/3025")).toBeNull(); // typo: not M/D/Y
    expect(parseSectionDate("Session 4 9/31/25")).toBeNull(); // Sept 31 doesn't exist
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/doc-import.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/doc-import.mjs`.

- [ ] **Step 4: Implement**

Create `scripts/logic/doc-import.mjs`:

```js
/**
 * Pure import logic: docx-derived HTML -> section tree -> creation plan.
 * No Foundry globals; DOM nodes are supplied by the caller.
 */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december"];

/** Trim a section title and strip bold markers Word/Docs leave fused to it. */
export function cleanTitle(text) {
  return (text ?? "").replace(/\*+/g, "").replace(/\s+/g, " ").trim().replace(/:$/, "");
}

/**
 * Session-header heuristic for short plain/bold lines that aren't headings:
 * "Arc N Session M <date>", "Session Zero <date>", "IN PERSON SESSION N",
 * "Out of Arc - ...". Long prose lines never match (word-count guard).
 */
export function detectSessionHeader(text) {
  const t = cleanTitle(text);
  if (!t || t.split(/\s+/).length > 12) return false;
  return /^(?:arc\s*\d+\s*,?\s*)?session\s+(?:zero|\d+)\b/i.test(t)
    || /^in person session\s+\d+/i.test(t)
    || /^out of arc\b/i.test(t);
}

/** Extract an ISO date from a heading line; null when absent or invalid. */
export function parseSectionDate(text) {
  const t = text ?? "";
  const numeric = t.match(/(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?!\d)/);
  if (numeric) {
    const [, m, d, yRaw] = numeric.map(Number);
    if (String(numeric[3]).length === 3) return null;
    const y = yRaw < 100 ? 2000 + yRaw : yRaw;
    return toIsoDate(y, m, d);
  }
  const spelled = t.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i
  );
  if (spelled) {
    return toIsoDate(Number(spelled[3]), MONTHS.indexOf(spelled[1].toLowerCase()) + 1, Number(spelled[2]));
  }
  return null;
}

function toIsoDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const valid = date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  if (!valid) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/doc-import.test.js`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add scripts/logic/doc-import.mjs tests/doc-import.test.js package.json package-lock.json
git commit -m "feat: import title/date/session-header parsing"
```

---

### Task 3: doc-import — splitSections

**Files:**
- Modify: `scripts/logic/doc-import.mjs`
- Test: `tests/doc-import.test.js`

**Interfaces:**
- Consumes: `cleanTitle`, `detectSessionHeader`, `parseSectionDate` (Task 2).
- Produces: `splitSections(root: Element) → { title: string|null, sections: Section[] }` where `Section = { title: string, level: number, date: string|null, isSession: boolean, html: string, wordCount: number, empty: boolean }`. `root` is the `<body>` of a parsed HTML document (browser `DOMParser` in the app; jsdom in tests). `title` is the first `h1`'s text when the document opens with one (that `h1` is consumed, not a section).

Splitting rules (from the spec and the test document's hazards):
- New section at every `h1`–`h3`, and at every short plain or **fully-bold** paragraph matching `detectSessionHeader` (fully-bold = the concatenated `<strong>/<b>` text equals the paragraph text).
- Paragraphs whose text is only whitespace are dropped entirely (half the test doc).
- Content before the first section boundary becomes an "Introduction" section (only if it has any non-empty content).
- `empty: true` when a section has no content nodes after whitespace stripping.
- `wordCount` counts whitespace-separated words in the section's text content.

- [ ] **Step 1: Write the failing tests**

Append to `tests/doc-import.test.js`:

```js
import { JSDOM } from "jsdom";
import { splitSections } from "../scripts/logic/doc-import.mjs";

function body(html) {
  return new JSDOM(`<body>${html}</body>`).window.document.body;
}

describe("splitSections", () => {
  it("splits on h1-h3 and captures the doc title from a leading h1", () => {
    const { title, sections } = splitSections(body(`
      <h1>Adventure Notes</h1>
      <p>Some intro prose.</p>
      <h1>Character List**</h1>
      <p>Aracusa - Half Elf Rogue</p>
      <h3>Radiant Citadel - April 27th 2025</h3>
      <p>We arrive at the citadel.</p>`));
    expect(title).toBe("Adventure Notes");
    expect(sections.map((s) => s.title)).toEqual(
      ["Introduction", "Character List", "Radiant Citadel - April 27th 2025"]);
    expect(sections[2].date).toBe("2025-04-27");
  });

  it("splits on plain and fully-bold session-header paragraphs", () => {
    const { sections } = splitSections(body(`
      <p>Session Zero 10/6/2024</p>
      <p>We are in Natick again.</p>
      <p><strong>Arc 2 Session 3 2/23/25</strong></p>
      <p>We fight the cult.</p>
      <p><strong>Not a session</strong> but a bold lead-in to a very long paragraph of prose.</p>`));
    expect(sections.map((s) => s.title)).toEqual(
      ["Session Zero 10/6/2024", "Arc 2 Session 3 2/23/25"]);
    expect(sections[0].isSession).toBe(true);
    expect(sections[0].date).toBe("2024-10-06");
    expect(sections[1].html).toContain("cult");
    expect(sections[1].html).toContain("bold lead-in");
  });

  it("drops whitespace-only paragraphs and flags empty sections", () => {
    // h2, not h1: a leading h1 is consumed as the document title.
    const { sections } = splitSections(body(`
      <h2>Party Inventory</h2>
      <p>  </p>
      <p> </p>`));
    expect(sections).toHaveLength(1);
    expect(sections[0].empty).toBe(true);
    expect(sections[0].wordCount).toBe(0);
  });

  it("keeps tables and lists inside their section html", () => {
    const { sections } = splitSections(body(`
      <h2>Bastion</h2>
      <table><tr><td>Aracusa</td><td>Bedroom</td></tr></table>
      <ul><li>one</li><li>two</li></ul>`));
    expect(sections[0].html).toContain("<table>");
    expect(sections[0].html).toContain("<li>one</li>");
    expect(sections[0].empty).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/doc-import.test.js`
Expected: FAIL — `splitSections` is not exported.

- [ ] **Step 3: Implement**

Append to `scripts/logic/doc-import.mjs`:

```js
const HEADING_LEVELS = { H1: 1, H2: 2, H3: 3 };

function isWhitespaceOnly(el) {
  return !(el.textContent ?? "").replace(/[\s ]/g, "").length;
}

/** True when all of a paragraph's text sits inside <strong>/<b>. */
function isFullyBold(el) {
  const text = (el.textContent ?? "").trim();
  if (!text) return false;
  const boldText = [...el.querySelectorAll("strong, b")]
    .map((b) => b.textContent).join("").trim();
  return boldText === text;
}

function sectionBoundary(el) {
  const level = HEADING_LEVELS[el.tagName];
  if (level) return { level };
  if (el.tagName === "P" && (isFullyBold(el) || !el.querySelector("*"))
      && detectSessionHeader(el.textContent)) {
    return { level: 0 };
  }
  return null;
}

/**
 * Split a docx-derived HTML body into sections at headings (h1-h3) and
 * session-header paragraphs. Returns the document title (leading h1, if any)
 * and sections with cleaned titles, dates, html, and word counts.
 */
export function splitSections(root) {
  const nodes = [...root.children].filter((el) => !isWhitespaceOnly(el) || el.tagName === "TABLE");
  let title = null;
  if (nodes[0]?.tagName === "H1") title = cleanTitle(nodes.shift().textContent);

  const sections = [];
  let current = null;
  const open = (heading, level) => {
    current = { title: cleanTitle(heading), level, htmlParts: [] };
    current.isSession = detectSessionHeader(heading);
    current.date = parseSectionDate(heading);
    sections.push(current);
  };

  for (const el of nodes) {
    const boundary = sectionBoundary(el);
    if (boundary) {
      open(el.textContent, boundary.level);
      continue;
    }
    if (!current) open("Introduction", 1), current.isSession = false, current.date = null;
    current.htmlParts.push(el.outerHTML);
  }

  return {
    title,
    sections: sections.map(({ htmlParts, ...s }) => {
      const html = htmlParts.join("\n");
      const text = htmlParts.join(" ").replace(/<[^>]+>/g, " ");
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      return { ...s, html, wordCount, empty: htmlParts.length === 0 };
    })
  };
}
```

Note: the "Introduction" title is a logic-level placeholder; the wizard localizes it for display (Task 7) but the plain word is what lands in tests.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/doc-import.test.js`
Expected: PASS. If the whitespace test fails on the `<p> </p>` case, check that `isWhitespaceOnly` strips ` `.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/doc-import.mjs tests/doc-import.test.js
git commit -m "feat: split imported HTML into sections at headings and session headers"
```

---

### Task 4: doc-import — type suggestion and creation plan

**Files:**
- Modify: `scripts/logic/doc-import.mjs`
- Test: `tests/doc-import.test.js`

**Interfaces:**
- Consumes: `Section` shape from Task 3.
- Produces:
  - `RECORD_TYPE_MARKER_RE` — regex matching the exporter's round-trip marker line (Task 6 writes it; keep the two in sync): `/^Campaign Record type:\s*([a-z]+)$/i`.
  - `suggestType(section, recordTypes: string[]) → { type: string, fromMarker: boolean }` — `type` ∈ `recordTypes` ∪ `{"text"}`.
  - `stripTypeMarker(html: string) → html` — removes a leading `<p>Campaign Record type: x</p>` marker paragraph.
  - `buildImportPlan(sections, rows, recordTypes) → { pages: [{ name, type, html, timepoint: string|null }], warnings: string[] }` — `rows[i] = { title, type, timepoint }` aligned with `sections[i]`; `type` is `"text"`, a record kind, `"skip"`, or `"merge"`. Merge appends html to the previous kept page; a leading merge downgrades to skip with a warning; `timepoint` true → `timepoint` = page name. Skipped empty sections produce no warning; skipped non-empty ones do.

- [ ] **Step 1: Write the failing tests**

Append to `tests/doc-import.test.js`:

```js
import { suggestType, stripTypeMarker, buildImportPlan } from "../scripts/logic/doc-import.mjs";

const KINDS = ["npc", "place", "quest", "pc", "item", "encounter", "checklist", "shop", "loot", "media"];
const sec = (over = {}) => ({
  title: "Untitled", level: 1, date: null, isSession: false,
  html: "<p>x</p>", wordCount: 1, empty: false, ...over
});

describe("suggestType", () => {
  it("suggests from title keywords", () => {
    expect(suggestType(sec({ title: "Party Inventory" }), KINDS).type).toBe("loot");
    expect(suggestType(sec({ title: "Character List" }), KINDS).type).toBe("pc");
    expect(suggestType(sec({ title: "Bastion Information" }), KINDS).type).toBe("place");
  });

  it("defaults sessions and unknown titles to text", () => {
    expect(suggestType(sec({ title: "Arc 1 Session 1 10/26/24", isSession: true }), KINDS).type).toBe("text");
    expect(suggestType(sec({ title: "Radiant Citadel" }), KINDS).type).toBe("text");
  });

  it("honors the exporter round-trip marker over keywords", () => {
    const s = sec({ title: "Party Inventory", html: "<p>Campaign Record type: quest</p><p>body</p>" });
    expect(suggestType(s, KINDS)).toEqual({ type: "quest", fromMarker: true });
  });
});

describe("stripTypeMarker", () => {
  it("removes only a leading marker paragraph", () => {
    expect(stripTypeMarker("<p>Campaign Record type: quest</p><p>body</p>")).toBe("<p>body</p>");
    expect(stripTypeMarker("<p>body</p>")).toBe("<p>body</p>");
  });
});

describe("buildImportPlan", () => {
  const sections = [
    sec({ title: "Intro" }),
    sec({ title: "Session 1 1/5/25", isSession: true, date: "2025-01-05" }),
    sec({ title: "Part 2", html: "<p>more</p>" }),
    sec({ title: "Empty", empty: true, html: "", wordCount: 0 })
  ];

  it("creates pages, merges, and skips", () => {
    const { pages, warnings } = buildImportPlan(sections, [
      { title: "Intro", type: "text", timepoint: false },
      { title: "Session 1", type: "text", timepoint: true },
      { title: "Part 2", type: "merge", timepoint: false },
      { title: "Empty", type: "skip", timepoint: false }
    ], KINDS);
    expect(pages).toHaveLength(2);
    expect(pages[1]).toEqual({
      name: "Session 1", type: "text",
      html: "<p>x</p>\n<p>more</p>", timepoint: "Session 1"
    });
    expect(warnings).toEqual([]);
  });

  it("rejects unknown types and downgrades a leading merge", () => {
    const { pages, warnings } = buildImportPlan([sections[0]], [
      { title: "Intro", type: "merge", timepoint: false }
    ], KINDS);
    expect(pages).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(() => buildImportPlan([sections[0]], [{ title: "x", type: "wizard", timepoint: false }], KINDS))
      .toThrow(/unknown/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/doc-import.test.js`
Expected: FAIL — missing exports.

- [ ] **Step 3: Implement**

Append to `scripts/logic/doc-import.mjs`:

```js
export const RECORD_TYPE_MARKER_RE = /^Campaign Record type:\s*([a-z]+)$/i;

const TYPE_KEYWORDS = [
  [/loot|inventory|treasure/i, "loot"],
  [/character|party member/i, "pc"],
  [/shop|store|merchant/i, "shop"],
  [/bastion|location|place/i, "place"],
  [/npc/i, "npc"],
  [/quest/i, "quest"],
  [/encounter/i, "encounter"],
  [/check\s?list|to.?do/i, "checklist"]
];

function markerType(html) {
  const m = (html ?? "").match(/^\s*<p>([^<]*)<\/p>/);
  const marker = m && m[1].trim().match(RECORD_TYPE_MARKER_RE);
  return marker ? marker[1].toLowerCase() : null;
}

/** Suggest a wizard type for a section: exporter marker > title keywords > text. */
export function suggestType(section, recordTypes) {
  const fromMarker = markerType(section.html);
  if (fromMarker && recordTypes.includes(fromMarker)) return { type: fromMarker, fromMarker: true };
  if (!section.isSession) {
    for (const [re, type] of TYPE_KEYWORDS) {
      if (re.test(section.title) && recordTypes.includes(type)) return { type, fromMarker: false };
    }
  }
  return { type: "text", fromMarker: false };
}

/** Remove a leading round-trip marker paragraph from section html. */
export function stripTypeMarker(html) {
  const type = markerType(html);
  if (!type) return html;
  return html.replace(/^\s*<p>[^<]*<\/p>\s*/, "");
}

/**
 * Turn wizard rows into a creation plan. rows[i] corresponds to sections[i].
 * type: "text" | record kind | "skip" | "merge".
 */
export function buildImportPlan(sections, rows, recordTypes) {
  const pages = [];
  const warnings = [];
  rows.forEach((row, i) => {
    const section = sections[i];
    const name = cleanTitle(row.title) || section.title;
    const html = stripTypeMarker(section.html);
    if (row.type === "skip") {
      if (!section.empty) warnings.push(`Skipped non-empty section "${name}"`);
      return;
    }
    if (row.type === "merge") {
      const previous = pages[pages.length - 1];
      if (!previous) {
        warnings.push(`Section "${name}" had nothing to merge into and was skipped`);
        return;
      }
      previous.html = [previous.html, html].filter(Boolean).join("\n");
      return;
    }
    if (row.type !== "text" && !recordTypes.includes(row.type)) {
      throw new Error(`unknown import type "${row.type}"`);
    }
    pages.push({ name, type: row.type, html, timepoint: row.timepoint ? name : null });
  });
  return { pages, warnings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/doc-import.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: all suites PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add scripts/logic/doc-import.mjs tests/doc-import.test.js
git commit -m "feat: import type suggestion and wizard-rows-to-creation-plan"
```

---

### Task 5: doc-export — UUID tags and HTML → doc-model nodes

**Files:**
- Create: `scripts/logic/doc-export.mjs`
- Test: `tests/doc-export.test.js`

**Interfaces:**
- Produces (pure, exported from `scripts/logic/doc-export.mjs`):
  - `replaceUuidTags(html: string) → string` — `@UUID[...]{Label}` → `<strong>Label</strong>`; label-less `@UUID[Actor.abc]` → `<strong>abc</strong>` (last dot-segment).
  - `htmlToNodes(root: Element) → Node[]` — doc-model nodes from a parsed HTML body.
- **Doc-model node shapes** (the contract Tasks 6 and 9 build on):
  - `{ kind: "heading", level: 1-6, text: string }`
  - `{ kind: "paragraph", runs: Run[], style?: "subtitle" | "label" }`
  - `Run = { text: string, bold?: true, italics?: true, underline?: true, strike?: true, link?: string }`
  - `{ kind: "list", ordered: boolean, items: [{ runs: Run[], level: number }] }`
  - `{ kind: "table", rows: Run[][][] }` — rows → cells → runs
  - `{ kind: "image", src: string, caption: string }`

- [ ] **Step 1: Write the failing tests**

Create `tests/doc-export.test.js`:

```js
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { replaceUuidTags, htmlToNodes } from "../scripts/logic/doc-export.mjs";

function body(html) {
  return new JSDOM(`<body>${html}</body>`).window.document.body;
}

describe("replaceUuidTags", () => {
  it("renders labeled and label-less enrichers as bold text", () => {
    expect(replaceUuidTags("<p>See @UUID[JournalEntry.a.JournalEntryPage.b]{The Duke}.</p>"))
      .toBe("<p>See <strong>The Duke</strong>.</p>");
    expect(replaceUuidTags("<p>@UUID[Actor.abc]</p>")).toBe("<p><strong>abc</strong></p>");
  });
});

describe("htmlToNodes", () => {
  it("converts paragraphs with inline formatting and links", () => {
    const nodes = htmlToNodes(body(
      `<p>Meet <strong>Verity</strong>, an <em>elf</em> — <a href="https://5e.tools">rules</a></p>`));
    expect(nodes).toEqual([{
      kind: "paragraph",
      runs: [
        { text: "Meet " },
        { text: "Verity", bold: true },
        { text: ", an " },
        { text: "elf", italics: true },
        { text: " — " },
        { text: "rules", link: "https://5e.tools" }
      ]
    }]);
  });

  it("converts headings, nested lists, tables, and images", () => {
    const nodes = htmlToNodes(body(`
      <h2>Bastion</h2>
      <ul><li>outer<ul><li>inner</li></ul></li></ul>
      <ol><li>first</li></ol>
      <table><tr><td>Aracusa</td><td><strong>Bedroom</strong></td></tr></table>
      <img src="assets/map.png" alt="Old Map">`));
    expect(nodes[0]).toEqual({ kind: "heading", level: 2, text: "Bastion" });
    expect(nodes[1]).toEqual({
      kind: "list", ordered: false,
      items: [{ runs: [{ text: "outer" }], level: 0 }, { runs: [{ text: "inner" }], level: 1 }]
    });
    expect(nodes[2]).toEqual({ kind: "list", ordered: true, items: [{ runs: [{ text: "first" }], level: 0 }] });
    expect(nodes[3]).toEqual({
      kind: "table",
      rows: [[[{ text: "Aracusa" }], [{ text: "Bedroom", bold: true }]]]
    });
    expect(nodes[4]).toEqual({ kind: "image", src: "assets/map.png", caption: "Old Map" });
  });

  it("skips empty paragraphs and unwraps blockquotes/divs", () => {
    const nodes = htmlToNodes(body(`<p>  </p><blockquote><p>quoted</p></blockquote>`));
    expect(nodes).toEqual([{ kind: "paragraph", runs: [{ text: "quoted", italics: true }] }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/doc-export.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/doc-export.mjs`.

- [ ] **Step 3: Implement**

Create `scripts/logic/doc-export.mjs`:

```js
/**
 * Pure export logic: record snapshots -> intermediate doc model.
 * Node kinds: heading, paragraph, list, table, image (see tests).
 * No Foundry globals; DOM nodes and i18n are supplied by the caller.
 */

/** Foundry @UUID enrichers are meaningless outside the VTT: keep the label. */
export function replaceUuidTags(html) {
  return (html ?? "")
    .replace(/@UUID\[[^\]]+\]\{([^}]*)\}/g, "<strong>$1</strong>")
    .replace(/@UUID\[([^\]]+)\]/g, (_, uuid) => `<strong>${uuid.split(".").pop()}</strong>`);
}

const INLINE_FLAGS = { STRONG: "bold", B: "bold", EM: "italics", I: "italics",
  U: "underline", S: "strike", STRIKE: "strike", DEL: "strike" };

/** Flatten an element's inline content into styled runs. */
function collectRuns(el, flags = {}) {
  const runs = [];
  for (const node of el.childNodes) {
    if (node.nodeType === 3) { // text
      const text = node.textContent.replace(/\s+/g, " ");
      if (text) runs.push({ text, ...flags });
    } else if (node.nodeType === 1) {
      if (node.tagName === "BR") { runs.push({ text: "\n", ...flags }); continue; }
      const next = { ...flags };
      const flag = INLINE_FLAGS[node.tagName];
      if (flag) next[flag] = true;
      if (node.tagName === "A" && node.getAttribute("href")) next.link = node.getAttribute("href");
      runs.push(...collectRuns(node, next));
    }
  }
  return runs;
}

function trimRuns(runs) {
  if (runs.length) {
    runs[0].text = runs[0].text.replace(/^\s+/, "");
    runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, "");
  }
  return runs.filter((r) => r.text);
}

function listItems(listEl, level, ordered, out) {
  for (const li of listEl.children) {
    if (li.tagName !== "LI") continue;
    const clone = li.cloneNode(true);
    for (const nested of clone.querySelectorAll("ul, ol")) nested.remove();
    out.push({ runs: trimRuns(collectRuns(clone)), level });
    for (const nested of li.children) {
      if (nested.tagName === "UL" || nested.tagName === "OL") listItems(nested, level + 1, ordered, out);
    }
  }
}

/** Convert a parsed HTML body into doc-model nodes. */
export function htmlToNodes(root, flags = {}) {
  const nodes = [];
  for (const el of root.children) {
    const heading = el.tagName.match(/^H([1-6])$/);
    if (heading) {
      const text = el.textContent.trim();
      if (text) nodes.push({ kind: "heading", level: Number(heading[1]), text });
    } else if (el.tagName === "P" || el.tagName === "PRE") {
      const runs = trimRuns(collectRuns(el, flags));
      const img = el.querySelector("img[src]");
      if (img) nodes.push({ kind: "image", src: img.getAttribute("src"), caption: img.getAttribute("alt") ?? "" });
      if (runs.length) nodes.push({ kind: "paragraph", runs });
    } else if (el.tagName === "UL" || el.tagName === "OL") {
      const items = [];
      listItems(el, 0, el.tagName === "OL", items);
      if (items.length) nodes.push({ kind: "list", ordered: el.tagName === "OL", items });
    } else if (el.tagName === "TABLE") {
      const rows = [...el.querySelectorAll("tr")].map((tr) =>
        [...tr.children].filter((c) => /^T[HD]$/.test(c.tagName))
          .map((cell) => trimRuns(collectRuns(cell))));
      if (rows.length) nodes.push({ kind: "table", rows });
    } else if (el.tagName === "IMG" && el.getAttribute("src")) {
      nodes.push({ kind: "image", src: el.getAttribute("src"), caption: el.getAttribute("alt") ?? "" });
    } else if (el.tagName === "BLOCKQUOTE") {
      nodes.push(...htmlToNodes(el, { ...flags, italics: true }));
    } else if (el.children.length) { // div and other wrappers: recurse
      nodes.push(...htmlToNodes(el, flags));
    } else {
      const runs = trimRuns(collectRuns(el, flags));
      if (runs.length) nodes.push({ kind: "paragraph", runs });
    }
  }
  return nodes;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/doc-export.test.js`
Expected: PASS. Watch the blockquote case: the inner `<p>` recursion must carry the italics flag.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/doc-export.mjs tests/doc-export.test.js
git commit -m "feat: export HTML-to-doc-model conversion with UUID tag handling"
```

---

### Task 6: doc-export — field renderers and snapshot → doc model

**Files:**
- Modify: `scripts/logic/doc-export.mjs`
- Test: `tests/doc-export.test.js`

**Interfaces:**
- Consumes: `htmlToNodes`, `replaceUuidTags`, doc-model node shapes (Task 5); `RECORD_TYPE_MARKER_RE` contract (Task 4) — the marker paragraph text is `` `Campaign Record type: ${kind}` ``.
- Produces:
  - `snapshotToDocModel(snapshot, opts) → Node[]` where:
    - `snapshot = { name: string, timeline: [{ label, items: string[] }] | null, records: RecordSnapshot[] }`
    - `RecordSnapshot = { name, kind, hidden: boolean, system: object|null, html: string }` — `kind` is a record kind or `"text"`; `system` is `page.system.toObject()` for records, null for text pages; `html` is the description (records) or page body (text pages), pre-`replaceUuidTags`'d raw HTML.
    - `opts = { includeGM: boolean, parse: (html) => Element, i18n: (key) => string }` — `parse` returns a body Element (browser: DOMParser; tests: jsdom); `i18n` localizes `CAMPAIGNRECORD.*` keys.
  - GM stripping inside: hidden records dropped when `!includeGM`; `gmNotes` and `gmOnly` objectives only when `includeGM`.
  - The "Timeline" / "GM Notes" headings localize via `opts.i18n` against keys `CAMPAIGNRECORD.Export.Timeline` / `CAMPAIGNRECORD.Export.GmNotes` (added to `lang/en.json` in Task 9; the Task 6 test stub resolves them to their last segment). The type-marker paragraph is deliberately NOT localized — it is the round-trip contract with `RECORD_TYPE_MARKER_RE`.
  - Each record emits: `heading(1, name)` → subtitle paragraph `{ style: "subtitle" }` with the type marker text → field nodes (per-kind) → description nodes → optional GM Notes (heading level 3 + nodes).

Field renderer summary (label lines use `{ kind: "paragraph", style: "label", runs: [{text: "Label: ", bold: true}, {text: value}] }`, empty values skipped):
- **npc**: role, location, race, gender, profession, voice, faction, status (i18n of `CAMPAIGNRECORD.Npc.Status.<v>`)
- **place**: location, government, size, placeType (i18n `CAMPAIGNRECORD.Place.Type.<v>`)
- **quest**: source, status (i18n), objectives as a list (`[x] `/`[ ] ` prefix, gmOnly filtered by `includeGM`, gmOnly items get a bold `(GM) ` prefix), rewards HTML via `htmlToNodes`
- **pc**: playerName, classLevel, faction
- **item**: itemType, rarity, attunement
- **encounter**: location, difficulty, outcome, combatants as a list (`${count}× ${name}`)
- **checklist**: items as a list (`[x] `/`[ ] `, assignee appended as ` — assignee` when set)
- **shop**: shopType, location, owner, inventory as a table (header Name/Price/Qty + rows)
- **loot**: currency as one label line (`pp/gp/ep/sp/cp`, only non-zero, e.g. `12 gp, 3 sp`), items as a table (Name/Qty), distribution HTML via `htmlToNodes`
- **media**: images as `{ kind: "image", src, caption }` nodes
- **tags** (all kinds): one label line when non-empty, comma-joined

- [ ] **Step 1: Write the failing tests**

Append to `tests/doc-export.test.js`:

```js
import { snapshotToDocModel } from "../scripts/logic/doc-export.mjs";

const parse = (html) => new JSDOM(`<body>${html}</body>`).window.document.body;
const i18n = (key) => key.split(".").pop(); // "…Status.alive" -> "alive"
const opts = (over = {}) => ({ includeGM: false, parse, i18n, ...over });

const rec = (over = {}) => ({
  name: "Verity", kind: "npc", hidden: false,
  system: { role: "Captain", location: "", race: "", gender: "", profession: "",
    voice: "", faction: "", status: "alive", tags: [], gmNotes: "" },
  html: "<p>A stern captain.</p>", ...over
});

describe("snapshotToDocModel", () => {
  it("renders a group with timeline, record heading, marker, fields, and body", () => {
    const nodes = snapshotToDocModel({
      name: "My Campaign",
      timeline: [{ label: "Session 1", items: ["Verity"] }],
      records: [rec()]
    }, opts());
    const texts = nodes.map((n) => n.text ?? n.runs?.map((r) => r.text).join("") ?? n.kind);
    expect(nodes[0]).toEqual({ kind: "heading", level: 1, text: "My Campaign" });
    expect(texts).toContain("Timeline");
    expect(texts).toContain("Session 1");
    expect(nodes.find((n) => n.style === "subtitle").runs[0].text).toBe("Campaign Record type: npc");
    expect(texts).toContain("Role: Captain");
    expect(texts).toContain("Status: alive");
    expect(texts).toContain("A stern captain.");
  });

  it("strips hidden records, gmNotes, and gmOnly objectives without includeGM", () => {
    const quest = rec({
      name: "Find the Rattle", kind: "quest",
      system: {
        source: "", status: "active", rewards: "",
        objectives: [
          { id: "a", text: "Ask around", done: true, gmOnly: false },
          { id: "b", text: "Secret twist", done: false, gmOnly: true }
        ],
        tags: [], gmNotes: "<p>the duke did it</p>"
      }
    });
    const hiddenRec = rec({ name: "Hidden NPC", hidden: true });

    const player = snapshotToDocModel({ name: "G", timeline: null, records: [quest, hiddenRec] }, opts());
    const playerText = JSON.stringify(player);
    expect(playerText).not.toContain("Hidden NPC");
    expect(playerText).not.toContain("Secret twist");
    expect(playerText).not.toContain("the duke did it");
    expect(playerText).toContain("[x] Ask around");

    const gm = snapshotToDocModel({ name: "G", timeline: null, records: [quest, hiddenRec] },
      opts({ includeGM: true }));
    const gmText = JSON.stringify(gm);
    expect(gmText).toContain("Hidden NPC");
    expect(gmText).toContain("Secret twist");
    expect(gmText).toContain("the duke did it");
  });

  it("renders shop inventory and loot currency", () => {
    const nodes = snapshotToDocModel({
      name: "G", timeline: null,
      records: [
        rec({ name: "Emporium", kind: "shop", system: {
          shopType: "", location: "", owner: "Gander",
          inventory: [{ id: "i1", name: "Rope", price: "1 gp", quantity: 2, item: null }],
          tags: [], gmNotes: ""
        } }),
        rec({ name: "Haul", kind: "loot", system: {
          currency: { cp: 0, sp: 3, ep: 0, gp: 12, pp: 0 },
          items: [{ id: "l1", name: "Helm", quantity: 1, item: null }],
          source: null, distribution: "", tags: [], gmNotes: ""
        } })
      ]
    }, opts());
    const table = nodes.find((n) => n.kind === "table");
    expect(table.rows[1][0][0].text).toBe("Rope");
    expect(JSON.stringify(nodes)).toContain("12 gp, 3 sp");
  });

  it("renders a single text page body", () => {
    const nodes = snapshotToDocModel({
      name: "G", timeline: null,
      records: [{ name: "Notes", kind: "text", hidden: false, system: null, html: "<p>hello</p>" }]
    }, opts());
    expect(JSON.stringify(nodes)).toContain("hello");
    expect(nodes.find((n) => n.style === "subtitle")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/doc-export.test.js`
Expected: FAIL — `snapshotToDocModel` not exported.

- [ ] **Step 3: Implement**

Append to `scripts/logic/doc-export.mjs`:

```js
const label = (name, value, extraRuns = []) => ({
  kind: "paragraph", style: "label",
  runs: [{ text: `${name}: `, bold: true }, { text: String(value) }, ...extraRuns]
});

const labelIf = (name, value) => (value ? [label(name, value)] : []);

const checkItem = (text, done, prefixRuns = []) =>
  ({ runs: [...prefixRuns, { text: `[${done ? "x" : " "}] ${text}` }], level: 0 });

/** Per-kind structured-field renderers: (system, ctx) -> Node[]. */
const FIELD_RENDERERS = {
  npc: (s, { i18n }) => [
    ...labelIf("Role", s.role), ...labelIf("Location", s.location),
    ...labelIf("Race", s.race), ...labelIf("Gender", s.gender),
    ...labelIf("Profession", s.profession), ...labelIf("Voice", s.voice),
    ...labelIf("Faction", s.faction),
    ...labelIf("Status", s.status && i18n(`CAMPAIGNRECORD.Npc.Status.${s.status}`))
  ],
  place: (s, { i18n }) => [
    ...labelIf("Location", s.location), ...labelIf("Government", s.government),
    ...labelIf("Size", s.size),
    ...labelIf("Type", s.placeType && i18n(`CAMPAIGNRECORD.Place.Type.${s.placeType}`))
  ],
  quest: (s, ctx) => {
    const objectives = (s.objectives ?? []).filter((o) => ctx.includeGM || !o.gmOnly);
    return [
      ...labelIf("Source", s.source),
      ...labelIf("Status", s.status && ctx.i18n(`CAMPAIGNRECORD.Quest.Status.${s.status}`)),
      ...(objectives.length ? [{
        kind: "list", ordered: false,
        items: objectives.map((o) =>
          checkItem(o.text, o.done, o.gmOnly ? [{ text: "(GM) ", bold: true }] : []))
      }] : []),
      ...(s.rewards ? [label("Rewards", ""), ...htmlBody(s.rewards, ctx)] : [])
    ];
  },
  pc: (s) => [
    ...labelIf("Player", s.playerName), ...labelIf("Class & Level", s.classLevel),
    ...labelIf("Faction", s.faction)
  ],
  item: (s) => [
    ...labelIf("Type", s.itemType), ...labelIf("Rarity", s.rarity),
    ...labelIf("Attunement", s.attunement)
  ],
  encounter: (s) => [
    ...labelIf("Location", s.location), ...labelIf("Difficulty", s.difficulty),
    ...labelIf("Outcome", s.outcome),
    ...((s.combatants ?? []).length ? [{
      kind: "list", ordered: false,
      items: s.combatants.map((c) => ({ runs: [{ text: `${c.count}× ${c.name}` }], level: 0 }))
    }] : [])
  ],
  checklist: (s) => ((s.items ?? []).length ? [{
    kind: "list", ordered: false,
    items: s.items.map((it) =>
      checkItem(it.assignee ? `${it.text} — ${it.assignee}` : it.text, it.done))
  }] : []),
  shop: (s) => [
    ...labelIf("Type", s.shopType), ...labelIf("Location", s.location),
    ...labelIf("Owner", s.owner),
    ...((s.inventory ?? []).length ? [{
      kind: "table",
      rows: [
        [[{ text: "Name", bold: true }], [{ text: "Price", bold: true }], [{ text: "Qty", bold: true }]],
        ...s.inventory.map((r) => [[{ text: r.name }], [{ text: r.price }], [{ text: String(r.quantity) }]])
      ]
    }] : [])
  ],
  loot: (s, ctx) => {
    const coins = ["pp", "gp", "ep", "sp", "cp"]
      .filter((c) => s.currency?.[c]).map((c) => `${s.currency[c]} ${c}`).join(", ");
    return [
      ...labelIf("Currency", coins),
      ...((s.items ?? []).length ? [{
        kind: "table",
        rows: [
          [[{ text: "Name", bold: true }], [{ text: "Qty", bold: true }]],
          ...s.items.map((r) => [[{ text: r.name }], [{ text: String(r.quantity) }]])
        ]
      }] : []),
      ...(s.distribution ? htmlBody(s.distribution, ctx) : [])
    ];
  },
  media: (s) => (s.images ?? []).map((img) => ({ kind: "image", src: img.src, caption: img.caption ?? "" }))
};

function htmlBody(html, { parse }) {
  if (!html) return [];
  return htmlToNodes(parse(replaceUuidTags(html)));
}

/**
 * Build the full doc model for an export snapshot. GM-only content (hidden
 * records, gmNotes, gmOnly objectives) is included only with opts.includeGM.
 */
export function snapshotToDocModel(snapshot, opts) {
  const nodes = [{ kind: "heading", level: 1, text: snapshot.name }];

  if (snapshot.timeline?.length) {
    nodes.push({ kind: "heading", level: 2, text: opts.i18n("CAMPAIGNRECORD.Export.Timeline") });
    for (const tp of snapshot.timeline) {
      nodes.push({ kind: "heading", level: 3, text: tp.label });
      if (tp.items.length) {
        nodes.push({ kind: "list", ordered: false,
          items: tp.items.map((name) => ({ runs: [{ text: name }], level: 0 })) });
      }
    }
  }

  for (const record of snapshot.records) {
    if (record.hidden && !opts.includeGM) continue;
    nodes.push({ kind: "heading", level: 1, text: record.name });
    if (record.kind !== "text") {
      nodes.push({ kind: "paragraph", style: "subtitle",
        runs: [{ text: `Campaign Record type: ${record.kind}` }] });
      const tags = [...(record.system?.tags ?? [])];
      nodes.push(...(FIELD_RENDERERS[record.kind]?.(record.system, opts) ?? []));
      if (tags.length) nodes.push(label("Tags", tags.join(", ")));
    }
    nodes.push(...htmlBody(record.html, opts));
    if (opts.includeGM && record.system?.gmNotes) {
      nodes.push({ kind: "heading", level: 3, text: opts.i18n("CAMPAIGNRECORD.Export.GmNotes") });
      nodes.push(...htmlBody(record.system.gmNotes, opts));
    }
  }
  return nodes;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/doc-export.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/logic/doc-export.mjs tests/doc-export.test.js
git commit -m "feat: export snapshot-to-doc-model with per-type field renderers and GM stripping"
```

---

### Task 7: Doc sources + Import Wizard UI (source → review)

**Files:**
- Create: `scripts/integrations/doc-sources.mjs`
- Create: `scripts/apps/import-wizard.mjs`
- Create: `templates/import/wizard.hbs`
- Modify: `templates/hub/header.hbs`, `scripts/apps/hub/campaign-hub.mjs`, `lang/en.json`

**Interfaces:**
- Consumes: `loadVendorGlobal` (Task 1); `splitSections`, `suggestType` (Tasks 3–4); Hub action pattern (`campaign-hub.mjs` `DEFAULT_OPTIONS.actions`).
- Produces:
  - `DOC_SOURCES: [{ id, labelKey, hintKey, accept, async parse(file) → { html, messages } }]` — `docx-file` and `google-docs` entries (both parse a `.docx`; they differ only in the hint shown).
  - `ImportWizard.open()` — ApplicationV2; after this task the wizard reaches the review table; creation lands in Task 8 (`#onCreate` is stubbed to a console.log here).

No unit tests (Foundry UI); verified by the Task 10 e2e and a manual smoke check.

- [ ] **Step 1: Create the doc-source registry**

Create `scripts/integrations/doc-sources.mjs`:

```js
import { loadVendorGlobal } from "./vendor-loader.mjs";

async function parseDocx(file) {
  const mammoth = await loadVendorGlobal("mammoth.browser.min.js", "mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return { html: result.value, messages: result.messages ?? [] };
}

/**
 * Registered import sources. A future Google OAuth source slots in here
 * (id: "google-oauth") without wizard changes; today the google-docs entry
 * is the guided manual flow: download as .docx, then pick the file.
 */
export const DOC_SOURCES = [
  {
    id: "docx-file",
    labelKey: "CAMPAIGNRECORD.Import.SourceLocal",
    hintKey: "CAMPAIGNRECORD.Import.SourceLocalHint",
    accept: ".docx",
    parse: parseDocx
  },
  {
    id: "google-docs",
    labelKey: "CAMPAIGNRECORD.Import.SourceGoogle",
    hintKey: "CAMPAIGNRECORD.Import.SourceGoogleHint",
    accept: ".docx",
    parse: parseDocx
  }
];
```

- [ ] **Step 2: Add the i18n strings**

In `lang/en.json`, add an `"Import"` object inside `"CAMPAIGNRECORD"` (alongside `"Hub"`):

```json
"Import": {
  "Title": "Import Document",
  "Button": "Import Document",
  "SourceLocal": "Local Word file",
  "SourceLocalHint": "Import a .docx file from your computer.",
  "SourceGoogle": "Google Docs",
  "SourceGoogleHint": "In Google Docs choose File → Download → Microsoft Word (.docx), then select that file here.",
  "ChooseFile": "Choose .docx file",
  "ParseError": "Could not read that file as a Word document.",
  "NoSections": "No usable content was found in the document.",
  "ReviewHint": "Review the detected sections. Choose a type for each, or skip/merge them, then create.",
  "TargetGroup": "Import into",
  "NewGroup": "New group…",
  "GroupName": "Group name",
  "SectionTitle": "Title",
  "SectionType": "Type",
  "Timepoint": "Timepoint",
  "Words": "words",
  "TypeText": "Text page",
  "TypeSkip": "Skip",
  "TypeMerge": "Merge into previous",
  "Introduction": "Introduction",
  "Back": "Back",
  "Create": "Import",
  "Created": "Imported {pages} pages and {timepoints} timepoints into \"{group}\".",
  "ImagesDropped": "Images could not be uploaded and were left out.",
  "NothingToImport": "Every section is set to skip — nothing to import."
}
```

- [ ] **Step 3: Create the wizard template**

Create `templates/import/wizard.hbs`:

```handlebars
<div class="import-wizard">
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
  {{/if}}

  {{#if isReview}}
  <form class="import-review">
    <div class="form-group">
      <label>{{localize "CAMPAIGNRECORD.Import.TargetGroup"}}</label>
      <select name="target-group">
        <option value="">{{localize "CAMPAIGNRECORD.Import.NewGroup"}}</option>
        {{#each groups}}<option value="{{this.id}}">{{this.name}}</option>{{/each}}
      </select>
      <input type="text" name="group-name" value="{{groupName}}"
             aria-label="{{localize "CAMPAIGNRECORD.Import.GroupName"}}">
    </div>
    <table class="import-sections">
      <thead><tr>
        <th>{{localize "CAMPAIGNRECORD.Import.SectionTitle"}}</th>
        <th>{{localize "CAMPAIGNRECORD.Import.SectionType"}}</th>
        <th>{{localize "CAMPAIGNRECORD.Import.Timepoint"}}</th>
      </tr></thead>
      <tbody>
        {{#each rows}}
        <tr data-index="{{this.index}}">
          <td>
            <input type="text" name="title-{{this.index}}" value="{{this.title}}">
            <p class="hint">{{this.preview}} ({{this.wordCount}} {{localize "CAMPAIGNRECORD.Import.Words"}})</p>
          </td>
          <td>
            <select name="type-{{this.index}}">
              {{#each this.typeOptions}}
              <option value="{{this.value}}" {{#if this.selected}}selected{{/if}}>{{this.label}}</option>
              {{/each}}
            </select>
          </td>
          <td>
            <input type="checkbox" name="timepoint-{{this.index}}" {{#if this.timepoint}}checked{{/if}}>
            {{#if this.date}}<span class="hint">{{this.date}}</span>{{/if}}
          </td>
        </tr>
        {{/each}}
      </tbody>
    </table>
    <footer class="form-footer">
      <button type="button" data-action="backToSource">{{localize "CAMPAIGNRECORD.Import.Back"}}</button>
      <button type="button" data-action="createImport" class="bright">
        {{localize "CAMPAIGNRECORD.Import.Create"}}
      </button>
    </footer>
  </form>
  {{/if}}
</div>
```

- [ ] **Step 4: Create the wizard application**

Create `scripts/apps/import-wizard.mjs`:

```js
import { RECORD_TYPES, typeId } from "../constants.mjs";
import { getGroups } from "../data/groups.mjs";
import { splitSections, suggestType } from "../logic/doc-import.mjs";
import { DOC_SOURCES } from "../integrations/doc-sources.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ImportWizard extends HandlebarsApplicationMixin(ApplicationV2) {
  static open() {
    new ImportWizard().render({ force: true });
  }

  static DEFAULT_OPTIONS = {
    id: "campaign-record-import",
    classes: ["campaign-record", "import-wizard-app"],
    window: { title: "CAMPAIGNRECORD.Import.Title", icon: "fa-solid fa-file-import" },
    position: { width: 640, height: "auto" },
    actions: {
      backToSource: ImportWizard.#onBackToSource,
      createImport: ImportWizard.#onCreate
    }
  };

  static PARTS = {
    body: { template: "modules/campaign-record/templates/import/wizard.hbs" }
  };

  state = { step: "source", docTitle: null, sections: [], rows: [] };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.isSource = this.state.step === "source";
    context.isReview = this.state.step === "review";
    context.sources = DOC_SOURCES;
    context.groups = getGroups().filter((g) => g.canUserModify(game.user, "update"))
      .map((g) => ({ id: g.id, name: g.name }));
    context.groupName = this.state.docTitle
      ?? game.i18n.localize("CAMPAIGNRECORD.Import.Title");
    context.rows = this.state.rows.map((row, index) => ({
      ...row, index,
      typeOptions: this.#typeOptions(row.type)
    }));
    return context;
  }

  #typeOptions(selected) {
    const options = [
      { value: "text", label: game.i18n.localize("CAMPAIGNRECORD.Import.TypeText") },
      ...RECORD_TYPES.map((t) => ({
        value: t, label: game.i18n.localize(`TYPES.JournalEntryPage.${typeId(t)}`)
      })),
      { value: "merge", label: game.i18n.localize("CAMPAIGNRECORD.Import.TypeMerge") },
      { value: "skip", label: game.i18n.localize("CAMPAIGNRECORD.Import.TypeSkip") }
    ];
    return options.map((o) => ({ ...o, selected: o.value === selected }));
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const input of this.element.querySelectorAll('.import-source input[type="file"]')) {
      input.addEventListener("change", (event) => {
        const sourceId = event.target.closest("[data-source-id]").dataset.sourceId;
        const file = event.target.files?.[0];
        if (file) this.#onFileChosen(sourceId, file);
      });
    }
  }

  async #onFileChosen(sourceId, file) {
    const source = DOC_SOURCES.find((s) => s.id === sourceId);
    let parsed;
    try {
      parsed = await source.parse(file);
    } catch (error) {
      console.error("campaign-record | docx parse failed", error);
      return ui.notifications.error(game.i18n.localize("CAMPAIGNRECORD.Import.ParseError"));
    }
    const root = new DOMParser().parseFromString(parsed.html, "text/html").body;
    const { title, sections } = splitSections(root);
    if (!sections.length) {
      return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Import.NoSections"));
    }
    this.state.docTitle = title ?? file.name.replace(/\.docx$/i, "");
    this.state.sections = sections;
    this.state.rows = sections.map((section) => ({
      title: section.title === "Introduction"
        ? game.i18n.localize("CAMPAIGNRECORD.Import.Introduction")
        : section.title,
      type: section.empty ? "skip" : suggestType(section, RECORD_TYPES).type,
      timepoint: section.isSession,
      date: section.date,
      wordCount: section.wordCount,
      preview: section.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)
    }));
    this.state.step = "review";
    this.render();
  }

  /** Read the review form back into rows. */
  _readForm() {
    const form = this.element.querySelector("form.import-review");
    const rows = this.state.rows.map((row, i) => ({
      ...row,
      title: form.elements[`title-${i}`].value.trim(),
      type: form.elements[`type-${i}`].value,
      timepoint: form.elements[`timepoint-${i}`].checked
    }));
    return {
      rows,
      groupId: form.elements["target-group"].value || null,
      groupName: form.elements["group-name"].value.trim()
    };
  }

  static #onBackToSource() {
    this.state = { step: "source", docTitle: null, sections: [], rows: [] };
    this.render();
  }

  static async #onCreate() {
    console.log("campaign-record | import creation wired in the next task");
  }
}
```

- [ ] **Step 5: Wire the Hub button**

In `templates/hub/header.hbs`, after the group `<select>` add:

```handlebars
  {{#if canImport}}
  <button type="button" data-action="importDocument" data-tooltip="CAMPAIGNRECORD.Import.Button">
    <i class="fa-solid fa-file-import"></i>
  </button>
  {{/if}}
```

In `scripts/apps/hub/campaign-hub.mjs`:
- Add to imports: `import { ImportWizard } from "../import-wizard.mjs";`
- Add to `DEFAULT_OPTIONS.actions`: `importDocument: CampaignHub.#onImportDocument,`
- Add the handler next to `#onNewRecord`:

```js
  static #onImportDocument() {
    ImportWizard.open();
  }
```

- In `_prepareContext`, after `context.isGM = game.user.isGM;` add:

```js
    context.canImport = game.user.can("JOURNAL_CREATE");
```

- [ ] **Step 6: Manual smoke check**

Do NOT start or restart the Foundry server yourself — follow the `foundry-e2e` skill contract. Static check only for now:

Run: `node --check scripts/apps/import-wizard.mjs && node --check scripts/integrations/doc-sources.mjs && npm test`
Expected: syntax OK, unit suite PASS. (The wizard is exercised end-to-end in Task 10.)

- [ ] **Step 7: Commit**

```bash
git add scripts/integrations/doc-sources.mjs scripts/apps/import-wizard.mjs \
  templates/import/wizard.hbs templates/hub/header.hbs \
  scripts/apps/hub/campaign-hub.mjs lang/en.json
git commit -m "feat: import wizard UI with doc-source registry and hub entry point"
```

---

### Task 8: Import creation flow (group, pages, images, timepoints)

**Files:**
- Modify: `scripts/apps/import-wizard.mjs`

**Interfaces:**
- Consumes: `buildImportPlan` (Task 4), `createGroup` (`scripts/data/groups.mjs`), `Timepoints.addTimepoint/attachRecord/addLink` (`scripts/data/timepoints.mjs`), `typeId` (constants), wizard `_readForm()` (Task 7).
- Produces: working end-to-end import — replaces the Task 7 `#onCreate` stub.

- [ ] **Step 1: Implement image extraction and creation**

In `scripts/apps/import-wizard.mjs`, add imports:

```js
import { buildImportPlan } from "../logic/doc-import.mjs";
import { createGroup } from "../data/groups.mjs";
import * as Timepoints from "../data/timepoints.mjs";
```

Add module-level helpers (below the class):

```js
function dataUriToFile(uri, basename) {
  const match = uri.match(/^data:(image\/(\w+));base64,(.+)$/);
  if (!match) return null;
  const bytes = Uint8Array.from(atob(match[3]), (c) => c.charCodeAt(0));
  const ext = match[2] === "jpeg" ? "jpg" : match[2];
  return new File([bytes], `${basename}.${ext}`, { type: match[1] });
}

/**
 * Upload data-URI images (mammoth inlines docx images) to the user data dir
 * and rewrite srcs. On any failure the import proceeds without images.
 */
async function uploadDataUriImages(html, slug, warnings) {
  if (!html?.includes("data:image")) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const images = [...doc.body.querySelectorAll('img[src^="data:"]')];
  if (!images.length) return html;
  const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
  const dir = `campaign-record-imports/${slug}`;
  try {
    await FilePickerImpl.browse("data", dir)
      .catch(() => FilePickerImpl.createDirectory("data", dir));
    let n = 0;
    for (const img of images) {
      const file = dataUriToFile(img.src, `import-${Date.now()}-${++n}`);
      const result = file && await FilePickerImpl.upload("data", dir, file, {}, { notify: false });
      if (result?.path) img.setAttribute("src", result.path);
      else img.remove();
    }
  } catch (error) {
    console.warn("campaign-record | image upload failed; importing without images", error);
    for (const img of images) img.remove();
    warnings.push(game.i18n.localize("CAMPAIGNRECORD.Import.ImagesDropped"));
  }
  return doc.body.innerHTML;
}
```

- [ ] **Step 2: Replace the `#onCreate` stub**

```js
  // Spec deviation, deliberate: unparseable session dates are surfaced as a
  // missing date next to the timepoint checkbox in the review table rather
  // than as a post-import warning notification.
  static async #onCreate(event, target) {
    const { rows, groupId, groupName } = this._readForm();
    let plan;
    try {
      plan = buildImportPlan(this.state.sections, rows, RECORD_TYPES);
    } catch (error) {
      console.error("campaign-record | import plan failed", error);
      return ui.notifications.error(game.i18n.localize("CAMPAIGNRECORD.Import.ParseError"));
    }
    if (!plan.pages.length) {
      return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Import.NothingToImport"));
    }
    target.disabled = true;

    const group = groupId
      ? game.journal.get(groupId)
      : await createGroup(groupName || this.state.docTitle || "Imported Document");
    if (!group) return;

    const slug = group.name.slugify({ strict: true }) || "import";
    for (const page of plan.pages) {
      page.html = await uploadDataUriImages(page.html, slug, plan.warnings);
    }

    const payload = plan.pages.map((p) => p.type === "text"
      ? { name: p.name, type: "text",
          text: { content: p.html, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML } }
      : { name: p.name, type: typeId(p.type), system: { description: p.html } });
    const created = await group.createEmbeddedDocuments("JournalEntryPage", payload);

    let timepoints = 0;
    for (let i = 0; i < plan.pages.length; i++) {
      if (!plan.pages[i].timepoint) continue;
      const tp = await Timepoints.addTimepoint(group, plan.pages[i].timepoint);
      const page = created[i];
      // Text pages have no system.timepoints; they attach as document links.
      if (page?.system?.schema?.fields?.timepoints) await Timepoints.attachRecord(page, tp.id);
      else if (page) await Timepoints.addLink(group, tp.id, {
        uuid: page.uuid, name: page.name, type: "JournalEntryPage"
      });
      timepoints++;
    }

    ui.notifications.info(game.i18n.format("CAMPAIGNRECORD.Import.Created", {
      pages: created.length, timepoints, group: group.name
    }));
    for (const warning of plan.warnings) ui.notifications.warn(warning, { console: false });
    this.close();
    group.sheet.render(true);
  }
```

- [ ] **Step 3: Static check + unit suite**

Run: `node --check scripts/apps/import-wizard.mjs && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/apps/import-wizard.mjs
git commit -m "feat: import creation - group, pages, uploaded images, timepoints"
```

---

### Task 9: Export dialog, docx rendering, and wiring

**Files:**
- Create: `scripts/apps/export-dialog.mjs`
- Modify: `scripts/apps/hub/campaign-hub.mjs`, `templates/hub/header.hbs`, `scripts/sheets/base-record-sheet.mjs`, `lang/en.json`

**Interfaces:**
- Consumes: `snapshotToDocModel`, `replaceUuidTags` (Tasks 5–6), `loadVendorGlobal` (Task 1), `Timepoints.getTimepoints/recordsAtTimepoint/resolveLinks`, `isRecordVisible` (`scripts/logic/visibility.mjs`), `typeId`/`RECORD_TYPES`.
- Produces: `exportGroupDialog(group)` and `exportRecordDialog(page)`, both showing the GM toggle (GMs only) and downloading a `.docx`.

- [ ] **Step 1: Add the i18n strings**

In `lang/en.json`, add inside `"CAMPAIGNRECORD"`:

```json
"Export": {
  "GroupButton": "Export Group",
  "RecordControl": "Export to Word",
  "Title": "Export to Word",
  "IncludeGM": "Include GM content (hidden records, GM notes)",
  "GoogleHint": "To turn this into a Google Doc, drag the downloaded file into drive.google.com — it converts automatically.",
  "Download": "Download .docx",
  "Timeline": "Timeline",
  "GmNotes": "GM Notes",
  "SelectGroup": "Select a specific group to export.",
  "Failed": "Export failed — see the console for details.",
  "Done": "Exported \"{name}\"."
}
```

- [ ] **Step 2: Create the export module**

Create `scripts/apps/export-dialog.mjs`:

```js
import { MODULE_ID, RECORD_TYPES, typeId } from "../constants.mjs";
import { snapshotToDocModel, replaceUuidTags } from "../logic/doc-export.mjs";
import { isRecordVisible } from "../logic/visibility.mjs";
import { loadVendorGlobal } from "../integrations/vendor-loader.mjs";
import * as Timepoints from "../data/timepoints.mjs";

const KIND_BY_TYPE = Object.fromEntries(RECORD_TYPES.map((t) => [typeId(t), t]));

function pageSnapshot(page) {
  const kind = KIND_BY_TYPE[page.type] ?? (page.type === "text" ? "text" : null);
  if (!kind) return null; // other core page types (image/pdf/video) are not exported
  return {
    name: page.name,
    kind,
    hidden: page.system?.hidden === true,
    system: kind === "text" ? null : page.system.toObject(),
    html: kind === "text" ? (page.text?.content ?? "") : (page.system.description ?? "")
  };
}

function groupSnapshot(group, includeGM) {
  const pages = group.pages.contents
    .filter((p) => includeGM || isRecordVisible(game.user, p))
    .map(pageSnapshot).filter(Boolean);
  const timeline = Timepoints.getTimepoints(group).map((tp) => ({
    label: tp.label,
    items: [
      ...Timepoints.recordsAtTimepoint(group, tp.id, game.user).map((p) => p.name),
      ...Timepoints.resolveLinks(tp, game.user).map((l) => l.name).filter(Boolean)
    ]
  }));
  return { name: group.name, timeline, records: pages };
}

/** Prompt for options and export a whole group. */
export async function exportGroupDialog(group) {
  const includeGM = await promptOptions(group.name);
  if (includeGM === null) return;
  await runExport(() => groupSnapshot(group, includeGM), includeGM, group.name);
}

/** Prompt for options and export a single record page. */
export async function exportRecordDialog(page) {
  const includeGM = await promptOptions(page.name);
  if (includeGM === null) return;
  const snapshot = pageSnapshot(page);
  if (!snapshot) return;
  await runExport(
    () => ({ name: page.name, timeline: null, records: [snapshot] }),
    includeGM, page.name
  );
}

async function promptOptions(name) {
  const gmToggle = game.user.isGM
    ? `<div class="form-group"><label>
        <input type="checkbox" name="includeGM">
        ${game.i18n.localize("CAMPAIGNRECORD.Export.IncludeGM")}</label></div>`
    : "";
  return foundry.applications.api.DialogV2.prompt({
    window: { title: "CAMPAIGNRECORD.Export.Title" },
    content: `<p><strong>${foundry.utils.escapeHTML(name)}</strong></p>${gmToggle}
      <p class="hint">${game.i18n.localize("CAMPAIGNRECORD.Export.GoogleHint")}</p>`,
    ok: {
      label: "CAMPAIGNRECORD.Export.Download",
      callback: (event, button) => button.form.elements.includeGM?.checked === true
    },
    rejectClose: false
  }).then((result) => (result === undefined || result === null ? null : result));
}

async function runExport(buildSnapshot, includeGM, name) {
  try {
    const nodes = snapshotToDocModel(buildSnapshot(), {
      includeGM,
      parse: (html) => new DOMParser().parseFromString(replaceUuidTags(html), "text/html").body,
      i18n: (k) => game.i18n.localize(k)
    });
    const blob = await renderDocx(nodes);
    downloadBlob(blob, `${name.slugify({ strict: true }) || "campaign-record"}.docx`);
    ui.notifications.info(game.i18n.format("CAMPAIGNRECORD.Export.Done", { name }));
  } catch (error) {
    console.error("campaign-record | export failed", error);
    ui.notifications.error(game.i18n.localize("CAMPAIGNRECORD.Export.Failed"));
  }
}

/** Fetch an image and measure it; null on any failure (caption fallback). */
async function fetchImage(src) {
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const bitmap = await createImageBitmap(new Blob([buffer]));
    const scale = Math.min(1, 480 / bitmap.width);
    const ext = src.split("?")[0].split(".").pop()?.toLowerCase();
    return {
      data: buffer,
      type: ext === "jpeg" ? "jpg" : (["png", "jpg", "gif", "bmp"].includes(ext) ? ext : "png"),
      width: Math.round(bitmap.width * scale),
      height: Math.round(bitmap.height * scale)
    };
  } catch {
    return null;
  }
}

async function renderDocx(nodes) {
  const docx = await loadVendorGlobal("docx.iife.js", "docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink,
    Table, TableRow, TableCell, ImageRun, WidthType } = docx;

  const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

  const toRuns = (runs) => runs.map((r) => {
    const run = new TextRun({
      text: r.text, bold: r.bold, italics: r.italics,
      underline: r.underline ? {} : undefined, strike: r.strike
    });
    return r.link ? new ExternalHyperlink({ children: [run], link: r.link }) : run;
  });

  const children = [];
  for (const node of nodes) {
    if (node.kind === "heading") {
      children.push(new Paragraph({ text: node.text, heading: HEADINGS[node.level - 1] }));
    } else if (node.kind === "paragraph") {
      children.push(new Paragraph({
        children: toRuns(node.runs),
        style: node.style === "subtitle" ? "IntenseQuote" : undefined
      }));
    } else if (node.kind === "list") {
      for (const item of node.items) {
        children.push(new Paragraph({
          children: toRuns(item.runs),
          bullet: node.ordered ? undefined : { level: item.level },
          numbering: node.ordered ? { reference: "cr-numbered", level: item.level } : undefined
        }));
      }
    } else if (node.kind === "table") {
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: node.rows.map((cells) => new TableRow({
          children: cells.map((runs) => new TableCell({
            children: [new Paragraph({ children: toRuns(runs) })]
          }))
        }))
      }));
    } else if (node.kind === "image") {
      const image = await fetchImage(node.src);
      if (image) {
        children.push(new Paragraph({
          children: [new ImageRun({
            type: image.type, data: image.data,
            transformation: { width: image.width, height: image.height }
          })]
        }));
        if (node.caption) children.push(new Paragraph({
          children: [new TextRun({ text: node.caption, italics: true })]
        }));
      } else {
        children.push(new Paragraph({
          children: [new TextRun({
            text: node.caption || node.src.split("/").pop(), italics: true
          })]
        }));
      }
    }
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: "cr-numbered",
        levels: [0, 1, 2].map((level) => ({
          level, format: "decimal", text: `%${level + 1}.`, alignment: "left"
        }))
      }]
    },
    sections: [{ children }]
  });
  return Packer.toBlob(doc);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
```

- [ ] **Step 3: Wire the Hub export button**

In `templates/hub/header.hbs`, next to the import button:

```handlebars
  <button type="button" data-action="exportGroup" data-tooltip="CAMPAIGNRECORD.Export.GroupButton">
    <i class="fa-solid fa-file-word"></i>
  </button>
```

In `scripts/apps/hub/campaign-hub.mjs`:
- Import: `import { exportGroupDialog } from "../export-dialog.mjs";`
- Action: `exportGroup: CampaignHub.#onExportGroup,`
- Handler:

```js
  static async #onExportGroup() {
    const group = game.journal.get(this.state.groupId);
    if (!group) return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Export.SelectGroup"));
    await exportGroupDialog(group);
  }
```

- [ ] **Step 4: Wire the record-sheet header control**

In `scripts/sheets/base-record-sheet.mjs`:
- Import: `import { exportRecordDialog } from "../apps/export-dialog.mjs";`
- In `DEFAULT_OPTIONS`, add a `window` entry and action:

```js
  static DEFAULT_OPTIONS = {
    classes: ["campaign-record", "record-sheet"],
    form: { submitOnChange: true, closeOnSubmit: false },
    window: {
      controls: [{
        icon: "fa-solid fa-file-word",
        label: "CAMPAIGNRECORD.Export.RecordControl",
        action: "exportRecord"
      }]
    },
    actions: {
      toggleHidden: BaseRecordSheet.#onToggleHidden,
      linkActor: BaseRecordSheet.#onLinkActor,
      exportRecord: BaseRecordSheet.#onExportRecord
    }
  };
```

- Handler next to `#onToggleHidden`:

```js
  static async #onExportRecord() {
    await exportRecordDialog(this.document);
  }
```

- [ ] **Step 5: Static check + unit suite**

Run: `node --check scripts/apps/export-dialog.mjs && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/apps/export-dialog.mjs scripts/apps/hub/campaign-hub.mjs \
  templates/hub/header.hbs scripts/sheets/base-record-sheet.mjs lang/en.json
git commit -m "feat: docx export dialog with GM toggle, hub and sheet entry points"
```

---

### Task 10: E2E fixture + import spec

**Files:**
- Create: `tests/e2e/fixtures/adventure-notes.docx`
- Create: `tests/e2e/21-import-export.spec.mjs`

**Interfaces:**
- Consumes: e2e helpers (`tests/e2e/helpers/foundry.mjs`: `login`, `deleteGroupsByPrefix`), wizard DOM (Task 7), `foundry-e2e` skill contract.
- Produces: the fixture file Task 11 reuses.

- [ ] **Step 1: Obtain the fixture**

The fixture is the real test Google Doc exported as `.docx`:

```bash
mkdir -p tests/e2e/fixtures
curl -sSL -o tests/e2e/fixtures/adventure-notes.docx \
  "https://docs.google.com/document/d/1Zh8JtPMWwzE-QVpwv31unK9tfwhCmJJ0Hlr12e0gqOU/export?format=docx"
```

If the curl result is an HTML sign-in page instead of a docx (file < 20 KB or `file` says HTML), the doc isn't link-shared: the **orchestrating session downloads it via its connected Google Drive tooling** and places it at the same path. Verify either way:

Run: `file tests/e2e/fixtures/adventure-notes.docx && unzip -l tests/e2e/fixtures/adventure-notes.docx | grep -c document.xml`
Expected: `Microsoft Word 2007+` (or `Zip archive`) and at least 1.

- [ ] **Step 2: Write the import e2e test**

Create `tests/e2e/21-import-export.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { login, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "adventure-notes.docx");

test.describe("import and export", () => {
  let gmPage;

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(gmPage, "E2E Import");
    await gmPage.close();
  });

  test("GM imports the adventure-notes docx through the wizard", async () => {
    await gmPage.evaluate(async () => {
      const { ImportWizard } = await import("/modules/campaign-record/scripts/apps/import-wizard.mjs");
      ImportWizard.open();
    });
    const wizard = gmPage.locator("#campaign-record-import");
    await wizard.waitFor({ timeout: 15_000 });

    await wizard.locator('[data-source-id="docx-file"] input[type="file"]').setInputFiles(FIXTURE);

    // Review step: the doc has ~33 session blocks plus list/table sections.
    const rows = wizard.locator("table.import-sections tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(30);

    // Session rows come pre-checked for timepoints with parsed dates.
    await expect(wizard.locator('input[name="timepoint-1"]')).toBeChecked();

    // New group with an E2E-prefixed name; retype one section to a record type.
    await wizard.locator('input[name="group-name"]').fill("E2E Import Adventure");
    await wizard.locator('select[name="type-0"]').selectOption("place");

    await wizard.locator('[data-action="createImport"]').click();
    await wizard.waitFor({ state: "detached", timeout: 60_000 });

    const summary = await gmPage.evaluate(() => {
      const group = game.journal.find((j) => j.name === "E2E Import Adventure");
      if (!group) return null;
      return {
        pages: group.pages.size,
        placePages: group.pages.filter((p) => p.type === "campaign-record.place").length,
        timepoints: (group.getFlag("campaign-record", "group")?.timepoints ?? []).length
      };
    });
    expect(summary).not.toBeNull();
    expect(summary.pages).toBeGreaterThanOrEqual(30);
    expect(summary.placePages).toBeGreaterThanOrEqual(1);
    expect(summary.timepoints).toBeGreaterThanOrEqual(25);
  });
});
```

- [ ] **Step 3: Run the spec**

Follow the `foundry-e2e` skill (read `.claude/skills/foundry-e2e/SKILL.md` first; never manage the server or symlink by hand; stop and report if the env lock names a foreign holder):

Run: `npx playwright test tests/e2e/21-import-export.spec.mjs`
Expected: PASS. If the section/timepoint counts are off by a few, inspect the wizard rows in the failure trace and adjust the thresholds to the fixture's true counts — the assertions pin behavior, not exact numerology; keep them `>=` style.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/fixtures/adventure-notes.docx tests/e2e/21-import-export.spec.mjs
git commit -m "test: e2e import of the adventure-notes fixture through the wizard"
```

---

### Task 11: E2E export test

**Files:**
- Modify: `tests/e2e/21-import-export.spec.mjs`

**Interfaces:**
- Consumes: export dialog DOM (Task 9), `createGroupWithPage` helper (`tests/e2e/helpers/foundry.mjs`), macOS/Linux `unzip` on the test host.

- [ ] **Step 1: Add the export test**

Append inside the `test.describe` block (add `createGroupWithPage` to the helper import, plus at top of file: `import { execFileSync } from "node:child_process";`):

```js
  test("GM exports a group with and without GM content", async () => {
    // Build a small group: one NPC with gmNotes, one hidden NPC.
    await gmPage.evaluate(async () => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const group = await createGroup("E2E Import ExportSrc");
      await group.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Export Verity", type: "campaign-record.npc",
          system: { role: "Captain", description: "<p>A stern captain.</p>",
            gmNotes: "<p>secretly a dragon</p>" } },
        { name: "E2E Export Hidden", type: "campaign-record.npc",
          system: { hidden: true, description: "<p>shh</p>" } }
      ]);
    });

    const exportOnce = async (includeGM) => {
      await gmPage.evaluate(async () => {
        const { exportGroupDialog } = await import("/modules/campaign-record/scripts/apps/export-dialog.mjs");
        const group = game.journal.find((j) => j.name === "E2E Import ExportSrc");
        exportGroupDialog(group); // no await: the dialog blocks until submitted
      });
      const dialog = gmPage.locator('dialog, .application.dialog').last();
      await dialog.waitFor({ timeout: 10_000 });
      if (includeGM) await dialog.locator('input[name="includeGM"]').check();
      const downloadPromise = gmPage.waitForEvent("download", { timeout: 30_000 });
      await dialog.locator('button[data-action="ok"]').click();
      const download = await downloadPromise;
      const file = test.info().outputPath(`export-${includeGM ? "gm" : "player"}.docx`);
      await download.saveAs(file);
      return execFileSync("unzip", ["-p", file, "word/document.xml"], { encoding: "utf8" });
    };

    const playerXml = await exportOnce(false);
    expect(playerXml).toContain("E2E Export Verity");
    expect(playerXml).toContain("A stern captain.");
    expect(playerXml).toContain("Campaign Record type: npc");
    expect(playerXml).not.toContain("secretly a dragon");
    expect(playerXml).not.toContain("E2E Export Hidden");

    const gmXml = await exportOnce(true);
    expect(gmXml).toContain("secretly a dragon");
    expect(gmXml).toContain("E2E Export Hidden");
  });
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test tests/e2e/21-import-export.spec.mjs`
Expected: both tests PASS. Word wraps text in XML runs, so `toContain` on phrases can fail if docx splits runs mid-phrase — if that happens, strip tags first: `playerXml.replace(/<[^>]+>/g, "")` and assert on that string instead.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/21-import-export.spec.mjs
git commit -m "test: e2e export with GM-content toggle verified inside the docx"
```

---

### Task 12: Docs, full suites, wrap-up

**Files:**
- Modify: `README.md`, `docs/manual-test-checklist.md`

- [ ] **Step 1: Document the feature**

In `README.md` **Features** list add:

```markdown
- **Word / Google Docs import & export**: import a `.docx` (or a Google Doc
  downloaded as one) through a review wizard that splits it into sections,
  assigns record types, and builds timeline timepoints from dated session
  headers; export any group or single record to a native `.docx` that
  converts cleanly when dragged into Google Drive. GM-only content is
  exported only when a GM opts in.
```

In `README.md` **Usage**, after the Campaign Hub bullet add:

```markdown
- To import a document: open the Campaign Hub and click the **Import
  Document** button (visible with the Create Journal Entries permission).
  For a Google Doc, first use **File → Download → Microsoft Word (.docx)**
  in Google Docs. Review the detected sections, pick types, then import.
- To export: click **Export Group** in the Campaign Hub (with a specific
  group selected), or **Export to Word** in a record sheet's window menu.
  Drag the downloaded file into drive.google.com to get a Google Doc.
```

In `docs/manual-test-checklist.md` add a short "Import/Export" section:

```markdown
## Import / Export

- [ ] Hub → Import Document → pick a .docx: sections listed with sensible
      suggested types; dated sessions pre-checked as timepoints.
- [ ] Import into a NEW group and an EXISTING group.
- [ ] Skip and Merge rows behave; empty sections default to Skip.
- [ ] Imported images appear in descriptions (GM with upload permission).
- [ ] Export Group as player view: no hidden records, no GM notes.
- [ ] Export Group with "Include GM content": both present.
- [ ] Export single record from its sheet menu.
- [ ] Exported .docx opens in Word/Pages and converts in Google Drive.
- [ ] Re-import an exported group docx: types pre-suggested from markers.
```

- [ ] **Step 2: Run everything**

Run: `npm test`
Expected: all unit suites PASS.

Run: `npm run test:e2e`
Expected: full e2e suite PASS (serial, real Foundry server — budget ~10+ minutes; follow the foundry-e2e contract; run once, at the end).

- [ ] **Step 3: Commit**

```bash
git add README.md docs/manual-test-checklist.md
git commit -m "docs: import/export usage and manual test checklist"
```

- [ ] **Step 4: Push and open a draft PR**

```bash
git push -u origin feature/docx-import-export
gh pr create --draft --title "docx / Google Docs import & export" --body "$(cat <<'EOF'
Import a .docx (incl. Google Docs downloads) into a campaign group via a
review wizard; export groups/records to native .docx with a GM-content
toggle. Spec: docs/superpowers/specs/2026-07-09-docx-import-export-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

