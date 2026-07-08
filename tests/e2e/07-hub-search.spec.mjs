import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("hub search", () => {
  let gmPage, ids;

  const openHubAndSearch = async (p, query) => {
    await p.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = p.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    await hub.locator('[data-action="tab"][data-tab="search"]').click();
    const input = hub.locator('input[name="search-query"]');
    await input.fill(query);
    await input.dispatchEvent("input");
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
    const hit = hub.locator(".search-hit", { hasText: "E2E Search NPC" });
    await expect(hit).toBeVisible({ timeout: 10_000 });
    await expect(hit.locator(".hit-snippet").first()).toContainText(/lighthouse/i);
  });

  test("GM-only content is searchable by the GM but never by players", async ({ browser }) => {
    const hub = await openHubAndSearch(gmPage, "xanathian");
    await expect(hub.locator(".search-hit", { hasText: "E2E Search NPC" }))
      .toBeVisible({ timeout: 10_000 });

    const ctx = await browser.newContext();
    const playerPage = await ctx.newPage();
    await login(playerPage, "User 1");
    const playerHub = await openHubAndSearch(playerPage, "xanathian");
    await expect(playerHub.locator(".search-results .hint")).toBeVisible({ timeout: 10_000 });
    await expect(playerHub.locator(".search-hit")).toHaveCount(0);

    // but public fields are searchable for players
    const input = playerHub.locator('input[name="search-query"]');
    await input.fill("lighthouse");
    await input.dispatchEvent("input");
    await expect(playerHub.locator(".search-hit", { hasText: "E2E Search NPC" }))
      .toBeVisible({ timeout: 10_000 });
    await ctx.close();
  });

  test("search index patches incrementally when a record changes", async () => {
    const hub = await openHubAndSearch(gmPage, "chimera");
    await expect(hub.locator(".search-hit")).toHaveCount(0);
    await gmPage.evaluate(async ({ groupId, pageId }) => {
      await game.journal.get(groupId).pages.get(pageId).update({ "system.faction": "Chimera Cult" });
    }, ids);
    const input = hub.locator('input[name="search-query"]');
    await input.fill("chimera");
    await input.dispatchEvent("input");
    await expect(hub.locator(".search-hit", { hasText: "E2E Search NPC" }))
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
        return hub.element.querySelectorAll(".search-hit").length;
      }, q);
    try {
      expect(await search("abcdef0123456789")).toBe(0);
      expect(await search("zanzibar")).toBe(0);
    } finally {
      await gmPage.evaluate(() => game.journal.getName("E2E Search Plain Journal")?.delete());
    }
  });
});
