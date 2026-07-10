import { test, expect } from "@playwright/test";
import { login, createGroupWithPage, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

test.describe("hub record pane", () => {
  test.afterEach(async ({ page }) => {
    await deleteGroupsByPrefix(page, "E2E Pane");
  });

  test("index click opens the record in-pane; tabs return to the index", async ({ page }) => {
    await login(page, "Gamemaster");
    await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Npc", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.waitFor();
    await hub.locator(".record-row", { hasText: "E2E Pane Npc" }).click();

    await expect(hub.locator(".record-pane-title")).toHaveText("E2E Pane Npc");
    await expect(hub.locator(".record-pane-mount dl.record-facts")).toBeVisible();
    await expect(hub.locator('.hub-index[data-tab="index"]')).toBeHidden();

    await hub.locator('[data-action="tab"][data-tab="index"]').click();
    await expect(hub.locator('.hub-index[data-tab="index"]')).toBeVisible();
    await expect(hub.locator(".record-pane-title")).toHaveCount(0);
  });

  test("deleting the viewed record falls back to the index", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Doomed", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.locator(".record-row", { hasText: "E2E Pane Doomed" }).click();
    await expect(hub.locator(".record-pane-title")).toHaveText("E2E Pane Doomed");
    await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).delete(),
      ids
    );
    await expect(hub.locator('.hub-index[data-tab="index"]')).toBeVisible();
  });
});
