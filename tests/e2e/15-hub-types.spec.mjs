import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("hub integration for phase 3 types", () => {
  let page, ids;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
    ids = await createGroupWithPage(page, "E2E HubTypes Group", "E2E HubTypes Shop", "campaign-record.shop");
    await page.evaluate(
      async ({ groupId, pageId }) => {
        const group = game.journal.get(groupId);
        await group.pages.get(pageId).update({
          "system.shopType": "Blacksmith",
          "system.inventory": [
            { id: foundry.utils.randomID(), name: "Vorpal Cheese", price: "999 gp", quantity: 1, item: null }
          ]
        });
        await group.createEmbeddedDocuments("JournalEntryPage", [
          { name: "E2E HubTypes PC", type: "campaign-record.pc",
            system: { playerName: "Dan", classLevel: "Rogue 3" } },
          { name: "E2E HubTypes Checklist", type: "campaign-record.checklist",
            system: { items: [
              { id: foundry.utils.randomID(), text: "Investigate the lighthouse", done: true, assignee: "" },
              { id: foundry.utils.randomID(), text: "Report back", done: false, assignee: "" }
            ] } }
        ]);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(page, "E2E HubTypes");
    await page.close();
  });

  const openHub = () =>
    page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const hub = CampaignHub.open();
      await hub.render(true);
    });

  test("type filter offers one checkbox per record type plus journal, and phase-3 subtitles", async () => {
    await openHub();
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    // Closed by default: summary reads "All types".
    await expect(hub.locator(".doctype-summary-label")).toHaveText("All types");
    await hub.locator(".doctype-summary").click();
    // 10 record types + journal = 11 checkboxes.
    await expect(hub.locator('.doctype-menu input[name="doctype-check"]')).toHaveCount(11);
    await expect(hub.locator(".record-list")).toContainText("Blacksmith");     // shop subtitle
    await expect(hub.locator(".record-list")).toContainText("Dan — Rogue 3");  // pc subtitle
    await expect(hub.locator(".record-list")).toContainText("1/2 done");       // checklist subtitle
  });

  test("checking types filters the list; menu stays open; summary updates", async () => {
    await openHub();
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });

    await hub.locator(".doctype-summary").click();
    await hub.locator('.doctype-menu input[value="shop"]').check();
    // Menu stays open for multi-select.
    await expect(hub.locator(".doctype-menu")).toBeVisible();
    await expect(hub.locator(".record-list")).toContainText("E2E HubTypes Shop");
    await expect(hub.locator(".record-list")).not.toContainText("E2E HubTypes PC");

    await hub.locator('.doctype-menu input[value="pc"]').check();
    // Two selected -> "first label +1" (shop precedes journal but pc precedes shop in list order).
    // Close the menu to read the summary.
    await hub.locator(".record-list").click();
    await expect(hub.locator(".doctype-menu")).toHaveCount(0);
    await expect(hub.locator(".doctype-summary-label")).toContainText("+1");

    // Reopen and uncheck both -> back to "All types" and unfiltered.
    await hub.locator(".doctype-summary").click();
    await hub.locator('.doctype-menu input[value="shop"]').uncheck();
    await hub.locator('.doctype-menu input[value="pc"]').uncheck();
    await hub.locator(".record-list").click();
    await expect(hub.locator(".doctype-summary-label")).toHaveText("All types");
    await expect(hub.locator(".record-list")).toContainText("E2E HubTypes PC");
  });

  test("search hits shop inventory and checklist item text", async () => {
    const hits = (q) =>
      page.evaluate(async (q) => {
        const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
        const hub = CampaignHub.open();
        hub.state.query = q;
        await hub.render(true);
        return hub.element.querySelector(".hub-index").textContent;
      }, q);
    expect(await hits("vorpal")).toContain("E2E HubTypes Shop");
    expect(await hits("lighthouse")).toContain("E2E HubTypes Checklist");
  });
});
