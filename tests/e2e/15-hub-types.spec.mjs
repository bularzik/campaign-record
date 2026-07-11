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

  test("index doctype filter offers one option per record type plus journal, and phase-3 subtitles", async () => {
    await openHub();
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    // 10 record types + journal = 11 selectable options, plus the blank
    // "Add type…" prompt option.
    const typeAdd = hub.locator("select.doctype-add");
    await expect(typeAdd).toBeVisible();
    await expect(typeAdd.locator('option[value]:not([value=""])')).toHaveCount(11);
    await expect(hub.locator(".record-list")).toContainText("Blacksmith");     // shop subtitle
    await expect(hub.locator(".record-list")).toContainText("Dan — Rogue 3");  // pc subtitle
    await expect(hub.locator(".record-list")).toContainText("1/2 done");       // checklist subtitle
  });

  test("doctype filter chips select, filter, remove, and clear", async () => {
    await openHub();
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });

    await hub.locator("select.doctype-add").selectOption("shop");
    await expect(hub.locator('.doctype-chip[data-type="shop"]')).toBeVisible();
    await expect(hub.locator(".record-list")).toContainText("E2E HubTypes Shop");
    await expect(hub.locator(".record-list")).not.toContainText("E2E HubTypes PC");

    await hub.locator('.doctype-chip[data-type="shop"] a[data-action="removeType"]').click();
    await expect(hub.locator('.doctype-chip[data-type="shop"]')).toHaveCount(0);
    await expect(hub.locator(".record-list")).toContainText("E2E HubTypes PC");

    await hub.locator("select.doctype-add").selectOption("shop");
    await hub.locator("select.doctype-add").selectOption("pc");
    await expect(hub.locator(".doctype-chip")).toHaveCount(2);

    await hub.locator(".doctype-clear").click();
    await expect(hub.locator(".doctype-chip")).toHaveCount(0);
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
