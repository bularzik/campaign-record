import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("loot sheet", () => {
  let page, ids;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
    ids = await createGroupWithPage(page, "E2E Loot Group", "E2E Loot", "campaign-record.loot");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(page, "E2E Loot");
    await page.close();
  });

  const system = () =>
    page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.toObject(),
      { groupId: ids.groupId, pageId: ids.pageId }
    );

  test("currency persists; item rows add and edit; view renders", async () => {
    await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = page.locator(".campaign-record.record-sheet").last();
    const gp = sheet.locator('[name="system.currency.gp"]');
    await gp.waitFor({ timeout: 15_000 });
    await gp.fill("250");
    await gp.dispatchEvent("change");
    await expect.poll(async () => (await system()).currency.gp).toBe(250);

    await sheet.locator('[data-action="addLootItem"]').click();
    await expect.poll(async () => (await system()).items.length).toBe(1);
    const name = sheet.locator('[data-rows="items"] [data-row-field="name"]').first();
    await name.fill("Ruby");
    await name.dispatchEvent("change");
    const qty = sheet.locator('[data-rows="items"] [data-row-field="quantity"]').first();
    await qty.fill("2");
    await qty.dispatchEvent("change");
    await expect.poll(async () => (await system()).items[0]).toMatchObject({ name: "Ruby", quantity: 2 });

    // Inline editing (client-scoped, default on) renders currency and item
    // rows as inputs; that branch is covered by 18-inline-edit. This test
    // asserts the read-only view, so switch the toggle off for this client,
    // then restore it since `page` is reused across this describe block.
    await page.evaluate(() => game.settings.set("campaign-record", "inlineEditing", false));
    await page.evaluate(
      async ({ groupId, pageId }) => {
        const g = game.journal.get(groupId);
        await g.pages.get(pageId).sheet.close();
        await g.sheet.render(true);
        await g.sheet.goToPage(pageId);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const view = page.locator(".journal-entry-page .campaign-record-content");
    await view.waitFor({ timeout: 15_000 });
    await expect(view).toContainText("250");
    await expect(view).toContainText("2 × Ruby");
    await page.evaluate(({ groupId }) => game.journal.get(groupId).sheet.close(), ids);
    await page.evaluate(() => game.settings.set("campaign-record", "inlineEditing", true));
  });

  test("source link accepts only encounter pages via drop", async () => {
    const uuids = await page.evaluate(async ({ groupId }) => {
      const g = game.journal.get(groupId);
      // createEmbeddedDocuments does NOT guarantee the returned array
      // preserves input order (observed swapped in real runs, which made the
      // "wrong type" drop below hit the encounter page) — resolve by name.
      const created = await g.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Loot Source Enc", type: "campaign-record.encounter" },
        { name: "E2E Loot Source Npc", type: "campaign-record.npc" }
      ]);
      const byName = Object.fromEntries(created.map((p) => [p.name, p.uuid]));
      return { enc: byName["E2E Loot Source Enc"], npc: byName["E2E Loot Source Npc"] };
    }, { groupId: ids.groupId });
    const drop = (uuid) =>
      page.evaluate(
        async ({ groupId, pageId, uuid }) => {
          const sheet = game.journal.get(groupId).pages.get(pageId).sheet;
          await sheet.render(true);
          await sheet._onDropDocument({ type: "JournalEntryPage", uuid });
        },
        { groupId: ids.groupId, pageId: ids.pageId, uuid }
      );
    await drop(uuids.npc); // wrong type: silent no-op
    await expect.poll(async () => (await system()).source).toBeFalsy();
    await drop(uuids.enc);
    await expect.poll(async () => (await system()).source).toBe(uuids.enc);
  });
});
