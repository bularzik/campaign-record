import { test, expect } from "@playwright/test";
import { login, createGroupWithPage, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

test.describe("campaign hub shell", () => {
  test("opens from the journal sidebar with index and timeline visible, no tab nav", async ({ page }) => {
    await login(page, "Gamemaster");
    await page.evaluate(() => ui.sidebar.changeTab("journal", "primary"));
    const openBtn = page.locator(".campaign-record-open-hub");
    await expect(openBtn).toBeVisible();
    await openBtn.evaluate((el) => el.click());

    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    await expect(hub.locator('select[name="group-select"]')).toBeVisible();
    // The tab system is gone: index and timeline render together at all times.
    await expect(hub.locator(".hub-header nav.tabs")).toHaveCount(0);
    await expect(hub.locator(".hub-index")).toBeVisible();
    await expect(hub.locator(".hub-timeline")).toBeVisible();
  });

  test("player also gets the hub button", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, "User 1");
    await page.evaluate(() => ui.sidebar.changeTab("journal", "primary"));
    await expect(page.locator(".campaign-record-open-hub")).toBeVisible();
    await ctx.close();
  });

  test("opening an entry overlays the timeline; Back reveals it", async ({ page }) => {
    await login(page, "Gamemaster");
    await createGroupWithPage(page, "E2E Hub Shell Group", "E2E Hub Shell Npc", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });

    await hub.locator(".record-row", { hasText: "E2E Hub Shell Npc" }).click();
    await expect(hub.locator(".hub-record.active")).toBeVisible();

    // The shared right-pane nav now renders in both the record header and
    // the timeline tools, so scope to the record header's Back button.
    await hub.locator(".hub-record.active .record-pane-header [data-action=\"paneBack\"]").click();
    await expect(hub.locator(".hub-record.active")).toHaveCount(0);
    await expect(hub.locator(".hub-timeline")).toBeVisible();

    await deleteGroupsByPrefix(page, "E2E Hub Shell");
  });

  test("New Entry sits in the timeline tools by default and beside Edit when viewing", async ({ page }) => {
    await login(page, "Gamemaster");
    await createGroupWithPage(page, "E2E Hub Nav Group", "E2E Hub Nav Npc", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });

    await expect(hub.locator(".hub-index .index-controls [data-action=\"newRecord\"]")).toHaveCount(0);
    await expect(hub.locator(".hub-timeline [data-action=\"newRecord\"]")).toBeVisible();

    await hub.locator(".record-row", { hasText: "E2E Hub Nav Npc" }).click();
    const header = hub.locator(".record-pane-header");
    await expect(header.locator('[data-action="newRecord"]')).toBeVisible();
    await expect(header.locator('[data-action="toggleEditMode"]')).toBeVisible();

    await deleteGroupsByPrefix(page, "E2E Hub Nav");
  });
});
