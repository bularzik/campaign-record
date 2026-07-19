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

  test("GM adds and removes tags via the popover; badge tracks the count", async ({ page }) => {
    await login(page, "Gamemaster");
    await createGroupWithPage(page, "E2E Tag Group", "E2E Tag Npc", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    await hub.locator(".record-row", { hasText: "E2E Tag Npc" }).click();

    const tagButton = hub.locator('.record-pane-header [data-action="toggleTagPopover"]');
    await tagButton.click();
    const popover = hub.locator(".tag-popover");
    await popover.locator('input[name="tag-add"]').fill("ally");
    await popover.locator('input[name="tag-add"]').press("Enter");
    await expect(hub.locator('.tag-chip[data-tag="ally"]')).toBeVisible();
    await expect(tagButton.locator(".tag-count")).toHaveText("1");
    // The input clears after a successful add (not repopulated by the sync hook).
    await expect(hub.locator('.tag-popover input[name="tag-add"]')).toHaveValue("");

    // Duplicate (case-insensitive) is a no-op.
    await hub.locator('.tag-popover input[name="tag-add"]').fill("ALLY");
    await hub.locator('.tag-popover input[name="tag-add"]').press("Enter");
    await expect(hub.locator(".tag-chip")).toHaveCount(1);

    await hub.locator('.tag-chip[data-tag="ally"] [data-action="removeTag"]').click();
    await expect(hub.locator(".tag-chip")).toHaveCount(0);
    await expect(tagButton.locator(".tag-count")).toHaveCount(0);

    // Outside click closes the popover.
    await hub.locator(".record-pane-title").click();
    await expect(hub.locator(".tag-popover")).toHaveCount(0);

    await deleteGroupsByPrefix(page, "E2E Tag Group");
  });

  test("a player sees tags read-only: no remove links, no add input", async ({ browser, page }) => {
    await login(page, "Gamemaster");
    const a = await createGroupWithPage(page, "E2E Tag RO Group", "E2E Tag RO Npc", "campaign-record.npc");
    await page.evaluate(async ({ a }) => {
      const group = game.journal.get(a.groupId);
      await group.update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER } });
      const p = group.pages.find((x) => x.name === "E2E Tag RO Npc");
      await p.update({ "system.tags": ["ally", "city"] });
    }, { a });

    const playerContext = await browser.newContext();
    const playerPage = await playerContext.newPage();
    await login(playerPage, "User 1");
    await playerPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = playerPage.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    await hub.locator(".record-row", { hasText: "E2E Tag RO Npc" }).click();
    await hub.locator('.record-pane-header [data-action="toggleTagPopover"]').click();
    await expect(hub.locator(".tag-chip")).toHaveCount(2);
    await expect(hub.locator('.tag-popover [data-action="removeTag"]')).toHaveCount(0);
    await expect(hub.locator('.tag-popover input[name="tag-add"]')).toHaveCount(0);
    // No image on this record and no update permission → no image button either.
    await expect(hub.locator('.record-pane-header [data-action="pickRecordImage"]')).toHaveCount(0);
    await playerContext.close();

    await deleteGroupsByPrefix(page, "E2E Tag RO");
  });
});
