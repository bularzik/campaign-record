import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("dnd5e integration (world-b is dnd5e)", () => {
  let page, ids;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
    ids = await createGroupWithPage(page, "E2E 5e Group", "E2E 5e Shop", "campaign-record.shop");
  });

  test.afterAll(async () => {
    await page.evaluate(async () => {
      for (const name of ["E2E 5e Sword", "E2E 5e Guard"]) {
        await game.items.getName(name)?.delete();
        await game.actors.getName(name)?.delete();
      }
    });
    await deleteGroupsByPrefix(page, "E2E 5e");
    await page.close();
  });

  test("item drop fills shop price and item-record rarity/type", async () => {
    const itemUuid = await page.evaluate(async () => {
      const item = await Item.create({
        name: "E2E 5e Sword",
        type: "weapon",
        system: { price: { value: 15, denomination: "gp" }, rarity: "rare" }
      });
      return item.uuid;
    });

    // shop inventory autofill
    await page.evaluate(
      async ({ groupId, pageId, itemUuid }) => {
        const sheet = game.journal.get(groupId).pages.get(pageId).sheet;
        await sheet.render(true);
        await sheet._onDropDocument({ type: "Item", uuid: itemUuid });
      },
      { groupId: ids.groupId, pageId: ids.pageId, itemUuid }
    );
    await expect
      .poll(() =>
        page.evaluate(
          ({ groupId, pageId }) =>
            game.journal.get(groupId).pages.get(pageId).system.toObject().inventory[0],
          { groupId: ids.groupId, pageId: ids.pageId }
        )
      )
      .toMatchObject({ name: "E2E 5e Sword", price: "15 gp", quantity: 1 });

    // item record autofill (empty fields only)
    const rec = await page.evaluate(
      async ({ groupId, itemUuid }) => {
        const g = game.journal.get(groupId);
        const [p] = await g.createEmbeddedDocuments("JournalEntryPage", [
          { name: "E2E 5e Item Record", type: "campaign-record.item" }
        ]);
        await p.sheet.render(true);
        await p.sheet._onDropDocument({ type: "Item", uuid: itemUuid });
        return p.system.toObject();
      },
      { groupId: ids.groupId, itemUuid }
    );
    expect(rec.item).toBe(itemUuid);
    expect(rec.rarity.toLowerCase()).toContain("rare");
    expect(rec.itemType.length).toBeGreaterThan(0);
  });

  test("linked actor shows portrait and stats on the NPC sheet", async () => {
    const actorUuid = await page.evaluate(async () => {
      const actor = await Actor.create({ name: "E2E 5e Guard", type: "npc" });
      return actor.uuid;
    });
    await page.evaluate(
      async ({ groupId, actorUuid }) => {
        const g = game.journal.get(groupId);
        const [p] = await g.createEmbeddedDocuments("JournalEntryPage", [
          { name: "E2E 5e NPC", type: "campaign-record.npc" }
        ]);
        await p.sheet.render(true);
        await p.sheet._onDropDocument({ type: "Actor", uuid: actorUuid });
      },
      { groupId: ids.groupId, actorUuid }
    );
    const info = page.locator(".campaign-record.record-sheet .actor-info").last();
    await info.waitFor({ timeout: 15_000 });
    await expect(info).toContainText("E2E 5e Guard");
    await expect(info).toContainText("HP");
  });
});
