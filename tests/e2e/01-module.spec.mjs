import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

test.describe("module load and group creation", () => {
  test("module is active and the records folder exists (GM)", async ({ page }) => {
    await login(page, "Gamemaster");
    const state = await page.evaluate(() => ({
      active: game.modules.get("campaign-record")?.active === true,
      folder: game.folders.find((f) => f.getFlag("campaign-record", "recordsFolder"))?.name ?? null,
      models: Object.keys(CONFIG.JournalEntryPage.dataModels).filter((k) =>
        k.startsWith("campaign-record.")
      )
    }));
    expect(state.active).toBe(true);
    expect(state.folder).toBe("Campaign Records");
    expect(state.models.sort()).toEqual([
      "campaign-record.encounter",
      "campaign-record.item",
      "campaign-record.npc",
      "campaign-record.pc",
      "campaign-record.place",
      "campaign-record.quest"
    ]);
  });

  test("GM can create a group through the sidebar button and dialog", async ({ page }) => {
    await login(page, "Gamemaster");
    await page.evaluate(() => ui.sidebar.changeTab("journal", "primary"));
    const btn = page.locator(".campaign-record-create-group");
    await expect(btn).toBeVisible();
    // Synthetic click: the sidebar footer can sit outside the viewport or
    // under notification toasts, making a positional click flaky.
    await btn.evaluate((el) => el.click());
    const nameInput = page.locator('dialog input[name="name"], .application.dialog input[name="name"]');
    await nameInput.waitFor({ timeout: 10_000 });
    await nameInput.fill("E2E UI Group");
    await page
      .locator('dialog button[data-action="ok"], .application.dialog button[data-action="ok"]')
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const g = game.journal.getName("E2E UI Group");
          if (!g) return null;
          return {
            flag: g.getFlag("campaign-record", "group"),
            ownership: g.ownership.default,
            folder: g.folder?.name ?? null
          };
        })
      )
      .toEqual({ flag: { timepoints: [] }, ownership: 3, folder: "Campaign Records" });
    await deleteGroupsByPrefix(page, "E2E UI Group");
  });

  test("create-group button visibility matches the player's journal-create permission", async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, "User 1");
    await page.evaluate(() => ui.sidebar.changeTab("journal", "primary"));
    const canCreate = await page.evaluate(() => game.user.can("JOURNAL_CREATE"));
    const btnCount = await page.locator(".campaign-record-create-group").count();
    expect(btnCount).toBe(canCreate ? 1 : 0);
    await ctx.close();
  });
});
