# End-to-End Tests (Playwright)

Automated in-Foundry tests that drive real browser clients against a local
Foundry VTT v13 server. They cover most of what `docs/manual-test-checklist.md`
used to require by hand, including true multi-client collaboration.

## Requirements

- A local Foundry VTT v13 Node install. Defaults (override via env vars):
  - `FOUNDRY_APP` = `/Users/danbularzik/FoundryVTT/FoundryVTT-Node-13.351`
  - `FOUNDRY_DATA` = `/Users/danbularzik/FoundryVTT/Data`
  - `FOUNDRY_NODE` = `/opt/homebrew/opt/node@22/bin/node`
  - `FOUNDRY_URL` = `http://localhost:30000`
  - `FOUNDRY_TEST_WORLD` = `world-b`
- The test world must have users named **Gamemaster**, **User 1**, and
  **User 2** with no passwords.
- This module symlinked into `$FOUNDRY_DATA/Data/modules/campaign-record`.

## Running

```bash
npm run test:e2e          # or: npx playwright test
npx playwright test tests/e2e/03-quest.spec.mjs   # one file
npm run e2e:smoke         # ~2 min sanity subset (boot, env-lock, records)
```

Choosing what to run: while iterating on a feature, run the spec files that
cover it; use `npm run e2e:smoke` as a quick mid-task sanity check that the
module still boots and core record flows work; run the full suite before
merging a branch.

Global setup automatically: starts the server (or restarts it into the test
world if a different world is active), logs in as Gamemaster, enables the
module if needed, deletes leftover `E2E `-prefixed groups, and deactivates any
active scene (an active scene forces every headless client through software
WebGL canvas rendering, which is slow enough to break test timeouts).

## Rules the suite depends on

- **One runner at a time, no spectators.** Foundry disables the join option
  for users who are already connected, so close any browser logged into the
  test world (including your own) before running. The login helper fails fast
  with a clear message if a needed user is connected.
- Tests create documents prefixed `E2E ` and clean up after themselves;
  global setup sweeps any leftovers from crashed runs.
- The suite runs with `workers: 1` — specs share one server and one world.
- The server is left running on the test world afterward. To return to your
  regular world, stop it and relaunch without `--world` (or with your world's
  id).

## What stays manual

See `docs/manual-test-checklist.md` — items requiring real pointer-driven
drag-and-drop from the sidebar (Actor/Scene linking) and subjective checks
(editor feel, layout) remain manual. Everything else on the checklist is
exercised here.

## Environment lock

The suite takes an exclusive lock on the shared Foundry install
(`$FOUNDRY_DATA/.claude-e2e-lock/`). A second concurrent run fails fast,
naming the holder. Global setup pins the module symlink to this checkout
and md5-verifies the served code; teardown restores the symlink to the
main checkout. Force-release a stuck lock with `npm run e2e:unlock`.
