import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("PC and Item record sheets", () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(page, "E2E PcItem");
    await page.close();
  });

  test("PC edit sheet renders, persists, and view mode shows the facts", async () => {
    const { groupId, pageId } = await createGroupWithPage(
      page, "E2E PcItem Group", "E2E PC", "campaign-record.pc"
    );
    await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId, pageId }
    );
    const sheet = page.locator(".campaign-record.record-sheet").last();
    const player = sheet.locator('[name="system.playerName"]');
    await player.waitFor({ timeout: 15_000 });
    await player.fill("Dan");
    await player.dispatchEvent("change");
    const cls = sheet.locator('[name="system.classLevel"]');
    await cls.fill("Wizard 5");
    await cls.dispatchEvent("change");
    await expect
      .poll(() =>
        page.evaluate(
          ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.classLevel,
          { groupId, pageId }
        )
      )
      .toBe("Wizard 5");
    await page.evaluate(
      async ({ groupId, pageId }) => {
        const g = game.journal.get(groupId);
        await g.pages.get(pageId).sheet.close();
        await g.sheet.render(true);
        await g.sheet.goToPage(pageId);
      },
      { groupId, pageId }
    );
    const facts = page.locator(".journal-entry-page dl.record-facts");
    await facts.waitFor({ timeout: 15_000 });
    await expect(facts).toContainText("Dan");
    await expect(facts).toContainText("Wizard 5");
    await page.evaluate(({ groupId }) => game.journal.get(groupId).sheet.close(), { groupId, pageId });
  });

  test("Item edit sheet renders and persists rarity", async () => {
    const { groupId, pageId } = await page.evaluate(async () => {
      const g = game.journal.getName("E2E PcItem Group");
      const [p] = await g.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Item", type: "campaign-record.item" }
      ]);
      await p.sheet.render(true);
      return { groupId: g.id, pageId: p.id };
    });
    const sheet = page.locator(".campaign-record.record-sheet").last();
    const rarity = sheet.locator('[name="system.rarity"]');
    await rarity.waitFor({ timeout: 15_000 });
    await rarity.fill("Very Rare");
    await rarity.dispatchEvent("change");
    await expect
      .poll(() =>
        page.evaluate(
          ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.rarity,
          { groupId, pageId }
        )
      )
      .toBe("Very Rare");
    await expect(sheet.locator("prose-mirror")).toHaveCount(2);
    await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.close(),
      { groupId, pageId }
    );
  });
});
