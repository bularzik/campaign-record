import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("hub index", () => {
  let gmPage, ids;

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    ids = await createGroupWithPage(gmPage, "E2E Index Group", "E2E Index NPC", "campaign-record.npc");
    await gmPage.evaluate(async ({ groupId }) => {
      const g = game.journal.get(groupId);
      await g.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Index Quest", type: "campaign-record.quest" }
      ]);
    }, ids);
    await gmPage.evaluate(async ({ groupId, pageId }) => {
      const page = game.journal.get(groupId).pages.get(pageId);
      await page.update({ "system.description": "<p>Carries a qwertyx amulet.</p>" });
    }, ids);
    await gmPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    await gmPage.locator("#campaign-hub").waitFor({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(gmPage, "E2E Index");
    await gmPage.close();
  });

  test("lists records and filters by type", async () => {
    const hub = gmPage.locator("#campaign-hub");
    await expect(hub.locator('.record-row', { hasText: "E2E Index NPC" })).toBeVisible();
    await expect(hub.locator('.record-row', { hasText: "E2E Index Quest" })).toBeVisible();

    await gmPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const h = CampaignHub.open();
      h.state.types = new Set(["quest"]);
      await h.render(true);
    });
    await expect(hub.locator('.record-row', { hasText: "E2E Index Quest" })).toBeVisible();
    await expect(hub.locator('.record-row', { hasText: "E2E Index NPC" })).toHaveCount(0);

    await gmPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const h = CampaignHub.open();
      h.state.types = new Set(); // reset
      await h.render(true);
    });
  });

  test("re-renders live when a record is created elsewhere", async () => {
    const hub = gmPage.locator("#campaign-hub");
    await gmPage.evaluate(async ({ groupId }) => {
      await game.journal.get(groupId).createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Index Live Place", type: "campaign-record.place" }
      ]);
    }, ids);
    await expect(hub.locator('.record-row', { hasText: "E2E Index Live Place" }))
      .toBeVisible({ timeout: 10_000 });
  });

  test("players never see hidden records; the GM always does", async ({ browser }) => {
    await gmPage.evaluate(async ({ groupId }) => {
      const { setRecordHidden } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const page = game.journal.get(groupId).pages.getName("E2E Index Quest");
      await setRecordHidden(page, true);
    }, ids);

    const hub = gmPage.locator("#campaign-hub");
    // GMs always see hidden records in the index; there is no hidden-only filter.
    await expect(hub.locator(".record-row", { hasText: "E2E Index Quest" })).toBeVisible();

    const ctx = await browser.newContext();
    const playerPage = await ctx.newPage();
    await login(playerPage, "User 1");
    await playerPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const playerHub = playerPage.locator("#campaign-hub");
    await playerHub.waitFor({ timeout: 15_000 });
    await expect(playerHub.locator(".record-row", { hasText: "E2E Index NPC" })).toBeVisible();
    await expect(playerHub.locator(".record-row", { hasText: "E2E Index Quest" })).toHaveCount(0);
    await ctx.close();
  });

  test("clear filters resets the type filter, keeps the query", async () => {
    const hub = gmPage.locator("#campaign-hub");
    await gmPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const h = CampaignHub.open();
      h.state.query = "e2e";
      h.state.types = new Set(["quest"]);
      await h.render(true);
    });
    await hub.locator('[data-action="clearFilters"]').first().click();
    const state = await gmPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const h = CampaignHub.open();
      return { types: h.state.types.size, query: h.state.query };
    });
    expect(state.types).toBe(0);
    expect(state.query).toBe("e2e");
  });

  test("index search box filters the record list by content", async () => {
    const count = (q) =>
      gmPage.evaluate(async (q) => {
        const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
        const hub = CampaignHub.open();
        hub.state.query = q;
        await hub.render(true);
        return hub.element.querySelectorAll(".record-list .record-row").length;
      }, q);
    const all = await count("");
    const filtered = await count("zzzznomatch");
    expect(all).toBeGreaterThan(0);
    expect(filtered).toBe(0);
  });

  test("snippets toggle reveals where a content match occurred", async () => {
    const hub = gmPage.locator("#campaign-hub");
    await gmPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const h = CampaignHub.open();
      await game.settings.set("campaign-record", "hubSnippets", false);
      h.state.query = "";
      await h.render(true);
    });
    // Pick any record and give it a distinctive body word, then search it.
    await gmPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const h = CampaignHub.open();
      h.state.query = "qwertyx"; // seeded in this file's beforeAll via system.description
      await h.render(true);
    });
    // Off: no snippet element rendered.
    await expect(hub.locator(".record-snippets")).toHaveCount(0);
    // Turn snippets ON via the settings menu (PR #15 moved the toggle there
    // from an inline .snippets-toggle checkbox into a data-action button).
    await hub.locator(".hub-settings-trigger").click();
    await hub.locator('[data-action="toggleSnippets"]').click();
    await hub.locator(".hub-settings-trigger").click();
    // On: snippet element appears for the matched row.
    await expect(hub.locator(".record-snippets .hit-snippet").first()).toBeVisible({ timeout: 10_000 });
  });

  test("shows a hint when a type filter hides matching records", async () => {
    const count = await gmPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const hub = CampaignHub.open();
      hub.state.query = "e2e";            // matches multiple seeded records across types
      hub.state.types = new Set(["quest"]); // filter to a type most matches are NOT
      await hub.render(true);
      return hub.element.querySelectorAll(".other-group-matches").length;
    });
    expect(count).toBe(1);
  });

  test("index rows show a doctype icon and drop the group/type columns", async () => {
    const row = gmPage.locator(".campaign-hub .record-row").first();
    await expect(row.locator(".record-type-icon")).toBeVisible();
    await expect(row.locator(".record-group")).toHaveCount(0);
    await expect(row.locator(".record-type")).toHaveCount(0);
  });
});
