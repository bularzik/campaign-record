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
