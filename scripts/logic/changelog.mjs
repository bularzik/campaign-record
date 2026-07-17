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
