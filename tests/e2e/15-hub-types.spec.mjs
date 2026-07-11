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

  test("index shows one chip per record type plus journal, and phase-3 subtitles", async () => {
    await openHub();
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    await expect(hub.locator(".type-chip")).toHaveCount(11);
    await expect(hub.locator(".record-list")).toContainText("Blacksmith");     // shop subtitle
    await expect(hub.locator(".record-list")).toContainText("Dan — Rogue 3");  // pc subtitle
    await expect(hub.locator(".record-list")).toContainText("1/2 done");       // checklist subtitle
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
