import { test, expect } from "@playwright/test";
import { login, createGroupWithPage, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

test.describe("record pane header: image & tags", () => {
  test("GM sees the thumbnail button; picking an image updates header and index", async ({ page }) => {
    await login(page, "Gamemaster");
    const a = await createGroupWithPage(page, "E2E Header Group", "E2E Header Npc", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    await hub.locator(".record-row", { hasText: "E2E Header Npc" }).click();

    const button = hub.locator('.record-pane-header [data-action="pickRecordImage"]');
    await expect(button).toBeVisible();
    await expect(button.locator("i.fa-image")).toBeVisible(); // placeholder icon, no image yet

    // FilePicker's file browser is not e2e-driven (tier policy / no fixture
    // files): set the image through the same update path the picker callback
    // uses, then assert every surface reflects it.
    await page.evaluate(async ({ a }) => {
      const group = game.journal.get(a.groupId);
      const p = group.pages.find((x) => x.name === "E2E Header Npc");
      await p.update({ "system.image": "icons/svg/mystery-man.svg" });
    }, { a });
    await expect(button.locator("img")).toHaveAttribute("src", "icons/svg/mystery-man.svg");
    await expect(
      hub.locator(".record-row", { hasText: "E2E Header Npc" }).locator("img.record-thumb")
    ).toHaveAttribute("src", "icons/svg/mystery-man.svg");

    await deleteGroupsByPrefix(page, "E2E Header");
  });

  test("no image/tag buttons on a core text page", async ({ page }) => {
    await login(page, "Gamemaster");
    await createGroupWithPage(page, "E2E Header Text Group", "E2E Header Text", "text");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    await hub.locator(".record-row", { hasText: "E2E Header Text" }).click();
    await expect(hub.locator(".hub-record.active .record-pane-mount")).toBeVisible();
    await expect(hub.locator('.record-pane-header [data-action="pickRecordImage"]')).toHaveCount(0);
    await expect(hub.locator('.record-pane-header [data-action="toggleTagPopover"]')).toHaveCount(0);
    await deleteGroupsByPrefix(page, "E2E Header Text");
  });
});
