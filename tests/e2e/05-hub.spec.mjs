import { test, expect } from "@playwright/test";
import { login } from "./helpers/foundry.mjs";

test.describe("campaign hub shell", () => {
  test("opens from the journal sidebar and switches tabs", async ({ page }) => {
    await login(page, "Gamemaster");
    await page.evaluate(() => ui.sidebar.changeTab("journal", "primary"));
    const openBtn = page.locator(".campaign-record-open-hub");
    await expect(openBtn).toBeVisible();
    await openBtn.evaluate((el) => el.click());

    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    await expect(hub.locator('select[name="group-select"]')).toBeVisible();
    await expect(hub.locator('.hub-index[data-tab="index"]')).toHaveClass(/active/);

    await hub.locator('[data-action="tab"][data-tab="timeline"]').click();
    await expect(hub.locator('.hub-timeline[data-tab="timeline"]')).toHaveClass(/active/);
    await expect(hub.locator('.hub-index[data-tab="index"]')).not.toHaveClass(/active/);
  });

  test("player also gets the hub button", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, "User 1");
    await page.evaluate(() => ui.sidebar.changeTab("journal", "primary"));
    await expect(page.locator(".campaign-record-open-hub")).toBeVisible();
    await ctx.close();
  });
});
