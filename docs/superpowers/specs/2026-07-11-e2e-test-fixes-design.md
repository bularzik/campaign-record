# E2E test-fix follow-up — design

**Date:** 2026-07-11
**Branch:** `worktree-e2e-test-fixes`

## Problem

The full Playwright e2e suite run after merging v1.2.8 came back **104 passed, 3 failed**.
Investigation showed the shipped product code is correct — all three failures are
test-harness issues:

1. **`19-actor-picker.spec.mjs:80`** — the unlink assertion added for v1.2.8 polls
   `system.actor` for `""`. The field is a `DocumentUUIDField`, which normalizes a cleared
   value to `null`, so the assertion never matches (received `null`, timed out). The unlink
   feature works correctly; the assertion uses the wrong empty sentinel.
2. **`15-hub-types.spec.mjs:60`** — `CampaignHub` is a singleton and `typeMenuOpen` is
   persistent instance state. Test 1 opens the type-filter dropdown and never closes it;
   `openHub()` reuses the singleton without a real close, so test 2's blind
   `.doctype-summary` click *toggles the already-open menu shut*. The subsequent
   `.doctype-menu input[value="shop"]` never appears and the test hangs to timeout.
3. **`19-actor-picker.spec.mjs:188`** — the scene-picker test (not touched by v1.2.8) links
   a different `E2E Picker Scene` than the one it created. The global-setup hygiene sweep
   deletes `E2E ` Groups and Actors but not Scenes, so leftover scenes from crashed/prior
   runs accumulate and the picker (`selectOption` by label) grabs a stale duplicate.

## Scope

Test-harness only. No product code (`scripts/`, `templates/`, `styles/`, `module.json`)
changes — v1.2.8 behavior is correct as shipped, so this ships as a PR to `main` with **no
version bump and no release**.

Files touched: `tests/e2e/19-actor-picker.spec.mjs`, `tests/e2e/15-hub-types.spec.mjs`,
`tests/e2e/helpers/foundry.mjs`, `tests/e2e/global-setup.mjs`.

---

### Fix A — NPC unlink assertion

In `tests/e2e/19-actor-picker.spec.mjs`, the unlink block (added for v1.2.8) polls
`game.journal.get(groupId).pages.get(pageId).system.actor` and asserts `.toBe("")`.
Change the expectation to `.toBeNull()` to match how `DocumentUUIDField` stores a cleared
value. The following `expect(sheet.locator("a.content-link")).toHaveCount(0)` assertion —
which verifies the user-visible effect (link removed, drop hint restored) — stays as-is.

### Fix B — dropdown test isolation

In `tests/e2e/15-hub-types.spec.mjs`, add a small idempotent helper alongside the existing
`openHub`:

```javascript
const openTypeMenu = async (hub) => {
  if (!(await hub.locator(".doctype-menu").isVisible())) {
    await hub.locator(".doctype-summary").click();
  }
  await expect(hub.locator(".doctype-menu")).toBeVisible();
};
```

Replace every raw `await hub.locator(".doctype-summary").click()` that is intended to
*open* the menu (in both the "offers one checkbox per record type…" test and the
"checking types filters…" test) with `await openTypeMenu(hub)`. This makes the tests
robust to whatever menu state a prior test left on the singleton. The existing "click a
neutral element to close the menu" steps (`input[name='index-search']`) are unchanged.

No product-code change: in real usage the hub's close button triggers `_onClose`, which
already resets `typeMenuOpen`.

### Fix C — scene-pollution hygiene

Add a scene sweep mirroring the existing actor sweep.

In `tests/e2e/helpers/foundry.mjs`, after `deleteActorsByPrefix`, add:

```javascript
/** Delete all scenes whose name starts with the prefix (crashed-run artifacts). */
export async function deleteScenesByPrefix(page, prefix) {
  await page.evaluate(async (prefix) => {
    const ids = game.scenes.filter((s) => s.name.startsWith(prefix)).map((s) => s.id);
    if (ids.length) await Scene.implementation.deleteDocuments(ids);
  }, prefix);
}
```

In `tests/e2e/global-setup.mjs`, import `deleteScenesByPrefix` and call it in the sweep
alongside `deleteGroupsByPrefix`/`deleteActorsByPrefix`:

```javascript
await deleteScenesByPrefix(page, "E2E ");
```

Order it before the existing `game.scenes.active` deactivation step so a swept scene can't
be the active one.

---

## Testing

- Iterate on the two affected specs individually:
  - `npx playwright test tests/e2e/19-actor-picker.spec.mjs`
  - `npx playwright test tests/e2e/15-hub-types.spec.mjs`
- Then one full-suite confirmation run: `npm run test:e2e` — target **all passing**.
- All runs require the shared Foundry world to be free (per the `foundry-e2e` contract);
  if the lock is held, stop and report — do not steal it.

## Out of scope

- No product-code changes and no release; v1.2.8 stays the current published version.
- No broader e2e refactor (e.g. converting the singleton-hub tests to per-test isolation)
  beyond the two targeted fixes above.
