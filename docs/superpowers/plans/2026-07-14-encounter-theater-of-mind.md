# Encounter theater-of-the-mind capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When combat begins with no scene (theater of the mind), auto-create an Encounter on a fresh dated timepoint instead of skipping.

**Architecture:** Branch inside the existing `combatStart` hook in `scripts/hooks/auto-capture.mjs`. Resolve the target group first, then the scene (`combat.scene ?? game.scenes.active`). If a scene resolves, keep today's behavior (Place + its timepoint, `scene` on the Encounter); if not, create a new `"Combat on {date}"` timepoint and a scene-less Encounter. Both paths converge on a shared tail (create page → `addLink` → set flag).

**Tech Stack:** Foundry VTT v13 module (ES modules), Vitest (unit), Playwright (e2e against local Foundry world-b).

## Global Constraints

- Module code runs inside Foundry; `new Date()`, `game.i18n`, and Foundry document APIs are available (unlike Workflow scripts).
- `addTimepoint` and `addLink` are already imported in `scripts/hooks/auto-capture.mjs` — no new imports needed.
- Every i18n key referenced from `scripts/**/*.mjs` or `templates/**/*.hbs` MUST resolve in `lang/en.json` (enforced by `tests/i18n-coverage.test.js`) — add the key in the same change that references it.
- The scene-based capture path and the other combat lifecycle hooks (`createCombatant`/`updateCombatant`/`deleteCombatant`/`deleteCombat`) must remain unchanged in behavior.
- e2e precondition: local Foundry v13 server running with world-b active and **no Gamemaster session connected** (the harness refuses otherwise). Start via `tests/e2e` global-setup; free the GM slot before running.

---

### Task 1: Theater-of-the-mind auto-encounter capture

**Files:**
- Modify: `scripts/hooks/auto-capture.mjs:153-175` (the `combatStart` hook)
- Modify: `lang/en.json:321` (add one key under `CAMPAIGNRECORD.AutoCapture`)
- Test: `tests/e2e/25-auto-capture-engine.spec.mjs` (add one `test(...)` in the existing `describe`)

**Interfaces:**
- Consumes (already imported / existing):
  - `addTimepoint(group, label, position = null, campaignDate = null) → Promise<{ id, label, sort, createdAt, campaignDate }>`
  - `addLink(group, timepointId, { uuid, name, type }) → Promise<entry|null>`
  - `ensurePlaceForScene(group, scene, { createTimepoint }) → Promise<{ place, timepointId }>`
  - `collapseParticipants(entries) → [{ id, name, count, actor }]`
  - `typeId("encounter") → "campaign-record.encounter"`
  - `getTimepoints(group)` and `timepointsForRecord(group, uuid)` from `scripts/data/timepoints.mjs` (used by the test)
- Produces: no new exported symbols; behavior change only.

- [ ] **Step 1: Write the failing e2e test**

Add this test to `tests/e2e/25-auto-capture-engine.spec.mjs`, immediately after the existing `test("activation creates a Place + timepoint; …", …)` block and before the closing `});` of the `describe`. It reuses the file's `pollTruthy` helper and the `P` prefix constant.

```js
  test("theater of the mind: no active scene -> new dated timepoint + scene-less Encounter", async () => {
    // --- setup: fresh target group + one actor; ensure NO active scene ---
    const ids = await page.evaluate(async (P) => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const group = await createGroup(`${P} TotM Target`);
      await game.settings.set("campaign-record", "autoCaptureTargetGroup", group.id);
      const actorType = Actor.TYPES.find((t) => t !== "base") ?? Actor.TYPES[0];
      const bandit = await Actor.create({ name: `${P} Bandit`, type: actorType });
      // Deactivate any active scene so game.scenes.active resolves to null.
      for (const s of game.scenes) if (s.active) await s.update({ active: false });
      return { groupId: group.id, banditId: bandit.id };
    }, P);

    // Timepoint count before, so we can prove a NEW one is created.
    const before = await page.evaluate(async ({ groupId }) => {
      const { getTimepoints } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      return getTimepoints(game.journal.get(groupId)).length;
    }, ids);

    // --- COMBAT START with no scene -> scene-less Encounter on a fresh timepoint ---
    await page.evaluate(async ({ banditId }) => {
      const combat = await Combat.create({}); // unlinked; no active scene => theater of the mind
      await combat.createEmbeddedDocuments("Combatant", [{ actorId: banditId }]);
      await combat.startCombat();
      globalThis.__e2eTotMCombatId = combat.id;
    }, ids);

    const enc = await pollTruthy(page, () => page.evaluate(async ({ groupId }) => {
      const { getTimepoints, timepointsForRecord } =
        await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const combat = game.combats.get(globalThis.__e2eTotMCombatId);
      const uuid = combat?.getFlag("campaign-record", "encounterUuid");
      if (!uuid) return null;
      const e = fromUuidSync(uuid);
      if (!e) return null;
      const g = game.journal.get(groupId);
      return {
        type: e.type,
        scene: e.system.scene ?? null,
        name: e.name,
        tpCount: getTimepoints(g).length,
        attached: e.parent ? timepointsForRecord(e.parent, e.uuid).length : 0
      };
    }, ids));

    expect(enc.type).toBe("campaign-record.encounter");
    expect(enc.scene, "scene-less encounter has no scene").toBeFalsy();
    expect(enc.name, "encounter named 'Combat on <date>'").toContain("Combat on");
    expect(enc.tpCount, "a brand-new timepoint was created").toBe(before + 1);
    expect(enc.attached, "encounter attached to the new timepoint").toBeGreaterThan(0);
  });
```

Also extend the `afterAll` cleanup so the second combat is removed. Change the existing loop body (currently only deletes combats flagged `encounterUuid`) — it already matches any combat carrying the `encounterUuid` flag, so **no change is required** for combat cleanup. The `${P} TotM Target` group and `${P} Bandit` actor are already covered by `deleteGroupsByPrefix(page, P)` / `deleteActorsByPrefix(page, P)`. No edit to `afterAll` needed.

- [ ] **Step 2: Run the e2e test to verify it fails**

Ensure the Foundry world-b server is up and no GM session is connected, then run only the new test:

Run: `npx playwright test 25-auto-capture-engine -g "theater of the mind"`
Expected: FAIL — `pollTruthy` times out because the current handler returns at `if (!scene) return` and never sets the `encounterUuid` flag (no encounter, no timepoint).

- [ ] **Step 3: Add the i18n key**

In `lang/en.json`, under `CAMPAIGNRECORD.AutoCapture` (around line 321), add `EncounterNameNoScene` right after `EncounterName`:

```json
      "EncounterName": "Combat at {scene}",
      "EncounterNameNoScene": "Combat on {date}",
```

(Leave the other keys — `SharedMediaName`, `Died`, `Injured`, `Fled`, `NoCasualties`, `NoGMForTarget` — unchanged.)

- [ ] **Step 4: Implement the theater-of-the-mind branch**

Replace the whole `combatStart` hook (`scripts/hooks/auto-capture.mjs:153-175`) with:

```js
  // GM begins combat → create an Encounter and attach it to a timepoint.
  Hooks.on("combatStart", async (combat) => {
    if (game.user !== game.users.activeGM) return;
    const group = getTargetGroup();
    if (!group) return;
    // Foundry v13 creates combats UNLINKED (combat.scene === null) by default;
    // the tracker only links a combat to a scene via an explicit menu toggle.
    // Fall back to the active scene — the scene the map-activation flow keyed
    // the Place/timepoint to. With no scene at all (theater of the mind), file
    // the Encounter onto a fresh dated timepoint instead.
    const scene = combat.scene ?? game.scenes?.active ?? null;
    const combatants = collapseParticipants(combatParticipants(combat));

    let timepointId;
    let name;
    let system;
    if (scene) {
      ({ timepointId } = await ensurePlaceForScene(group, scene, { createTimepoint: false }));
      name = game.i18n.format("CAMPAIGNRECORD.AutoCapture.EncounterName", { scene: scene.name });
      system = { scene: scene.uuid, combatants };
    } else {
      name = game.i18n.format("CAMPAIGNRECORD.AutoCapture.EncounterNameNoScene", {
        date: new Date().toLocaleDateString()
      });
      timepointId = (await addTimepoint(group, name)).id;
      system = { combatants };
    }

    const [encounter] = await group.createEmbeddedDocuments("JournalEntryPage", [
      { name, type: typeId("encounter"), system }
    ]);
    await addLink(group, timepointId, { uuid: encounter.uuid, name: encounter.name, type: "JournalEntryPage" });
    await combat.setFlag(MODULE_ID, ENCOUNTER_FLAG, encounter.uuid);
  });
```

Notes:
- The target-group check now precedes scene resolution (no reason to resolve a scene we cannot use).
- `name` is shared by the Encounter page and, in the scene-less branch, the timepoint label — satisfying the "same string for both" decision.
- The scene-less `system` omits `scene`, which `EncounterModel.scene` (nullable `DocumentUUIDField`) accepts.

- [ ] **Step 5: Run the e2e test to verify it passes**

Run: `npx playwright test 25-auto-capture-engine`
Expected: PASS — both the existing scene-based case and the new theater-of-the-mind case pass.

- [ ] **Step 6: Run the unit suite (i18n coverage + regressions)**

Run: `npx vitest run`
Expected: PASS — all tests, including `tests/i18n-coverage.test.js` (the newly referenced `EncounterNameNoScene` key now resolves).

- [ ] **Step 7: Commit**

```bash
git add scripts/hooks/auto-capture.mjs lang/en.json tests/e2e/25-auto-capture-engine.spec.mjs
git commit -m "Auto-capture encounters for theater-of-the-mind combats

With no scene (combat.scene and game.scenes.active both null), create a
new 'Combat on {date}' timepoint and attach a scene-less auto-created
Encounter to it, instead of skipping. Scene-based capture unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- No-scene → new timepoint + attached scene-less Encounter → Task 1, Steps 3-4; asserted in Step 1.
- Guard reordering (group before scene) → Step 4.
- `"Combat on {date}"` used for both timepoint label and Encounter name → Step 4 (`name` reused).
- New i18n key `EncounterNameNoScene` → Step 3.
- Scene-based path + other lifecycle hooks unchanged → Step 4 leaves them untouched; existing e2e case (Step 5) re-verifies the scene path, roster growth, and outcome summary.
- Testing plan (deactivate scenes, unlinked combat, assert new timepoint/scene-less/attached) → Step 1.
- Out-of-scope items (reuse timepoint, auto campaignDate) → not implemented.

**Placeholder scan:** none — every step has concrete code/commands and expected output.

**Type consistency:** `addTimepoint(...).id`, `addLink(group, timepointId, {uuid,name,type})`, `ensurePlaceForScene(...).timepointId`, and `timepointsForRecord(group, uuid)` match their definitions in `scripts/data/timepoints.mjs` and `scripts/hooks/auto-capture.mjs`. The `encounterUuid` flag key matches `ENCOUNTER_FLAG` in `scripts/constants.mjs`.
