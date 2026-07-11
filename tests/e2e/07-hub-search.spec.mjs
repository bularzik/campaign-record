import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("hub search", () => {
  let gmPage, ids;

  const openHubAndSearch = async (p, query) => {
    await p.evaluate(async (query) => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      await game.settings.set("campaign-record", "hubSnippets", true);
      const hub = CampaignHub.open();
      hub.state.query = query;
      await hub.render(true);
    }, query);
    const hub = p.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    return hub;
  };

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    ids = await createGroupWithPage(gmPage, "E2E Search Group", "E2E Search NPC", "campaign-record.npc");
    await gmPage.evaluate(async ({ groupId, pageId }) => {
      const page = game.journal.get(groupId).pages.get(pageId);
      await page.update({
        "system.role": "Lighthouse keeper",
        "system.gmNotes": "<p>Actually a XANATHIAN spy.</p>"
      });
    }, ids);
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(gmPage, "E2E Search");
    await gmPage.close();
  });

  test("GM finds records by structured field with prefix matching and snippet", async () => {
    const hub = await openHubAndSearch(gmPage, "lighthou");
    const hit = hub.locator(".record-row", { hasText: "E2E Search NPC" });
    await expect(hit).toBeVisible({ timeout: 10_000 });
    await expect(hit.locator(".hit-snippet").first()).toContainText(/lighthouse/i);
  });

  test("GM-only content is searchable by the GM but never by players", async ({ browser }) => {
    const hub = await openHubAndSearch(gmPage, "xanathian");
    await expect(hub.locator(".record-row", { hasText: "E2E Search NPC" }))
      .toBeVisible({ timeout: 10_000 });

    const ctx = await browser.newContext();
    const playerPage = await ctx.newPage();
    await login(playerPage, "User 1");
    let playerHub = await openHubAndSearch(playerPage, "xanathian");
    await expect(playerHub.locator(".record-row", { hasText: "E2E Search NPC" })).toHaveCount(0);

    // but public fields are searchable for players
    playerHub = await openHubAndSearch(playerPage, "lighthouse");
    await expect(playerHub.locator(".record-row", { hasText: "E2E Search NPC" }))
      .toBeVisible({ timeout: 10_000 });
    await ctx.close();
  });

  test("search index patches incrementally when a record changes", async () => {
    let hub = await openHubAndSearch(gmPage, "chimera");
    await expect(hub.locator(".record-row")).toHaveCount(0);
    await gmPage.evaluate(async ({ groupId, pageId }) => {
      await game.journal.get(groupId).pages.get(pageId).update({ "system.faction": "Chimera Cult" });
    }, ids);
    hub = await openHubAndSearch(gmPage, "chimera");
    await expect(hub.locator(".record-row", { hasText: "E2E Search NPC" }))
      .toBeVisible({ timeout: 10_000 });
  });

  test("UUID link values are not searchable; non-group pages stay out of the index", async () => {
    // Link an actor-shaped UUID onto the NPC, then search for its id fragment.
    await gmPage.evaluate(async ({ groupId, pageId }) => {
      const page = game.journal.get(groupId).pages.get(pageId);
      await page.update({ "system.actor": "Actor.abcdef0123456789" });
    }, ids);
    // A text page in a NON-group journal must never appear in results.
    await gmPage.evaluate(async () => {
      const entry = await JournalEntry.create({ name: "E2E Search Plain Journal" });
      await entry.createEmbeddedDocuments("JournalEntryPage", [
        { name: "Plain Page", type: "text", text: { content: "zanzibar contraband" } }
      ]);
    });
    // Drive state.query and render synchronously in-page: the debounced input
    // handler races with the app's own doc-changed re-renders (triggered by the
    // updates above), so filling the visible input and polling the DOM is flaky.
    const search = async (q) =>
      gmPage.evaluate(async (q) => {
        const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
        const hub = CampaignHub.open();
        hub.state.query = q;
        await hub.render(true);
        return hub.element.querySelectorAll(".record-row").length;
      }, q);
    try {
      expect(await search("abcdef0123456789")).toBe(0);
      expect(await search("zanzibar")).toBe(0);
    } finally {
      await gmPage.evaluate(() => game.journal.getName("E2E Search Plain Journal")?.delete());
    }
  });
});
