import { test, expect } from "@playwright/test";
import { login } from "./helpers/foundry.mjs";

test.describe("hub gear menu", () => {
  test("gear menu exposes import, export, edit toggle, and the auto-capture target", async ({ page }) => {
    await login(page, "Gamemaster");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });

    await hub.locator(".hub-settings-trigger").click();
    const panel = hub.locator(".hub-settings-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-action="importDocument"]')).toBeVisible();
    await expect(panel.locator('[data-action="exportGroup"]')).toBeVisible();
    await expect(panel.locator('[data-action="toggleInlineEdit"]')).toBeVisible();
    await expect(panel.locator('select[name="auto-target-select"]')).toBeVisible();
    // the loose header buttons are gone
    await expect(hub.locator('.hub-header > [data-action="importDocument"]')).toHaveCount(0);
  });

  test("outside click closes the menu", async ({ page }) => {
    await login(page, "Gamemaster");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });

    await hub.locator(".hub-settings-trigger").click();
    await expect(hub.locator(".hub-settings-panel")).toBeVisible();

    await hub.locator(".hub-index").click();
    await expect(hub.locator(".hub-settings-panel")).toHaveCount(0);
  });
});
