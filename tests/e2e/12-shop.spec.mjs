import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("shop inventory", () => {
  let page, ids;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
    ids = await createGroupWithPage(page, "E2E Shop Group", "E2E Shop", "campaign-record.shop");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(page, "E2E Shop");
    await page.close();
  });

  const inventory = () =>
    page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.toObject().inventory,
      { groupId: ids.groupId, pageId: ids.pageId }
    );

  test("inventory rows: add, edit name/price/quantity, delete", async () => {
    await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = page.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[data-action="addInventoryRow"]').waitFor({ timeout: 15_000 });

    // add
    await sheet.locator('[data-action="addInventoryRow"]').click();
    await expect.poll(async () => (await inventory()).length).toBe(1);

    // edit
    const row = sheet.locator('[data-rows="inventory"] [data-row-id]').first();
    await row.locator('[data-row-field="name"]').fill("Longsword");
    await row.locator('[data-row-field="name"]').dispatchEvent("change");
    await row.locator('[data-row-field="price"]').fill("15 gp");
    await row.locator('[data-row-field="price"]').dispatchEvent("change");
    await row.locator('[data-row-field="quantity"]').fill("3");
    await row.locator('[data-row-field="quantity"]').dispatchEvent("change");
    await expect
      .poll(async () => (await inventory())[0])
      .toMatchObject({ name: "Longsword", price: "15 gp", quantity: 3 });

    // second row, then delete it
    await sheet.locator('[data-action="addInventoryRow"]').click();
    await expect.poll(async () => (await inventory()).length).toBe(2);
    await sheet.locator('[data-action="deleteInventoryRow"]').last().click();
    await expect.poll(async () => (await inventory()).length).toBe(1);
    expect((await inventory())[0].name).toBe("Longsword");
  });

  test("view mode renders the inventory table", async () => {
    await page.evaluate(
      async ({ groupId, pageId }) => {
        const g = game.journal.get(groupId);
        await g.pages.get(pageId).sheet.close();
        await g.sheet.render(true);
        await g.sheet.goToPage(pageId);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const table = page.locator(".journal-entry-page table.shop-inventory");
    await table.waitFor({ timeout: 15_000 });
    await expect(table).toContainText("Longsword");
    await expect(table).toContainText("15 gp");
    await page.evaluate(({ groupId }) => game.journal.get(groupId).sheet.close(), ids);
  });
});
