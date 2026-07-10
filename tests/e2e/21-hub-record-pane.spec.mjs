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

  test("rail lists group records, highlights current, and jumps on click", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane One", "campaign-record.npc");
    await page.evaluate(async ({ groupId }) => {
      await game.journal.get(groupId).createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Pane Two", type: "campaign-record.place" }
      ]);
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    }, ids);
    const hub = page.locator("#campaign-hub");
    await hub.locator(".record-row", { hasText: "E2E Pane One" }).click();

    const rail = hub.locator(".record-rail");
    await expect(rail.locator(".rail-record", { hasText: "E2E Pane One" })).toHaveClass(/current/);
    await rail.locator(".rail-record", { hasText: "E2E Pane Two" }).click();
    await expect(hub.locator(".record-pane-title")).toHaveText("E2E Pane Two");
    await expect(rail.locator(".rail-record", { hasText: "E2E Pane Two" })).toHaveClass(/current/);
  });

  test("rail collapse persists across a close/reopen", async ({ page }) => {
    await login(page, "Gamemaster");
    await createGroupWithPage(page, "E2E Pane Group", "E2E Pane One", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.locator(".record-row", { hasText: "E2E Pane One" }).click();
    await hub.locator('[data-action="toggleRail"]').click();
    await expect(hub.locator(".record-rail")).toHaveClass(/collapsed/);

    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.toggle(); // close
      CampaignHub.toggle(); // reopen
    });
    await hub.locator(".record-row", { hasText: "E2E Pane One" }).click();
    await expect(hub.locator(".record-rail")).toHaveClass(/collapsed/);
  });

  test("back/forward traverse visits, loops included", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane A", "campaign-record.npc");
    await page.evaluate(async ({ groupId }) => {
      await game.journal.get(groupId).createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Pane B", type: "campaign-record.place" }
      ]);
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    }, ids);
    const hub = page.locator("#campaign-hub");
    const rail = hub.locator(".record-rail");
    const title = hub.locator(".record-pane-title");

    // Visit A -> B -> A (a loop) via index + rail jumps.
    await hub.locator(".record-row", { hasText: "E2E Pane A" }).click();
    await rail.locator(".rail-record", { hasText: "E2E Pane B" }).click();
    await rail.locator(".rail-record", { hasText: "E2E Pane A" }).click();
    await expect(title).toHaveText("E2E Pane A");

    await hub.locator('[data-action="paneBack"]').click();
    await expect(title).toHaveText("E2E Pane B");
    await hub.locator('[data-action="paneBack"]').click();
    await expect(title).toHaveText("E2E Pane A");
    await hub.locator('[data-action="paneBack"]').click();
    await expect(hub.locator('.hub-index[data-tab="index"]')).toBeVisible(); // root

    await hub.locator('[data-action="paneForward"]').click();
    await expect(title).toHaveText("E2E Pane A");
    await hub.locator('[data-action="paneForward"]').click();
    await expect(title).toHaveText("E2E Pane B");
  });

  test("edit toggle flips to the edit form and persists a change", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Editable", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.locator(".record-row", { hasText: "E2E Pane Editable" }).click();

    await hub.locator('[data-action="toggleEditMode"]').click();
    const roleInput = hub.locator('.record-pane-mount [name="system.role"]');
    await roleInput.waitFor();
    await roleInput.fill("Quartermaster");
    await roleInput.blur(); // submitOnChange persists

    await hub.locator('[data-action="toggleEditMode"]').click();
    await expect(hub.locator(".record-pane-mount dl.record-facts")).toContainText("Quartermaster");
    const stored = await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.role,
      ids
    );
    expect(stored).toBe("Quartermaster");
  });

  test("text pages view and edit in-pane", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Text", "text");
    await page.evaluate(async ({ groupId, pageId }) => {
      await game.journal.get(groupId).pages.get(pageId).update({
        "text.content": "<p>Chronicle of the keep</p>"
      });
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    }, ids);
    const hub = page.locator("#campaign-hub");
    await hub.locator(".record-row", { hasText: "E2E Pane Text" }).click();
    await expect(hub.locator(".record-pane-mount")).toContainText("Chronicle of the keep");

    await hub.locator('[data-action="toggleEditMode"]').click();
    await expect(hub.locator('.record-pane-mount [contenteditable="true"]').first()).toBeVisible();
  });

  test("new record opens in-pane in edit mode", async ({ page }) => {
    await login(page, "Gamemaster");
    await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Seed", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.locator('[data-action="newRecord"]').click();
    const nameInput = page.locator('dialog input[name="name"], .application.dialog input[name="name"]');
    await nameInput.waitFor({ timeout: 10_000 });
    await nameInput.fill("E2E Pane Fresh");
    const groupSelect = page.locator('dialog select[name="group"], .application.dialog select[name="group"]');
    await groupSelect.selectOption({ label: "E2E Pane Group" });
    await page
      .locator('dialog button[data-action="ok"], .application.dialog button[data-action="ok"]')
      .click();

    await expect(hub.locator(".record-pane-title")).toHaveText("E2E Pane Fresh");
    await expect(hub.locator('.record-pane-mount [name="system.role"]')).toBeVisible();
  });

  test("player without update permission gets no edit toggle", async ({ page, browser }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Locked", "campaign-record.npc");
    await page.evaluate(async ({ groupId }) => {
      await game.journal.get(groupId).update({
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
      });
    }, ids);

    const ctx = await browser.newContext();
    const playerPage = await ctx.newPage();
    try {
      await login(playerPage, "User 1");
      await playerPage.evaluate(async () => {
        const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
        CampaignHub.open();
      });
      const hub = playerPage.locator("#campaign-hub");
      await hub.locator(".record-row", { hasText: "E2E Pane Locked" }).click();
      await expect(hub.locator(".record-pane-title")).toHaveText("E2E Pane Locked");
      await expect(hub.locator('[data-action="toggleEditMode"]')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
