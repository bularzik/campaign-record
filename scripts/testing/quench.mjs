import { createGroup, isGroup, setRecordHidden } from "../data/groups.mjs";
import { RECORD_TYPES, typeId } from "../constants.mjs";
import {
  getTimepoints, addTimepoint, renameTimepoint, moveTimepoint, deleteTimepoint,
  addLink, removeLink, toggleLinkShowPlayers, resolveLinks
} from "../data/timepoints.mjs";
import { isRecordVisible } from "../logic/visibility.mjs";

// Auto-capture hooks are fire-and-forget (fired via Hooks.callAll, not awaited
// by the triggering call), so tests must wait for the world-side effect rather
// than assert synchronously. Resolves with the first truthy predicate value.
async function waitFor(predicate, { timeout = 5000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  let last = await predicate();
  while (!last && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    last = await predicate();
  }
  return last;
}

Hooks.on("quenchReady", (quench) => {
  quench.registerBatch(
    "campaign-record.core",
    (context) => {
      const { describe, it, assert, before, after } = context;
      let group;

      describe("Campaign groups", () => {
        before(async () => {
          group = await createGroup("Quench Test Group");
        });
        after(async () => {
          await group.delete();
        });

        it("carries the group flag", () => {
          assert.ok(isGroup(group));
          assert.deepEqual(group.getFlag("campaign-record", "group"), { timepoints: [] });
        });

        it("grants default OWNER ownership", () => {
          assert.equal(group.ownership.default, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
        });

        it("creates typed record pages with schema defaults", async () => {
          const [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
            { name: "Quench NPC", type: typeId("npc") }
          ]);
          assert.equal(page.system.status, "unknown");
          assert.equal(page.system.hidden, false);
          assert.deepEqual(page.system.tags.size, 0);
        });

        it("quest objectives round-trip through a targeted update", async () => {
          const [quest] = await group.createEmbeddedDocuments("JournalEntryPage", [
            { name: "Quench Quest", type: typeId("quest") }
          ]);
          const objectives = quest.system.toObject().objectives;
          objectives.push({ id: foundry.utils.randomID(), text: "Find the macguffin", done: false, gmOnly: false });
          await quest.update({ "system.objectives": objectives });
          assert.equal(quest.system.objectives.length, 1);
          assert.equal(quest.system.objectives[0].text, "Find the macguffin");
        });

        it("setRecordHidden syncs the ownership default", async () => {
          const [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
            { name: "Quench Secret", type: typeId("place") }
          ]);
          await setRecordHidden(page, true);
          assert.equal(page.system.hidden, true);
          assert.equal(page.ownership.default, CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE);
          await setRecordHidden(page, false);
          assert.equal(page.system.hidden, false);
          // v13 rejects writing the inherit marker through updates, so revealing
          // restores the group's effective default explicitly (see setRecordHidden).
          assert.equal(page.ownership.default, page.parent.ownership.default);
        });
      });
    },
    { displayName: "Campaign Record: Core" }
  );

  quench.registerBatch(
    "campaign-record.hub",
    (context) => {
      const { describe, it, assert, before, after } = context;
      let group, page;

      describe("Timepoints", () => {
        before(async () => {
          group = await createGroup("Quench Hub Group");
          [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
            { name: "Quench Hub NPC", type: typeId("npc") }
          ]);
        });
        after(async () => {
          await group.delete();
        });

        it("adds, renames, and orders timepoints", async () => {
          const a = await addTimepoint(group, "Session 1");
          const b = await addTimepoint(group, "Session 2");
          const mid = await addTimepoint(group, "Interlude", 1);
          assert.deepEqual(getTimepoints(group).map((t) => t.label),
            ["Session 1", "Interlude", "Session 2"]);
          await renameTimepoint(group, mid.id, "Flashback");
          assert.equal(getTimepoints(group)[1].label, "Flashback");
          await moveTimepoint(group, b.id, 0);
          assert.deepEqual(getTimepoints(group).map((t) => t.label),
            ["Session 2", "Session 1", "Flashback"]);
        });

        it("adds document links with dedupe and removes them", async () => {
          const tp = await addTimepoint(group, "Linked Session");
          const entry = await addLink(group, tp.id, {
            uuid: page.uuid, name: page.name, type: "JournalEntryPage"
          });
          assert.ok(entry.id);
          const dup = await addLink(group, tp.id, {
            uuid: page.uuid, name: page.name, type: "JournalEntryPage"
          });
          assert.equal(dup, null);
          let stored = getTimepoints(group).find((t) => t.id === tp.id);
          assert.equal(stored.links.length, 1);
          await removeLink(group, tp.id, entry.id);
          stored = getTimepoints(group).find((t) => t.id === tp.id);
          assert.equal(stored.links.length, 0);
          await deleteTimepoint(group, tp.id);
        });

        it("resolves links live: permitted docs, dangling links, image gating", async () => {
          const tp = await addTimepoint(group, "Resolved Session");
          await addLink(group, tp.id, { uuid: page.uuid, name: "stale name", type: "JournalEntryPage" });
          await addLink(group, tp.id, { uuid: "Actor.deadbeefdead", name: "Ghost", type: "Actor" });
          await addLink(group, tp.id, { src: "icons/svg/mystery-man.svg", name: "mystery-man.svg", showPlayers: false });
          const stored = getTimepoints(group).find((t) => t.id === tp.id);
          const entries = resolveLinks(stored, game.user); // quench runs as GM
          assert.equal(entries.length, 3);
          const doc = entries.find((e) => e.kind === "document");
          assert.equal(doc.name, page.name); // live name, not the cached "stale name"
          assert.ok(entries.some((e) => e.kind === "broken"));
          assert.ok(entries.some((e) => e.kind === "image")); // GM sees hidden images
          await deleteTimepoint(group, tp.id);
        });

        it("toggles showPlayers on image links only", async () => {
          const tp = await addTimepoint(group, "Toggle Session");
          const img = await addLink(group, tp.id, {
            src: "icons/svg/mystery-man.svg", name: "mystery-man.svg", showPlayers: false
          });
          await toggleLinkShowPlayers(group, tp.id, img.id);
          let stored = getTimepoints(group).find((t) => t.id === tp.id);
          assert.equal(stored.links[0].showPlayers, true);
          const doc = await addLink(group, tp.id, { uuid: page.uuid, name: page.name, type: "JournalEntryPage" });
          await toggleLinkShowPlayers(group, tp.id, doc.id); // no-op on documents
          stored = getTimepoints(group).find((t) => t.id === tp.id);
          assert.equal(stored.links.find((l) => l.id === doc.id).showPlayers, undefined);
          await deleteTimepoint(group, tp.id);
        });
      });
    },
    { displayName: "Campaign Record: Hub" }
  );

  quench.registerBatch(
    "campaign-record.types",
    (context) => {
      const { describe, it, assert, before, after } = context;
      let group;

      describe("Record types", () => {
        before(async () => {
          group = await createGroup("Quench Types Group");
        });
        after(async () => {
          await group.delete();
        });

        it("registers a data model for every record type", () => {
          for (const t of RECORD_TYPES) {
            assert.ok(CONFIG.JournalEntryPage.dataModels[typeId(t)], `missing model for ${t}`);
          }
        });

        it("creates every type with schema defaults", async () => {
          for (const t of RECORD_TYPES) {
            const [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
              { name: `Quench ${t}`, type: typeId(t) }
            ]);
            assert.equal(page.system.hidden, false, `${t} hidden default`);
            assert.ok(page.system.schema.fields.timepoints, `${t} timepoints field`);
          }
        });

        it("list rows round-trip through targeted updates", async () => {
          const rows = {
            encounter: ["combatants", { id: foundry.utils.randomID(), name: "Goblin", count: 3, actor: null }],
            checklist: ["items", { id: foundry.utils.randomID(), text: "Pack rations", done: false, assignee: "" }],
            shop: ["inventory", { id: foundry.utils.randomID(), name: "Rope", price: "1 gp", quantity: 2, item: null }],
            loot: ["items", { id: foundry.utils.randomID(), name: "Gem", quantity: 1, item: null }],
            media: ["images", { id: foundry.utils.randomID(), src: "icons/svg/book.svg", caption: "Cover" }]
          };
          for (const [t, [field, row]] of Object.entries(rows)) {
            const [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
              { name: `Quench rows ${t}`, type: typeId(t) }
            ]);
            await page.update({ [`system.${field}`]: [row] });
            const stored = page.system.toObject()[field];
            assert.equal(stored.length, 1, `${t}.${field} length`);
            assert.equal(stored[0].id, row.id, `${t}.${field} id survives`);
          }
        });

        it("loot currency stores integer denominations", async () => {
          const [loot] = await group.createEmbeddedDocuments("JournalEntryPage", [
            { name: "Quench Currency", type: typeId("loot") }
          ]);
          await loot.update({ "system.currency.gp": 250 });
          assert.equal(loot.system.currency.gp, 250);
          assert.equal(loot.system.currency.cp, 0);
        });

        it("hidden records are invisible to a non-GM perspective", async () => {
          const [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
            { name: "Quench Hidden", type: typeId("npc") }
          ]);
          await setRecordHidden(page, true);
          const player = game.users.find((u) => !u.isGM);
          assert.equal(isRecordVisible(player, page), false);
          assert.equal(isRecordVisible(game.user, page), true); // GM runs Quench
        });
      });
    },
    { displayName: "Campaign Record: Types" }
  );

  quench.registerBatch(
    "campaign-record.auto-target",
    (context) => {
      const { describe, it, assert, before, after } = context;
      let group;
      describe("Auto-capture target", () => {
        before(async () => { group = await createGroup("Quench Target Group"); });
        after(async () => {
          await game.settings.set("campaign-record", "autoCaptureTargetGroup", "");
          await group.delete();
        });
        it("GM setTargetGroup writes and resolves the world setting", async () => {
          const { setTargetGroup, getTargetGroup } = await import("../settings/auto-target.mjs");
          await setTargetGroup(group.id);
          assert.equal(game.settings.get("campaign-record", "autoCaptureTargetGroup"), group.id);
          assert.equal(getTargetGroup()?.id, group.id);
        });
        it("clears to null on a stale id", async () => {
          const { getTargetGroup } = await import("../settings/auto-target.mjs");
          await game.settings.set("campaign-record", "autoCaptureTargetGroup", "does-not-exist");
          assert.equal(getTargetGroup(), null);
        });
        it("a newly created group becomes the target", async () => {
          const { getTargetGroup } = await import("../settings/auto-target.mjs");
          const fresh = await createGroup("Quench Auto Target");
          await waitFor(() => getTargetGroup()?.id === fresh.id);
          assert.equal(getTargetGroup()?.id, fresh.id);
          await fresh.delete();
        });
      });
    },
    { displayName: "Campaign Record: Auto Target" }
  );

  quench.registerBatch(
    "campaign-record.auto-capture",
    (context) => {
      const { describe, it, assert, before, after } = context;
      let group, scene;
      describe("Auto-capture placement", () => {
        before(async () => {
          group = await createGroup("Quench Capture Group");
          await game.settings.set("campaign-record", "autoCaptureTargetGroup", group.id);
          scene = await Scene.create({ name: "Quench Tavern", width: 1000, height: 1000 });
        });
        after(async () => {
          await game.settings.set("campaign-record", "autoCaptureTargetGroup", "");
          await scene.delete();
          await group.delete();
        });
        it("ensurePlaceForScene reuses a place and adds a timepoint each activation", async () => {
          const { ensurePlaceForScene } = await import("../hooks/auto-capture.mjs");
          const first = await ensurePlaceForScene(group, scene, { createTimepoint: true });
          const second = await ensurePlaceForScene(group, scene, { createTimepoint: true });
          assert.equal(first.place.id, second.place.id, "same place reused");
          assert.notEqual(first.timepointId, second.timepointId, "new timepoint each time");
          assert.equal(first.place.type, "campaign-record.place");
          assert.equal(first.place.system.scene, scene.uuid);
          assert.ok(first.place.system.timepoints.has(second.timepointId));
        });

        it("combatStart creates an Encounter attached to the Place timepoint", async function () {
          this.timeout(15000);
          const { ensurePlaceForScene } = await import("../hooks/auto-capture.mjs");
          const { timepointId } = await ensurePlaceForScene(group, scene, { createTimepoint: true });
          const actorType = Actor.TYPES.find((t) => t !== "base") ?? Actor.TYPES[0];
          const actor = await Actor.create({ name: "Quench Goblin", type: actorType });
          const combat = await Combat.create({ scene: scene.id });
          await combat.createEmbeddedDocuments("Combatant", [{ actorId: actor.id }, { actorId: actor.id }]);
          await combat.startCombat();
          const encounterUuid = await waitFor(() => combat.getFlag("campaign-record", "encounterUuid"));
          assert.ok(encounterUuid, "encounter flag stamped");
          const encounter = await fromUuid(encounterUuid);
          assert.equal(encounter.type, "campaign-record.encounter");
          assert.equal(encounter.system.scene, scene.uuid);
          assert.ok(encounter.system.timepoints.has(timepointId), "attached to latest timepoint");
          assert.equal(encounter.system.combatants[0].count, 2, "collapsed by actor");
          await combat.delete();
          await actor.delete();
        });

        it("adding a combatant grows the Encounter; removal is tracked as departed", async function () {
          this.timeout(15000);
          const { ensurePlaceForScene } = await import("../hooks/auto-capture.mjs");
          await ensurePlaceForScene(group, scene, { createTimepoint: true });
          const actorType = Actor.TYPES.find((t) => t !== "base") ?? Actor.TYPES[0];
          const gob = await Actor.create({ name: "Quench Gob2", type: actorType });
          const orc = await Actor.create({ name: "Quench Orc", type: actorType });
          const combat = await Combat.create({ scene: scene.id });
          await combat.createEmbeddedDocuments("Combatant", [{ actorId: gob.id }]);
          await combat.startCombat();
          const encounterUuid = await waitFor(() => combat.getFlag("campaign-record", "encounterUuid"));
          const encounter = await fromUuid(encounterUuid);
          const [added] = await combat.createEmbeddedDocuments("Combatant", [{ actorId: orc.id }]);
          await waitFor(() => encounter.system.combatants.length === 2);
          assert.equal(encounter.system.combatants.length, 2, "orc synced in");
          await added.delete();
          await waitFor(() => (combat.getFlag("campaign-record", "departed") ?? []).length === 1);
          const departed = combat.getFlag("campaign-record", "departed") ?? [];
          assert.equal(departed.length, 1, "departure recorded");
          assert.equal(encounter.system.combatants.length, 2, "roster did not shrink");
          await combat.delete();
          await gob.delete();
          await orc.delete();
        });

        it("deleteCombat writes an outcome summary onto the Encounter", async function () {
          this.timeout(15000);
          const { ensurePlaceForScene } = await import("../hooks/auto-capture.mjs");
          await ensurePlaceForScene(group, scene, { createTimepoint: true });
          const actorType = Actor.TYPES.find((t) => t !== "base") ?? Actor.TYPES[0];
          const foe = await Actor.create({ name: "Quench Foe", type: actorType });
          const combat = await Combat.create({ scene: scene.id });
          const [c1] = await combat.createEmbeddedDocuments("Combatant", [{ actorId: foe.id }]);
          await combat.startCombat();
          const encounterUuid = await waitFor(() => combat.getFlag("campaign-record", "encounterUuid"));
          await c1.update({ defeated: true });
          await combat.delete();
          const encounter = await fromUuid(encounterUuid);
          await waitFor(() => encounter.system.outcome?.includes("Died"));
          assert.ok(encounter.system.outcome.includes("Died"), "died bucket present");
          await foe.delete();
        });
      });
    },
    { displayName: "Campaign Record: Auto Capture" }
  );
});
