import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, deleteActorsByPrefix, deleteScenesByPrefix } from "./helpers/foundry.mjs";

// Drives the real Foundry hooks (scene activation, combat lifecycle) and
// asserts the auto-capture engine's world-side effects — the in-Foundry
// coverage the quench batches describe, run through the e2e harness.
const P = "E2E AutoCap";

test.describe("auto-capture engine", () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
  });

  test.afterAll(async () => {
    // Delete any combats we spawned, then the prefixed scenes/actors/groups.
    await page.evaluate(async () => {
      for (const c of [...game.combats]) {
        if (c.getFlag("campaign-record", "encounterUuid")) await c.delete().catch(() => {});
      }
      await game.settings.set("campaign-record", "autoCaptureTargetGroup", "");
    });
    await deleteScenesByPrefix(page, P);
    await deleteActorsByPrefix(page, P);
    await deleteGroupsByPrefix(page, P);
    await page.close();
  });

  test("activation creates a Place + timepoint; combat creates, grows, and finalizes an Encounter", async () => {
    // --- setup: target group, scene, two distinct actors ---
    const ids = await page.evaluate(async (P) => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const group = await createGroup(`${P} Target`);
      await game.settings.set("campaign-record", "autoCaptureTargetGroup", group.id);
      const scene = await Scene.create({ name: `${P} Tavern`, width: 1000, height: 1000 });
      const actorType = Actor.TYPES.find((t) => t !== "base") ?? Actor.TYPES[0];
      const goblin = await Actor.create({ name: `${P} Goblin`, type: actorType });
      const orc = await Actor.create({ name: `${P} Orc`, type: actorType });
      return {
        groupId: group.id, sceneId: scene.id, sceneUuid: scene.uuid,
        goblinId: goblin.id, orcId: orc.id
      };
    }, P);

    // --- ACTIVATION -> Place reused/created + a fresh timepoint attached ---
    // Force a real inactive->active transition (a scene may be auto-active on
    // create, making a plain update({active:true}) a no-op that fires no hook).
    const cap = await page.evaluate(async ({ sceneId }) => {
      const scene = game.scenes.get(sceneId);
      if (scene.active) await scene.update({ active: false });
      const seen = [];
      const id = Hooks.on("updateScene", (s, c) => { if (s.id === scene.id) seen.push(c.active); });
      await scene.update({ active: true });
      await new Promise((r) => setTimeout(r, 300));
      Hooks.off("updateScene", id);
      return seen.includes(true);
    }, ids);
    expect(cap, "scene activation fired updateScene with active:true").toBe(true);
    // Membership is a link on the timepoint (not a set stored on the Place
    // page); timepointsForRecord is the module's reverse lookup for this.
    await expect.poll(
      () => page.evaluate(async ({ groupId, sceneUuid }) => {
        const { timepointsForRecord } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
        const g = game.journal.get(groupId);
        const place = g.pages.find((p) => p.type === "campaign-record.place" && p.system.scene === sceneUuid);
        if (!place) return false;
        return timepointsForRecord(g, place.uuid).length > 0;
      }, ids),
      { timeout: 15_000 }
    ).toBe(true);

    // --- COMBAT START -> Encounter attached to the Place's timepoint, collapsed roster ---
    // Create the combat UNLINKED (no scene) — the Foundry v13 default when a GM
    // clicks "Create Encounter" in the tracker. The engine must fall back to the
    // active scene, so the Encounter still lands on the activated scene's Place.
    await page.evaluate(async ({ goblinId }) => {
      const combat = await Combat.create({});
      await combat.createEmbeddedDocuments("Combatant", [{ actorId: goblinId }, { actorId: goblinId }]);
      await combat.startCombat();
      globalThis.__e2eCombatId = combat.id;
    }, ids);

    const encounter = await pollTruthy(page, () => page.evaluate(async () => {
      const { timepointsForRecord } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const combat = game.combats.get(globalThis.__e2eCombatId);
      const uuid = combat?.getFlag("campaign-record", "encounterUuid");
      if (!uuid) return null;
      const e = fromUuidSync(uuid);
      if (!e) return null;
      return {
        type: e.type,
        scene: e.system.scene,
        rows: e.system.combatants.length,
        goblinCount: e.system.combatants.find((c) => c.name.includes("Goblin"))?.count ?? 0,
        // Membership is a link on the timepoint (not a set stored on the
        // Encounter page); timepointsForRecord is the module's reverse lookup.
        attached: e.parent ? timepointsForRecord(e.parent, e.uuid).length : 0
      };
    }));
    expect(encounter.type).toBe("campaign-record.encounter");
    expect(encounter.scene).toBe(ids.sceneUuid);
    expect(encounter.goblinCount).toBe(2); // two Goblin tokens collapsed into one actor row
    expect(encounter.attached).toBeGreaterThan(0);

    // --- ROSTER ADD -> Encounter grows (additive) ---
    await page.evaluate(async ({ orcId }) => {
      const combat = game.combats.get(globalThis.__e2eCombatId);
      await combat.createEmbeddedDocuments("Combatant", [{ actorId: orcId }]);
    }, ids);
    await expect.poll(
      () => page.evaluate(() => {
        const uuid = game.combats.get(globalThis.__e2eCombatId)?.getFlag("campaign-record", "encounterUuid");
        return fromUuidSync(uuid)?.system.combatants.length ?? 0;
      }),
      { timeout: 15_000 }
    ).toBe(2); // Goblin row + Orc row

    // --- COMBAT END -> outcome summary records the defeated combatant ---
    const encounterUuid = await page.evaluate(async () => {
      const combat = game.combats.get(globalThis.__e2eCombatId);
      const uuid = combat.getFlag("campaign-record", "encounterUuid");
      await combat.combatants.contents[0].update({ defeated: true });
      await combat.delete();
      return uuid;
    });
    await expect.poll(
      () => page.evaluate((uuid) => fromUuidSync(uuid)?.system.outcome ?? "", encounterUuid),
      { timeout: 15_000 }
    ).toContain("Died");
  });
});

/** Poll an async producer until it returns a truthy value, then return it. */
async function pollTruthy(page, producer, timeout = 15_000) {
  let value = null;
  await expect.poll(async () => { value = await producer(); return !!value; }, { timeout }).toBe(true);
  return value;
}
