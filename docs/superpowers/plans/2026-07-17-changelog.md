# Auto-Generated Changelog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A committed `CHANGELOG.md` generated from conventional commits (all 22 released versions and every future one), linked from `module.json`'s `changelog` attribute, packaged in the release zip, and gated by the release workflow and a vitest meta-test.

**Architecture:** Pure classification/formatting logic in `scripts/logic/changelog.mjs` (vitest-tested, no git IO); a thin dev-only generator `tools/generate-changelog.mjs` that walks git tags and writes `CHANGELOG.md`; workflow/metadata edits that package and enforce it.

**Tech Stack:** Node (no dependencies), vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-07-17-changelog-design.md`

## Global Constraints

- Pure logic in `scripts/logic/*.mjs` has **no Foundry globals and no IO** — vitest-testable. The generator lives in `tools/` (a new top-level dir), NOT `scripts/`, because `release.yml` zips `scripts` recursively and the generator must not ship.
- Changelog format: title `# Campaign Record Changelog`; intro citing Keep a Changelog + Semantic Versioning; entries newest-first as `## [X.Y.Z] - YYYY-MM-DD`; subsections only when non-empty, in the fixed order `Breaking`, `Added`, `Changed`, `Fixed`; a version with zero qualifying commits gets the single bullet `- Maintenance release.`
- Commit mapping: `feat` → Added; `fix` → Fixed; `perf`/`refactor` → Changed; `!` before the colon (any type) → Breaking. All other conventional types (`chore`, `docs`, `test`, `ci`, `style`, `build`, anything unmapped) → skipped. **Plan refinement (surveyed from real history):** non-conventional subjects ending in a PR reference `(#N)` are squash-merged feature PRs and are included — `Fixed` when the subject starts with "fix" (case-insensitive), else `Added`; other non-conventional subjects are skipped.
- `module.json` gains exactly: `"changelog": "https://raw.githubusercontent.com/bularzik/campaign-record/main/CHANGELOG.md"`.
- `CHANGELOG.md` is committed and regenerated via `npm run changelog`; never hand-edited.
- Run unit tests with `npx vitest run` (full suite before each commit).
- Commits use conventional style and end with the line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No Playwright/e2e involvement anywhere in this plan.

---

### Task 1: Pure logic — classify, format, compare

**Files:**
- Create: `scripts/logic/changelog.mjs`
- Test: `tests/changelog.test.js` (new)

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 2-3):
  - `classifyCommit(subject)` → `{ section: "Breaking"|"Added"|"Changed"|"Fixed", scope: string|null, description: string }` or `null` (skipped). Description and PR-title subjects come back first-letter-capitalized.
  - `formatVersionEntry({ version, date, commits })` → markdown string (no trailing blank line management needed by callers; ends with a single `\n`).
  - `formatChangelog(entries)` → full document string; `entries` are `{version, date, commits}` in ASCENDING version order (oldest first) — the function renders newest-first.
  - `compareSemver(a, b)` → negative/zero/positive for `"1.2.10"`-style strings, numeric per part.

- [ ] **Step 1: Write the failing tests**

Create `tests/changelog.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  classifyCommit, formatVersionEntry, formatChangelog, compareSemver
} from "../scripts/logic/changelog.mjs";

describe("classifyCommit", () => {
  it("maps conventional types to sections", () => {
    expect(classifyCommit("feat: pure routing for hub media drops"))
      .toEqual({ section: "Added", scope: null, description: "Pure routing for hub media drops" });
    expect(classifyCommit("fix: scroll import review list so buttons stay reachable"))
      .toEqual({ section: "Fixed", scope: null, description: "Scroll import review list so buttons stay reachable" });
    expect(classifyCommit("refactor: extract fileMediaToTimepoint").section).toBe("Changed");
    expect(classifyCommit("perf: debounce search index").section).toBe("Changed");
  });
  it("preserves scopes", () => {
    expect(classifyCommit("fix(release): package vendor/ bundles (#24)"))
      .toEqual({ section: "Fixed", scope: "release", description: "Package vendor/ bundles (#24)" });
    expect(classifyCommit("feat(import): merge and split sections").scope).toBe("import");
  });
  it("a ! before the colon marks Breaking for any type", () => {
    expect(classifyCommit("feat!: drop v12 support").section).toBe("Breaking");
    expect(classifyCommit("fix(data)!: rewrite flags").section).toBe("Breaking");
  });
  it("skips non-release conventional types", () => {
    expect(classifyCommit("chore: bump version to 1.2.5")).toBeNull();
    expect(classifyCommit("docs: implementation plan for changelog")).toBeNull();
    expect(classifyCommit("test(quench): fix stale assertion")).toBeNull();
    expect(classifyCommit("ci: tighten release gate")).toBeNull();
    expect(classifyCommit("style: reformat css")).toBeNull();
    expect(classifyCommit("build: pin node version")).toBeNull();
  });
  it("includes squash-merged PR titles, Fixed when they start with fix", () => {
    expect(classifyCommit("Auto-capture GM-shared media onto the timeline (#17)"))
      .toEqual({ section: "Added", scope: null, description: "Auto-capture GM-shared media onto the timeline (#17)" });
    expect(classifyCommit("Fix drag-and-drop; unify timeline attachments on links (#16)").section)
      .toBe("Fixed");
  });
  it("skips other non-conventional subjects", () => {
    expect(classifyCommit("Initial commit")).toBeNull();
    expect(classifyCommit("Add Phase 2 (Campaign Hub) implementation plan")).toBeNull();
    expect(classifyCommit("")).toBeNull();
  });
});

describe("formatVersionEntry", () => {
  it("renders non-empty sections in fixed order with scoped bullets", () => {
    const entry = formatVersionEntry({
      version: "1.3.0",
      date: "2026-07-17",
      commits: [
        { section: "Fixed", scope: "release", description: "Package vendor/ bundles (#24)" },
        { section: "Added", scope: null, description: "Drag-and-drop media upload (#25)" },
        { section: "Breaking", scope: null, description: "Drop v12 support" }
      ]
    });
    expect(entry).toBe(
`## [1.3.0] - 2026-07-17

### Breaking

- Drop v12 support

### Added

- Drag-and-drop media upload (#25)

### Fixed

- **Release:** Package vendor/ bundles (#24)
`);
  });
  it("renders a maintenance bullet when no commits qualify", () => {
    expect(formatVersionEntry({ version: "1.2.3", date: "2026-07-11", commits: [] })).toBe(
`## [1.2.3] - 2026-07-11

- Maintenance release.
`);
  });
});

describe("formatChangelog", () => {
  it("renders title, intro, and entries newest-first from ascending input", () => {
    const doc = formatChangelog([
      { version: "1.0.0", date: "2026-07-09", commits: [] },
      { version: "1.1.0", date: "2026-07-10", commits: [{ section: "Added", scope: null, description: "Hub inline edit" }] }
    ]);
    expect(doc.startsWith("# Campaign Record Changelog\n")).toBe(true);
    expect(doc).toContain("[Keep a Changelog]");
    expect(doc).toContain("[Semantic Versioning]");
    expect(doc.indexOf("## [1.1.0]")).toBeLessThan(doc.indexOf("## [1.0.0]"));
  });
});

describe("compareSemver", () => {
  it("compares numerically per part", () => {
    expect(compareSemver("1.2.10", "1.2.9")).toBeGreaterThan(0);
    expect(compareSemver("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareSemver("1.3.0", "1.3.0")).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/changelog.test.js`
Expected: FAIL — module `scripts/logic/changelog.mjs` does not exist.

- [ ] **Step 3: Implement**

Create `scripts/logic/changelog.mjs`:

```js
/**
 * Pure changelog generation logic: conventional-commit classification and
 * Keep a Changelog formatting. No Foundry globals, no IO — unit-tested
 * with vitest. The git-walking generator lives in tools/generate-changelog.mjs.
 */

const SECTION_BY_TYPE = { feat: "Added", fix: "Fixed", perf: "Changed", refactor: "Changed" };
const SECTION_ORDER = ["Breaking", "Added", "Changed", "Fixed"];

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Classify one commit subject. Conventional subjects map by type (feat →
 * Added, fix → Fixed, perf/refactor → Changed; `!` → Breaking); unmapped
 * types (chore, docs, test, ci, style, build, …) are skipped. Plain
 * subjects ending in a PR reference "(#N)" are squash-merged PRs and are
 * kept — Fixed when they start with "fix", else Added. Everything else is
 * skipped. Returns null for skipped subjects.
 */
export function classifyCommit(subject) {
  const m = /^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/.exec(subject ?? "");
  if (m) {
    const [, type, scope, bang, description] = m;
    const section = bang ? "Breaking" : SECTION_BY_TYPE[type];
    if (!section) return null;
    return { section, scope: scope ?? null, description: capitalize(description) };
  }
  if (/\(#\d+\)$/.test(subject ?? "")) {
    return {
      section: /^fix/i.test(subject) ? "Fixed" : "Added",
      scope: null,
      description: capitalize(subject)
    };
  }
  return null;
}

/** One version's markdown block: header, then non-empty sections in fixed order. */
export function formatVersionEntry({ version, date, commits }) {
  const lines = [`## [${version}] - ${date}`];
  if (!commits.length) {
    lines.push("", "- Maintenance release.");
    return lines.join("\n") + "\n";
  }
  for (const section of SECTION_ORDER) {
    const rows = commits.filter((c) => c.section === section);
    if (!rows.length) continue;
    lines.push("", `### ${section}`, "");
    for (const { scope, description } of rows) {
      lines.push(scope ? `- **${capitalize(scope)}:** ${description}` : `- ${description}`);
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * Full document. `entries` arrive in ASCENDING version order (the natural
 * tag-walk order); the document renders newest-first.
 */
export function formatChangelog(entries) {
  const header =
`# Campaign Record Changelog

All notable changes to this project are documented in this file. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
`;
  const body = [...entries].reverse().map(formatVersionEntry).join("\n");
  return `${header}\n${body}`;
}

/** Numeric per-part comparison of "1.2.10"-style version strings. */
export function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}
```

- [ ] **Step 4: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS (all files).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/changelog.mjs tests/changelog.test.js
git commit -m "feat: pure changelog classification and formatting logic

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Generator script + generated CHANGELOG.md

**Files:**
- Create: `tools/generate-changelog.mjs`
- Modify: `package.json` (add `"changelog"` to `scripts`)
- Create (generated): `CHANGELOG.md`

**Interfaces:**
- Consumes: `classifyCommit`, `formatChangelog`, `compareSemver` from `scripts/logic/changelog.mjs` (Task 1 signatures).
- Produces: `npm run changelog` regenerates `CHANGELOG.md` at the repo root, covering every `v*.*.*` tag. Task 3's meta-test reads the committed file.

- [ ] **Step 1: Write the generator**

Create `tools/generate-changelog.mjs`:

```js
#!/usr/bin/env node
/**
 * Regenerate CHANGELOG.md from git tags and conventional commit subjects.
 * Dev-only (not shipped in the module zip). Run from the repo root:
 *   npm run changelog
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { classifyCommit, formatChangelog, compareSemver } from "../scripts/logic/changelog.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const tags = git("tag")
  .split("\n")
  .filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
  .sort((a, b) => compareSemver(a.slice(1), b.slice(1)));

if (!tags.length) {
  console.error("No release tags (vX.Y.Z) found; refusing to write an empty changelog.");
  process.exit(1);
}

const entries = tags.map((tag, i) => {
  const range = i === 0 ? tag : `${tags[i - 1]}..${tag}`;
  const subjects = git("log", "--no-merges", "--format=%s", range).split("\n").filter(Boolean);
  return {
    version: tag.slice(1),
    date: git("log", "-1", "--format=%cs", `${tag}^{commit}`),
    commits: subjects.map(classifyCommit).filter(Boolean)
  };
});

const outPath = new URL("../CHANGELOG.md", import.meta.url);
writeFileSync(outPath, formatChangelog(entries));
console.log(`Wrote CHANGELOG.md with ${entries.length} version entries.`);
```

- [ ] **Step 2: Add the npm script**

In `package.json`, inside `"scripts"`, add (comma-placement per the existing entries):

```json
"changelog": "node tools/generate-changelog.mjs"
```

- [ ] **Step 3: Generate and inspect**

Run: `npm run changelog`
Expected: `Wrote CHANGELOG.md with 22 version entries.`

Then inspect the output — this is a review step, not a formality:
- `head -40 CHANGELOG.md` — title/intro present; first entry is `## [1.3.0] - 2026-07-17`.
- `grep -c "^## \[" CHANGELOG.md` — expected `22`.
- Skim the whole file for mis-parsed subjects (garbled bullets, obviously-noise entries). If a parsing rule needs adjusting, fix it in `scripts/logic/changelog.mjs` WITH a new unit test, re-run `npx vitest run`, and regenerate — never hand-edit `CHANGELOG.md`.
- Spot-check one squash-merged release: `grep -A6 "^## \[1.2.11\]" CHANGELOG.md` should show a real feature bullet (a PR-title subject), not `- Maintenance release.` (verify against `git log --no-merges --format=%s v1.2.10..v1.2.11` if unsure).

- [ ] **Step 4: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/generate-changelog.mjs package.json CHANGELOG.md
git commit -m "feat: changelog generator and generated 22-version history

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: module.json link, release packaging + gate, sync meta-test

**Files:**
- Modify: `module.json` (add `changelog` attribute)
- Modify: `.github/workflows/release.yml` (gate step, zip list, verify array)
- Test: `tests/changelog.test.js` (append the sync meta-test)

**Interfaces:**
- Consumes: `compareSemver` from `scripts/logic/changelog.mjs`; the committed `CHANGELOG.md` from Task 2.
- Produces: user-visible metadata + CI enforcement; no code exports.

- [ ] **Step 1: Write the failing meta-test**

Append to `tests/changelog.test.js` (add `readFileSync` import at the top: `import { readFileSync } from "node:fs";`):

```js
describe("committed changelog state", () => {
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const moduleJson = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
  const headings = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$/gm)].map((m) => m[1]);

  it("module.json links the raw changelog on main", () => {
    expect(moduleJson.changelog).toBe(
      "https://raw.githubusercontent.com/bularzik/campaign-record/main/CHANGELOG.md"
    );
  });
  it("head entry matches module.json version", () => {
    expect(headings[0]).toBe(moduleJson.version);
  });
  it("every ## heading is a well-formed version entry", () => {
    const rawHeadings = changelog.split("\n").filter((l) => l.startsWith("## "));
    expect(rawHeadings.length).toBe(headings.length);
    expect(headings.length).toBeGreaterThanOrEqual(22);
  });
  it("entries are strictly descending by version", () => {
    for (let i = 1; i < headings.length; i++) {
      expect(compareSemver(headings[i - 1], headings[i])).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run to verify the right failure**

Run: `npx vitest run tests/changelog.test.js`
Expected: FAIL on "module.json links the raw changelog on main" (attribute missing). The other three meta-assertions pass against Task 2's committed file.

- [ ] **Step 3: Add the module.json attribute**

In `module.json`, alongside the existing `manifest`/`download` URL fields, add:

```json
"changelog": "https://raw.githubusercontent.com/bularzik/campaign-record/main/CHANGELOG.md",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/changelog.test.js`
Expected: PASS (all).

- [ ] **Step 5: Wire the release workflow**

In `.github/workflows/release.yml`:

(a) After the "Verify tag matches module version" step, insert:

```yaml
      - name: Verify changelog has an entry for this version
        run: |
          version="$(jq -r .version module.json)"
          grep -qE "^## \[${version}\] " CHANGELOG.md \
            || { echo "::error::CHANGELOG.md has no entry for ${version} — run 'npm run changelog' and commit"; exit 1; }
```

(b) In the "Build module archive" step, add `CHANGELOG.md` to the zip list:

```yaml
        run: zip -r module.zip module.json README.md CHANGELOG.md LICENSE scripts templates styles lang vendor
```

(c) In the "Verify required runtime assets are packaged" step, add to the `required` array:

```yaml
            CHANGELOG.md
```

- [ ] **Step 6: Sanity-check the gate locally**

Run: `version="$(jq -r .version module.json)"; grep -qE "^## \[${version}\] " CHANGELOG.md && echo GATE-OK`
Expected: `GATE-OK`

Then confirm the workflow file still parses as YAML — use PyYAML only if it's installed, otherwise eyeball the diff (`git diff .github/workflows/release.yml`) for indentation consistency with the neighboring steps; the three edits are all inside existing list structures.

- [ ] **Step 7: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add module.json .github/workflows/release.yml tests/changelog.test.js
git commit -m "feat: changelog link in module.json, release packaging and gate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
