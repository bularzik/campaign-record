import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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
