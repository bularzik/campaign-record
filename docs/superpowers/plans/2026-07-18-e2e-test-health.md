# E2E Test Health Implementation Plan

> **For agentic workers:** This plan is designed to be split across sessions. Before doing anything, read **Status** below and resume at the first phase not marked complete. Update the Status table (and commit it) at every phase boundary. Each phase is independently shippable; the branch is `test/e2e-health`.

**Goal:** Fix the 4 reliably-failing e2e tests and cut the full-suite wall time from ~16.5 min toward ~7–8 min.

**Architecture:** Four independent phases in priority order: (1) root-cause and fix the failing tests (biggest win — they burn ~6 min of 90s-timeouts and mask real signal), (2) lower default action/expect timeouts so future failures cost seconds not minutes, (3) reuse Foundry login sessions via Playwright storageState to reclaim ~6 min of per-spec login overhead, (4) add a smoke-tier subset for mid-task sanity runs.

**Tech Stack:** Playwright e2e against a live local Foundry v13 server (World B), vitest for any pure-logic changes.

## Status

| Phase | State | Commits | Notes |
|---|---|---|---|
| 1a/1b: hub-record-pane failures | COMPLETE (commit TBD) | TBD | :211 — inline editing defaults on (client setting), so non-markdown text pages are natively inline-editable in view mode and never render the manual edit-toggle button; test needed to disable inlineEditing to exercise the toggle flow. :229 — New Entry dialog's type select now defaults to "Journal" (text) since the 2026-07-17 new-creation-defaults change; test never selected a type, so it created a text page (no system.role) instead of an NPC. |
| 1c: group-hub-sheet failure | NOT STARTED | | |
| 1d: inline-edit ProseMirror failure | NOT STARTED | | |
| 2: timeout caps | NOT STARTED | | |
| 3: storageState login reuse | NOT STARTED | | |
| 4: smoke tier | NOT STARTED | | |
| 5: full-suite verification + PR | NOT STARTED | | |

## Global Constraints

- Working branch: `test/e2e-health` (worktree `.claude/worktrees/e2e-test-health`), based on `f3b47a8` (main after PR #33).
- Every e2e run MUST follow the project skill `.claude/skills/foundry-e2e/SKILL.md` (session lock, symlink ownership, teardown). The server lock is exclusive — never run two e2e invocations in parallel.
- World B environment facts: bbmm module must stay disabled (its changelog modal blocks clicks, fails ~16 specs); Foundry v13.351 local install; combats in v13 default to no scene.
- Fixing product code is in scope when a failing test exposes a product bug; fixes must not change intended behavior without flagging it in the PR.
- `test.fixme()` is the LAST-resort fallback for a failure that resists a session's debugging — always with a comment naming this plan and the failure signature. Prefer real fixes.
- Do not publish a release; this branch ends in a draft PR.

## Baseline Evidence (2026-07-18 full run, 1 worker, wall ~16.5 min)

Per-spec time (failing specs are slow *because* failures burn 90s timeouts twice — once in-run, once you count retries):

| Spec | Tests | Fail | Time |
|---|---|---|---|
| 21-hub-record-pane | 19 | 2 | 240.6s |
| 22-group-hub-sheet | 4 | 1 | 104.2s |
| 18-inline-edit | 6 | 1 | 101.5s |
| next slowest (05-hub) | 5 | 0 | 26.9s |

Sum of measured test time 10.6 min vs 16.5 min wall → ~6 min is per-spec `beforeAll` login/setup overhead (31 spec files, each logging in 1–2 users).

### The 4 failures (all reproduce identically in isolation — NOT flakes)

1. **`tests/e2e/21-hub-record-pane.spec.mjs:211` "text pages view and edit in-pane"** — `locator.click` on `[data-action="toggleEditMode"]` inside `#campaign-hub` times out (90s). Playwright error-context snapshot at failure shows only the Foundry base UI — no `#campaign-hub` content in the accessibility tree (the hub app apparently never renders/mounts for this test).
2. **`tests/e2e/21-hub-record-pane.spec.mjs:229` "new record opens in-pane in edit mode"** — `.record-pane-mount [name="system.role"]` never becomes visible (~21s) after creating a fresh NPC via the "New Entry" dialog. Likely shares a root cause with #1 (same hub/record-pane mount path).
3. **`tests/e2e/22-group-hub-sheet.spec.mjs:67` "a record created into another group opens in this hub's pane in edit mode"** — `locator.selectOption` on the New Entry dialog's `select[name="group"]` times out (90s).
4. **`tests/e2e/18-inline-edit.spec.mjs:94` "prose fields save as-you-type after the debounce and keep focus"** — `locator.click` on the ProseMirror `.editor-content` (Quest description) times out; retry log shows `<menu class="editor-menu">` repeatedly "intercepts pointer events" (toolbar overlaps the editor content).

Regression-window note: these were already failing during PR #32 work ("3 pre-existing timeout issues" in session notes) and are unrelated to PR #33 (checklist) by diff analysis. Whether they predate PR #32's record-pane changes is UNKNOWN — Phase 1 should check by pointing the module symlink at a pre-#32 commit (e.g. `git worktree add /tmp/pre32 e802876~1`… actually use the commit before #32's merge; find it via `git log --oneline main -- scripts/apps/hub | head`) and rerunning the failing tests. If they pass there, bisect #32's diff.

---

## Phase 1: Fix the 4 failing tests

Use the systematic-debugging discipline: reproduce with `--trace on`, read the trace/error-context, form a root-cause hypothesis, verify it, then fix. Do NOT patch symptoms (blind waits, force-clicks) without understanding the cause. One failure cluster at a time; the server lock forces serial runs anyway.

### Task 1a+1b: hub-record-pane pair (likely one root cause)

- [ ] Reproduce: `npx playwright test tests/e2e/21-hub-record-pane.spec.mjs --trace on` (per foundry-e2e skill). Inspect `test-results/**/trace.zip` via `npx playwright show-trace <zip>` or unzip + read the snapshots/console.
- [ ] Key question for :211 — why is `#campaign-hub` absent from the a11y tree? Check: (a) did a prior test in the same file close/replace the hub app? (b) does the hub render fail with a console error (read trace console)? (c) test-ordering dependency — does :211 pass when run alone with `-g "text pages view and edit in-pane"`? If it passes alone, the bug is inter-test state (a previous test leaving a dialog/app open or the hub closed) — fix the offending test's cleanup, not :211.
- [ ] Key question for :229 — after New Entry creates an NPC, does the pane mount but with view-mode content (missing `[name="system.role"]` because it renders view template instead of edit)? Compare against the passing sibling tests in the same file to isolate what differs (record type? creation path? edit-mode default from PR "new-creation-defaults" plan `docs/superpowers/plans/2026-07-17-new-creation-defaults.md`).
- [ ] Regression-window check (both): rerun the two tests with the module symlink pointed at the commit before PR #32 (`git log --oneline --merges main | head` to find #32's merge; check out its parent into a temp worktree; foundry-e2e skill governs the symlink swap). Record PASS/FAIL in this doc.
- [ ] Fix product or test per root cause; run the full spec file (19 tests) green.
- [ ] Commit (`fix(e2e): …` or `fix: …` if product code), update Status table, commit doc.

### Task 1c: group-hub-sheet New Entry dialog

- [ ] Reproduce in isolation with trace: `npx playwright test tests/e2e/22-group-hub-sheet.spec.mjs -g "record created into another group" --trace on`.
- [ ] Key question — does the New Entry dialog render `select[name="group"]` at all (dialog markup changed? group list empty? dialog behind another window)? The trace DOM snapshot at timeout answers this directly.
- [ ] Note the sibling tests in the file pass, so the dialog opens fine elsewhere — diff what this test does differently (it targets ANOTHER group's hub).
- [ ] Fix; run the spec file (4 tests) green; commit; update Status.

### Task 1d: inline-edit ProseMirror toolbar overlap

- [ ] Reproduce in isolation with trace: `npx playwright test tests/e2e/18-inline-edit.spec.mjs -g "prose fields save as-you-type" --trace on`.
- [ ] Root-cause: the `<menu class="editor-menu">` overlays the click point on `.editor-content`. Candidates: (a) viewport too small so the sticky toolbar covers the first line — check the trace screenshot; (b) CSS regression in `styles/campaign-record.css` positioning the toolbar over content; (c) the test clicks the topmost point of the editor — clicking a lower coordinate or using `locator.click({ position })`/`pressSequentially` into the already-focused editor may be the honest fix if real users can click below the toolbar.
- [ ] Decide product vs test fix: if the toolbar genuinely covers the only clickable content area at default viewport, that's a product CSS bug — fix the CSS. If the editor is fine and the test just clicks a covered pixel, fix the test's click target.
- [ ] Run the spec file (6 tests) green; commit; update Status.

**Phase 1 exit criteria:** `npx playwright test tests/e2e/21-hub-record-pane.spec.mjs tests/e2e/22-group-hub-sheet.spec.mjs tests/e2e/18-inline-edit.spec.mjs` → all green, no `test.fixme` added (or fixmes explicitly documented in Status with reasons).

---

## Phase 2: Cap failure cost — timeout configuration

- [ ] Read `playwright.config.mjs`. Record current `timeout`, `expect.timeout`, `use.actionTimeout` values here before changing: (fill in).
- [ ] Set `use: { actionTimeout: 15_000 }` and `expect: { timeout: 15_000 }` (or confirm existing values and lower the effective 90s ceiling — the observed failures ran 90s before timing out, so find which knob produces that: likely `timeout: 90_000` per-test). Keep the per-test `timeout` high enough for the slowest legit test (World-reload tests in 18-migrations use explicit 60s `waitForFunction` — explicit timeouts override defaults, so they are safe).
- [ ] Sanity run: `npx playwright test tests/e2e/01-module.spec.mjs tests/e2e/18-migrations.spec.mjs tests/e2e/11-checklist.spec.mjs` — green (proves explicit long waits survive the lower defaults).
- [ ] Commit; update Status.

**Exit criteria:** a deliberately-broken locator (try one locally, don't commit it) fails in ~15s, not 90s; the sanity specs pass.

---

## Phase 3: storageState login reuse

Current cost: every spec file's `beforeAll` calls `login(page, "Gamemaster")` (and often `login(page, "User 1")`) — a full Foundry join-screen interaction per file. ~6 min total.

- [ ] Study `tests/e2e/helpers/foundry.mjs` `login()` and Foundry's session mechanics: Foundry auth is a session cookie tied to the selected user; verify a saved cookie keeps working across page loads and multiple browser contexts, and what happens when another context logs in as the same user (Foundry may evict the older session — TEST THIS FIRST; if GM+player concurrent sessions evict each other, scope state per user and keep one live context per user).
- [ ] Implement a Playwright **setup project** (`projects: [{ name: 'setup', testMatch: /auth\.setup\.mjs/ }, { name: 'e2e', dependencies: ['setup'], ... }]`) that logs in Gamemaster and User 1 once and saves `storageState` to `tests/e2e/.auth/gm.json` / `user1.json` (git-ignore `.auth/`).
- [ ] Rework `login(page, userName)` to first try `context.addCookies` from the saved state (or have callers create contexts with `storageState`) and fall through to the interactive join-screen path when the state is missing/expired — keep the function signature so 31 spec files don't all change; internal fast-path only.
- [ ] Measure: rerun 3 mid-size specs (05-hub, 16-presenter, 07-hub-search) before/after and record wall-time delta here: (fill in).
- [ ] Full-suite implications: specs that `page.reload()` (18-migrations) or open second contexts must still pass — run those explicitly.
- [ ] Commit; update Status.

**Exit criteria:** the 3 measured specs show materially reduced setup time; no spec regresses; interactive fallback proven by deleting `.auth/` and rerunning one spec.

---

## Phase 4: Smoke tier

- [ ] Add `npm run e2e:smoke` script running a ~2-minute subset: `01-module` (boot sanity) + `20-env-lock` + one representative record spec (`02-records`). Implementation: a `--grep @smoke` tag on chosen describe blocks, or an explicit file list in the npm script — file list is simpler and YAGNI-compliant.
- [ ] Document in `tests/e2e/README.md`: when to run smoke (mid-task) vs affected specs (per task) vs full suite (pre-merge).
- [ ] Commit; update Status.

---

## Phase 5: Full-suite verification + ship

- [ ] `npx vitest run` — green.
- [ ] Full `npx playwright test` per foundry-e2e skill. Record: pass/fail counts and wall time here: (fill in). Target: 135/135 (or documented fixmes) and wall ≤ ~9 min.
- [ ] Update this doc's Status table to all-complete; commit.
- [ ] Push `test/e2e-health`, open a **draft PR** titled `test: e2e suite health — fix failing specs, cut wall time` summarizing before/after timings. Do not merge, do not publish a release.

## Session Resume Protocol

1. `cd` the worktree `.claude/worktrees/e2e-test-health` (create from `origin/test/e2e-health` if missing).
2. Read this file's Status table; `git log --oneline origin/main..HEAD` to see landed phases.
3. Resume at the first non-complete phase. Never rerun a completed phase's e2e verification just to re-confirm.
4. Baseline artifacts from the original analysis session (raw log `/tmp/e2e-full-run.log`, task reports) may be gone — this doc's Baseline Evidence section is the durable copy.
