# Auto-Generated Changelog — Design

**Date:** 2026-07-17
**Status:** Approved for planning

## Summary

Add a `CHANGELOG.md` generated from conventional commits, covering all 22
released versions (v1.0.0 → v1.3.0) and every future release from the same
code path. The file is committed; `module.json` links to it via the
`changelog` attribute (raw GitHub URL); the release workflow packages it and
gates on it being current. Nothing is hand-maintained.

## Components

### 1. Generator script — `tools/generate-changelog.mjs`

Node, no dependencies, dev-only. Lives in a new top-level `tools/`
directory, NOT `scripts/` — `release.yml` zips `scripts` recursively, and
the generator must not ship in the module zip. Run via `npm run changelog`
(new package.json script).

Behavior:
- Read tags: `git tag`, filtered to `^v\d+\.\d+\.\d+$`, sorted ascending by
  semver.
- For each version, collect subjects + dates:
  `git log --no-merges --format=%s <prev>..<tag>` (root→`v1.0.0` for the
  first). Date from `git log -1 --format=%cs <tag>^{commit}` (tag creation
  day ≈ release day; offline).
- Transform through the pure logic module (below) and write `CHANGELOG.md`
  at the repo root, fully regenerated each run.

### 2. Pure logic — `scripts/logic/changelog.mjs`

No Foundry globals, no git IO — vitest-tested per repo convention. Exports:

- `classifyCommit(subject)` → `{ section, scope, description }` or `null`
  (skipped). Mapping: `feat` → `Added`; `fix` → `Fixed`; `perf`, `refactor`
  → `Changed`; a `!` before the colon (any type) → `Breaking`. Skipped:
  `chore`, `docs`, `test`, `ci`, `style`, `build`, subjects that don't parse
  as `type(scope)?!?: description`, and version-bump subjects
  (`chore: bump version…` are already skipped as `chore`). Scope, when
  present, is preserved.
- `formatVersionEntry({ version, date, commits })` → markdown string:
  `## [X.Y.Z] - YYYY-MM-DD`, then only the non-empty subsections in the
  fixed order `Breaking`, `Added`, `Changed`, `Fixed`; bullets are
  `- **Scope:** Description` when a scope exists, else `- Description`
  (first letter capitalized; PR suffixes like `(#25)` kept). A version with
  zero qualifying commits gets the single bullet `- Maintenance release.`
- `formatChangelog(entries)` → full document: title
  `# Campaign Record Changelog`, intro line citing Keep a Changelog and
  Semantic Versioning, entries newest-first.

### 3. `module.json`

Add `"changelog": "https://raw.githubusercontent.com/bularzik/campaign-record/main/CHANGELOG.md"`.
Raw URL on `main` — requires the generated file to be committed (a
workflow-only artifact would 404 there). Foundry surfaces this link in the
module management UI.

### 4. Release workflow — `.github/workflows/release.yml`

- Add `CHANGELOG.md` to the `zip -r` file list.
- Add `CHANGELOG.md` to the `required` array in the verify step.
- New gate step (before packaging, alongside the tag↔version check): fail
  unless `grep -qE "^## \[$(jq -r .version module.json)\]" CHANGELOG.md`.

Release habit becomes: bump version → `npm run changelog` → commit both →
tag. A stale or missing entry fails the release, and the local meta-test
(below) catches it even earlier.

### 5. Tests

- Unit tests for the pure logic (`tests/changelog.test.js` or a dedicated
  file per repo style): classification table (each type, scoped/unscoped,
  breaking `!`, skip list, non-conventional subjects), entry formatting
  (subsection order, empty-section omission, maintenance fallback,
  capitalization), document assembly (newest-first, intro).
- Meta-test in the same file asserting the *committed* state is in sync:
  `CHANGELOG.md` exists; its first `## [` heading equals `module.json`'s
  `version`; all headings match `## [X.Y.Z] - YYYY-MM-DD` and are strictly
  descending by semver; `module.json.changelog` equals the raw main URL.

### 6. Backfill

Running `npm run changelog` once produces the full 22-version history. The
generated file is reviewed for obvious nonsense (mis-parsed subjects) but
not hand-edited — parser fixes go into the logic module so regeneration
stays deterministic.

## Accepted trade-offs

- Bullets read like commit subjects (developer-flavored), not curated
  release prose — inherent to generating from commits.
- History before v1.0.0 (the pre-release phases) is folded into the v1.0.0
  entry (root→v1.0.0 range), which will be long; acceptable for a first
  release entry.
- No commit-body parsing (beyond none — `!` in the subject is the only
  breaking signal), no contributor credits, no Unreleased section.
