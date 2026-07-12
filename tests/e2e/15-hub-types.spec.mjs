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

  // CampaignHub is a singleton and typeMenuOpen is persistent instance state, so a
  // prior test may have left the dropdown open. Open idempotently — a blind toggle
  // click would close an already-open menu.
  // Track open-state by presence: the template renders .doctype-menu only when
  // open, and Playwright reports this position:absolute popup as "not visible",
  // so count is reliable where toBeVisible/isVisible are not.
  const openTypeMenu = async (hub) => {
    if ((await hub.locator(".doctype-menu").count()) === 0) {
      await hub.locator(".doctype-summary").click();
    }
    await expect(hub.locator(".doctype-menu")).toHaveCount(1);
  };

  // Close deterministically via the trigger toggle (the summary-click branch flips
  // typeMenuOpen directly), not an outside-click whose timing races the async
  // re-render a checkbox toggle kicks off.
  const closeTypeMenu = async (hub) => {
    if ((await hub.locator(".doctype-menu").count()) > 0) {
      await hub.locator(".doctype-summary").click();
    }
    await expect(hub.locator(".doctype-menu")).toHaveCount(0);
  };

  test("type filter offers one checkbox per record type plus journal, and phase-3 subtitles", async () => {
    await openHub();
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    // Closed by default: summary reads "All types".
    await expect(hub.locator(".doctype-summary-label")).toHaveText("All types");
    await openTypeMenu(hub);
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

    await openTypeMenu(hub);
    await hub.locator('.doctype-menu input[value="shop"]').check();
    // Settle the check's async re-render before asserting / acting further.
    await expect(hub.locator('.doctype-menu input[value="shop"]')).toBeChecked();
    // Menu stays open for multi-select (present == open; see openTypeMenu note).
    await expect(hub.locator(".doctype-menu")).toHaveCount(1);
    await expect(hub.locator(".record-list")).toContainText("E2E HubTypes Shop");
    await expect(hub.locator(".record-list")).not.toContainText("E2E HubTypes PC");

    await hub.locator('.doctype-menu input[value="pc"]').check();
    await expect(hub.locator('.doctype-menu input[value="pc"]')).toBeChecked(); // settle
    // Two selected -> "first label +1" (pc precedes shop in RECORD_TYPES order).
    await closeTypeMenu(hub);
    await expect(hub.locator(".doctype-summary-label")).toContainText("+1");

    // Reopen and uncheck both -> back to "All types" and unfiltered.
    await openTypeMenu(hub);
    await hub.locator('.doctype-menu input[value="shop"]').uncheck();
    await hub.locator('.doctype-menu input[value="pc"]').uncheck();
    await expect(hub.locator('.doctype-menu input[value="pc"]')).not.toBeChecked(); // settle
    await closeTypeMenu(hub);
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
