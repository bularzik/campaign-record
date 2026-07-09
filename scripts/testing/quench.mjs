import { createGroup, isGroup, setRecordHidden } from "../data/groups.mjs";
import { RECORD_TYPES, typeId } from "../constants.mjs";
import {
  getTimepoints, addTimepoint, renameTimepoint, moveTimepoint, deleteTimepoint,
  attachRecord, detachRecord, recordsAtTimepoint
} from "../data/timepoints.mjs";
import { isRecordVisible } from "../logic/visibility.mjs";

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
          assert.equal(page.ownership.default, CONST.DOCUMENT_META_OWNERSHIP_LEVELS.DEFAULT);
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

        it("attaches records and cleans references on delete", async () => {
          const tp = await addTimepoint(group, "The Heist");
          await attachRecord(page, tp.id);
          assert.equal(recordsAtTimepoint(group, tp.id, game.user).length, 1);
          await detachRecord(page, tp.id);
          assert.equal(recordsAtTimepoint(group, tp.id, game.user).length, 0);
          await attachRecord(page, tp.id);
          await deleteTimepoint(group, tp.id);
          assert.equal(page.system.timepoints.has(tp.id), false);
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
});
