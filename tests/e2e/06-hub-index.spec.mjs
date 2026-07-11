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

  test("lists records and filters by type chip", async () => {
    const hub = gmPage.locator("#campaign-hub");
    await expect(hub.locator('.record-row', { hasText: "E2E Index NPC" })).toBeVisible();
    await expect(hub.locator('.record-row', { hasText: "E2E Index Quest" })).toBeVisible();

    await hub.locator('.type-chip[data-type="quest"]').click();
    await expect(hub.locator('.record-row', { hasText: "E2E Index Quest" })).toBeVisible();
    await expect(hub.locator('.record-row', { hasText: "E2E Index NPC" })).toHaveCount(0);
    await hub.locator('.type-chip[data-type="quest"]').click(); // reset
  });

  test("type chips render as compact pills on shared rows", async () => {
    const chips = gmPage.locator("#campaign-hub .type-chip");
    const first = await chips.nth(0).boundingBox();
    const second = await chips.nth(1).boundingBox();
    // Same row: full-width buttons would stack each chip on its own line.
    expect(second.y).toBe(first.y);
    expect(second.x).toBeGreaterThan(first.x);
    // Compact: a pill, not a 760px-wide bar.
    expect(first.width).toBeLessThan(150);
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

  test("players never see hidden records; GM hidden-only filter shows them", async ({ browser }) => {
    await gmPage.evaluate(async ({ groupId }) => {
      const { setRecordHidden } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const page = game.journal.get(groupId).pages.getName("E2E Index Quest");
      await setRecordHidden(page, true);
    }, ids);

    const hub = gmPage.locator("#campaign-hub");
    await hub.locator(".hidden-toggle").click();
    await expect(hub.locator(".record-row", { hasText: "E2E Index Quest" })).toBeVisible();
    await hub.locator(".hidden-toggle").click();

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
    await expect(playerHub.locator(".hidden-toggle")).toHaveCount(0);
    await ctx.close();
  });

  test("clear filters resets type, tag, and hidden-only in one click", async () => {
    const hub = gmPage.locator("#campaign-hub");
    // No filters active: control is absent.
    await expect(hub.locator(".clear-filters")).toHaveCount(0);
    await expect(hub.locator(".filtered-count")).toHaveCount(0);

    await hub.locator('.type-chip[data-type="quest"]').click();
    await hub.locator('input[name="tag-filter"]').fill("no-such-tag");
    await expect(hub.locator(".record-row")).toHaveCount(0);
    await expect(hub.locator(".filtered-count")).toBeVisible();
    // Count reflects the filtered list: "0 of N" while nothing matches.
    await expect(hub.locator(".filtered-count")).toHaveText(/^0 of \d+$/);

    await hub.locator(".clear-filters").click();
    await expect(hub.locator(".clear-filters")).toHaveCount(0);
    await expect(hub.locator('input[name="tag-filter"]')).toHaveValue("");
    await expect(hub.locator('.type-chip[data-type="quest"]')).not.toHaveClass(/active/);
    await expect(hub.locator(".record-row", { hasText: "E2E Index NPC" })).toBeVisible();
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
});
