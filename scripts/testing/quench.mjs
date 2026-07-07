import { createGroup, isGroup, setRecordHidden } from "../data/groups.mjs";
import { typeId } from "../constants.mjs";

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
});
