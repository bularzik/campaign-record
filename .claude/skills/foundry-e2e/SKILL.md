---
name: foundry-e2e
description: Contract for running this project's Playwright e2e suite against the shared Foundry install — session locking, symlink ownership, unlock, and iteration rules. Read before any e2e run, server restart, or module-symlink change.
---

# Foundry E2E Environment Contract

One shared Foundry install serves these tests (one data dir, one module
symlink, one test world, one port). Concurrent sessions corrupt each
other's runs. The harness enforces exclusive access — follow this contract.

## Rules

1. **Run e2e only via the harness**: `npm run test:e2e` or
   `npx playwright test [spec]`. Global setup acquires the session lock,
   pins the module symlink to *this* checkout, verifies the served code by
   md5, and sweeps `E2E `-prefixed leftovers. Teardown releases the lock
   and restores the symlink to the main checkout.
2. **Never** repoint `Data/modules/campaign-record`, start/stop the
   Foundry server, or delete `.claude-e2e-lock` manually.
3. **If the lock is held** (the run fails naming a holder pid/worktree):
   report it to the user and stop. Do not steal it, do not wait-loop.
   The user decides; their command is `npm run e2e:unlock`.
4. **All test-created world data uses the `E2E ` name prefix** — groups,
   actors, everything. The hygiene sweep deletes only that prefix.

## Test tiers (2026-07-18 policy)

- **Feature development** (brainstorming → plan → implementation tasks →
  final branch review): run `npm run e2e:smoke` (~2 min boot/core sanity)
  plus the spec files that cover the changed code. Do NOT run the full
  suite per task, per branch, or in the final review.
- **Publish gate**: the full suite (`npx playwright test`) runs exactly
  once per release — when the user asks to publish, before the version
  bump/tag. A failure blocks the release until fixed or the user
  explicitly waives it.
- Run the full suite outside the publish gate only when the user
  explicitly asks for one.

## Efficiency rules (from the 2026-07-09 retro)

- Wait on test runs in the **foreground** — never park on a background
  monitor that needs an external nudge to resume.
- While debugging, iterate on a **single spec**
  (`npx playwright test tests/e2e/NN-name.spec.mjs`); the full suite is
  reserved for the publish gate (see Test tiers).
- A test failure that makes no sense against the code you just wrote may
  mean the environment isn't serving your code — the deployment check in
  global setup should catch this; trust its error over your debugging
  instinct.
