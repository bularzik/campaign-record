# Foundry E2E Environment Lock — Design

**Date:** 2026-07-09
**Status:** Approved (design); spec pending user review
**Branch:** `feature/e2e-env-lock`

## Problem

The e2e suite runs against one shared, mutable Foundry install: one data
directory, one module symlink, one test world, one port. On 2026-07-09 two
concurrent Claude sessions used it simultaneously with no coordination. The
symlink flapped between checkouts, so tests executed code from the wrong
branch (phantom failures burned ~45 minutes of debugging), sessions fought
over the server, and crashed runs left pollution in world data (stray
timepoints in a real campaign group, orphaned test actors) that caused a
second wave of real failures. Nothing in the harness verified that the
server was serving the code under test.

## Goals

1. Only one session at a time can run e2e tests or mutate the shared
   Foundry environment (server, symlink).
2. Every test run verifies it is testing the code it built — fail fast and
   explicit, never phantom.
3. The user can always force-unlock with one command.
4. Leftover test data from crashed runs cannot cascade into later runs.
5. Future Claude sessions learn the contract from a project skill.

Non-goals (YAGNI): cross-machine locking, heartbeat/renewal files, a lock
server. Pid-liveness on a single Mac is sufficient.

## Design

### Lock primitive — `tests/e2e/helpers/env-lock.mjs`

A lock **directory** (atomic `mkdir`) at `$FOUNDRY_DATA/.claude-e2e-lock/`
(same `FOUNDRY_DATA` env override the helper already uses) containing
`info.json`:

```json
{ "pid": 12345, "worktree": "/abs/path/of/checkout", "acquiredAt": "ISO-8601", "sessionHint": "optional CLAUDE_SESSION_ID or ppid" }
```

Exports:

- `acquireLock({ worktree })` — atomic `mkdir`; on success writes
  `info.json`. If the lock exists:
  - holder pid **dead** → steal: remove, log a note with the dead holder's
    info, acquire.
  - holder pid **alive** → throw with holder worktree/pid/age **and the
    unlock command** in the message.
  - holder alive but lock older than 2 hours → still throw, with a loud
    staleness warning added.
- `releaseLock()` — removes the lock only if `info.json.pid` is this
  process (or a dead pid); never removes a live foreign lock.
- `lockStatus()` — returns `{ held, info, alive }` for scripts/messages.

### Hard gate — playwright global setup/teardown

`tests/e2e/global-setup.mjs` (existing) gains, in order:

1. `acquireLock()` — any e2e run by any session or subagent fails
   immediately, with a clear message, if another live session holds the
   lock.
2. **Pin the symlink**: `ln -sfn <repo root of this checkout>` at
   `$FOUNDRY_DATA/Data/modules/campaign-record` (path override via
   `FOUNDRY_MODULE_LINK` env for non-default installs).
3. Boot/reuse the server (existing `ensureTestWorld()`).
4. **Deployment verification**: `readlink` equals this checkout, and the
   md5 of sentinel files fetched from the server
   (`module.json`, `scripts/apps/hub/campaign-hub.mjs`) equals the same
   files on disk. Mismatch → abort the run: *"Foundry is serving different
   code than this checkout — another session may own the environment."*
5. **World hygiene sweep**: via one logged-in GM page, delete only
   documents (journal groups, actors) whose names start with `E2E ` —
   leftovers from crashed runs. Nothing else is ever touched.

A new `tests/e2e/global-teardown.mjs` (registered in
`playwright.config.js`):

1. `releaseLock()`.
2. **Restore the symlink to the main checkout**
   (`/Users/danbularzik/Claude/Projects/campaign-record/campaign-record`,
   overridable via `FOUNDRY_MAIN_CHECKOUT`), so interactive Foundry use
   always sees `main` after tests finish.

The server helper's `startServer`/`stopServer` also refuse to act when a
live foreign session holds the lock, so scripts that bypass playwright
cannot fight over the server or its lock files.

### User unlock — `npm run e2e:unlock`

`tests/e2e/helpers/unlock.mjs`, wired as an npm script. Force-removes the
lock regardless of owner, prints who held it, and restores the symlink to
the main checkout. Every lock-related error message names this command.

### Skill — `.claude/skills/foundry-e2e/SKILL.md`

Project skill (committed to the repo) stating the contract for Claude
sessions:

- Run e2e only via `npm run test:e2e` / `npx playwright test` — the lock,
  symlink, verification, and cleanup are automatic. Never repoint the
  symlink, kill the server, or delete lock files manually.
- If the lock is held: report the holder to the user and stop — do not
  steal, do not wait-loop. The user decides (`npm run e2e:unlock`).
- Efficiency rules (from the 2026-07-09 retro): wait on test runs in the
  foreground (no monitor-parking that needs an external nudge); iterate on
  a single spec while debugging; run the full suite once at the end; all
  test-created world data uses the `E2E ` name prefix.

## Error handling

- Lock contention → immediate, named error; no retry loops.
- Dead-holder steal and 2h-stale warnings are logged to the run output.
- Verification failure → abort before any spec runs; message distinguishes
  symlink mismatch from content (md5) mismatch.
- Teardown runs even when tests fail (playwright guarantees globalTeardown
  after globalSetup succeeds); if setup itself fails after acquiring, it
  releases in a `finally`.

## Testing

- Unit (vitest): lock module logic isolated from the filesystem via a tmp
  dir — acquire/steal-dead-pid/reject-live-pid/release-own-only/status;
  sentinel-verification comparator as a pure function.
- E2E self-test: `global-setup` behavior is exercised by every suite run;
  one new spec asserts `lockStatus()` reports this run's pid while the
  suite is running.
- Manual: two concurrent `npx playwright test` invocations — the second
  fails immediately with the holder message; `npm run e2e:unlock` clears
  it; symlink points at main afterward.
