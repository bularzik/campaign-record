import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("encounter sheet", () => {
  let page, ids;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
    ids = await createGroupWithPage(page, "E2E Encounter Group", "E2E Encounter", "campaign-record.encounter");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(page, "E2E Encounter");
    await page.close();
  });

  const system = () =>
    page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.toObject(),
      { groupId: ids.groupId, pageId: ids.pageId }
    );

  test("combatant rows: add, edit name and count, delete; fields persist", async () => {
    await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = page.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[data-action="addCombatant"]').waitFor({ timeout: 15_000 });

    await sheet.locator('[name="system.difficulty"]').fill("Deadly");
    await sheet.locator('[name="system.difficulty"]').dispatchEvent("change");
    await expect.poll(async () => (await system()).difficulty).toBe("Deadly");

    await sheet.locator('[data-action="addCombatant"]').click();
    await expect.poll(async () => (await system()).combatants.length).toBe(1);

    const name = sheet.locator('[data-rows="combatants"] [data-row-field="name"]').first();
    await name.fill("Goblin");
    await name.dispatchEvent("change");
    const count = sheet.locator('[data-rows="combatants"] [data-row-field="count"]').first();
    await count.fill("4");
    await count.dispatchEvent("change");
    await expect.poll(async () => (await system()).combatants[0]).toMatchObject({ name: "Goblin", count: 4 });

    await sheet.locator('[data-action="addCombatant"]').click();
    await expect.poll(async () => (await system()).combatants.length).toBe(2);
    await sheet.locator('[data-action="deleteCombatant"]').last().click();
    await expect.poll(async () => (await system()).combatants.length).toBe(1);
    expect((await system()).combatants[0].name).toBe("Goblin");
  });

  test("view mode lists combatants with counts", async () => {
    await page.evaluate(
      async ({ groupId, pageId }) => {
        const g = game.journal.get(groupId);
        await g.pages.get(pageId).sheet.close();
        await g.sheet.render(true);
        await g.sheet.goToPage(pageId);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const combatants = page.locator(".journal-entry-page .encounter-combatants");
    await combatants.waitFor({ timeout: 15_000 });
    await expect(combatants).toContainText("4 × Goblin");
    await page.evaluate(({ groupId }) => game.journal.get(groupId).sheet.close(), ids);
  });
});
