import { test, expect } from "@playwright/test";
import { login, createGroupWithPage, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

/** Open the hub and navigate to a record; polls for the async-registered instance. */
async function openHubAt(page, uuid, mode) {
  await page.evaluate(async ({ uuid, mode }) => {
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    CampaignHub.open();
    let hub = null;
    for (let i = 0; i < 50 && !hub; i++) {
      hub = [...(foundry.applications.instances?.values?.() ?? [])].find(
        (a) => a?.constructor?.name === "CampaignHub"
      );
      if (!hub) await new Promise((r) => setTimeout(r, 100));
    }
    if (!hub) throw new Error("CampaignHub instance not found");
    await hub.navigateToRecord(uuid, { mode });
  }, { uuid, mode });
}

/**
 * Regression: editing a journal (text) page in the hub pane must not be torn
 * down by external document updates. Before the fix, every external
 * updateJournalEntry(Page) re-rendered the hub's `record` part, re-parented the
 * embedded sheet, and threw "Cannot read properties of null (reading
 * 'matchesNode')" while destroying the active editor. The hub now skips the
 * `record` part while a valid record is open, so the mount node — and the live
 * editor — survive.
 */
test.describe("journal edit guard", () => {
  test.afterEach(async ({ page }) => {
    await deleteGroupsByPrefix(page, "E2E JGuard");
    await page.evaluate(async () => {
      const ids = game.journal.filter((j) => j.name.startsWith("E2E JGuard Ext")).map((j) => j.id);
      if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
    });
  });

  test("external updates do not re-mount or error while editing a journal", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await login(page, "Gamemaster");
    const { pageUuid } = await createGroupWithPage(page, "E2E JGuard Group", "E2E JGuard Journal", "text");
    // A separate journal whose updates are the "external" trigger.
    await page.evaluate(() => JournalEntry.implementation.create({ name: "E2E JGuard Ext" }));

    await openHubAt(page, pageUuid, "edit");

    const editor = page.locator("#campaign-hub .record-pane-mount [contenteditable='true']").first();
    await editor.waitFor({ timeout: 10000 });

    // Count real pane re-mounts (direct childList replacement of the mount only —
    // NOT subtree, which would catch normal in-editor keystrokes).
    await page.evaluate(() => {
      window.__remounts = 0;
      const mount = document.querySelector("#campaign-hub .record-pane-mount");
      new MutationObserver((muts) => {
        for (const m of muts) if (m.addedNodes.length) window.__remounts++;
      }).observe(mount, { childList: true });
    });

    // Fire a burst of external updates.
    await page.evaluate(async () => {
      const ext = game.journal.find((j) => j.name === "E2E JGuard Ext");
      for (let i = 0; i < 6; i++) {
        await ext.update({ name: `E2E JGuard Ext ${i}` });
        await new Promise((r) => setTimeout(r, 150));
      }
    });
    await page.waitForTimeout(500);

    const remounts = await page.evaluate(() => window.__remounts);
    const matchesNodeErrors = errors.filter((e) => e.includes("matchesNode"));

    expect(matchesNodeErrors).toEqual([]);
    expect(remounts).toBe(0);
    await expect(editor).toBeVisible();
  });

  test("inline setting on makes a journal an always-open editor in view mode", async ({ page }) => {
    await login(page, "Gamemaster");
    const { pageUuid } = await createGroupWithPage(page, "E2E JGuard Group", "E2E JGuard Inline", "text");
    await page.evaluate(() => game.settings.set("campaign-record", "inlineEditing", true));
    await openHubAt(page, pageUuid, "view");

    await expect(
      page.locator("#campaign-hub .record-pane-mount .campaign-record-content.inline-edit prose-mirror")
    ).toBeVisible({ timeout: 10000 });
  });
});
