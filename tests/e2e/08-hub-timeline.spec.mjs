import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("hub timeline", () => {
  let gmPage, playerCtx, playerPage, ids;

  const openTimeline = async (p) => {
    await p.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = p.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    await hub.locator('[data-action="tab"][data-tab="timeline"]').click();
    return hub;
  };

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    ids = await createGroupWithPage(gmPage, "E2E Timeline Group", "E2E Timeline NPC", "campaign-record.npc");
    playerCtx = await browser.newContext();
    playerPage = await playerCtx.newPage();
    await login(playerPage, "User 1");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(gmPage, "E2E Timeline");
    await playerCtx.close();
    await gmPage.close();
  });

  test("GM adds a timepoint through the dialog; player sees it live", async () => {
    const gmHub = await openTimeline(gmPage);
    const playerHub = await openTimeline(playerPage);

    await gmHub.locator('.timeline-group button[data-action="addTimepoint"]').last().click();
    const dialogInput = gmPage.locator('dialog input[name="label"], .application.dialog input[name="label"]');
    await dialogInput.waitFor({ timeout: 10_000 });
    await dialogInput.fill("Session 1: The Hook");
    await gmPage.locator('dialog button[data-action="ok"], .application.dialog button[data-action="ok"]').click();

    await expect(gmHub.locator(".timepoint-label", { hasText: "Session 1: The Hook" }))
      .toBeVisible({ timeout: 10_000 });
    await expect(playerHub.locator(".timepoint-label", { hasText: "Session 1: The Hook" }))
      .toBeVisible({ timeout: 10_000 });
  });

  test("player can add and rename timepoints (collaborative by default)", async () => {
    const playerHub = playerPage.locator("#campaign-hub");
    await playerHub.locator('.timeline-group button[data-action="addTimepoint"]').last().click();
    const input = playerPage.locator('dialog input[name="label"], .application.dialog input[name="label"]');
    await input.waitFor({ timeout: 10_000 });
    await input.fill("Session 2");
    await playerPage.locator('dialog button[data-action="ok"], .application.dialog button[data-action="ok"]').click();
    await expect(playerHub.locator(".timepoint-label", { hasText: "Session 2" }))
      .toBeVisible({ timeout: 10_000 });
    await expect(gmPage.locator("#campaign-hub .timepoint-label", { hasText: "Session 2" }))
      .toBeVisible({ timeout: 10_000 });
  });

  test("reordering via moveTimepoint updates both clients", async () => {
    const order = () =>
      gmPage.evaluate(async ({ groupId }) => {
        const { getTimepoints } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
        return getTimepoints(game.journal.get(groupId)).map((t) => t.label);
      }, ids);
    expect(await order()).toEqual(["Session 1: The Hook", "Session 2"]);

    await gmPage.evaluate(async ({ groupId }) => {
      const { getTimepoints, moveTimepoint } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = game.journal.get(groupId);
      const second = getTimepoints(group)[1];
      await moveTimepoint(group, second.id, 0);
    }, ids);
    expect(await order()).toEqual(["Session 2", "Session 1: The Hook"]);

    const labels = playerPage.locator("#campaign-hub .timepoint-label");
    await expect(labels.first()).toHaveText("Session 2", { timeout: 10_000 });
  });

  test("attaching a record shows its chip on both clients; detach removes it", async () => {
    await gmPage.evaluate(async ({ groupId, pageId }) => {
      const { getTimepoints, attachRecord } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = game.journal.get(groupId);
      await attachRecord(group.pages.get(pageId), getTimepoints(group)[0].id);
    }, ids);

    await expect(gmPage.locator("#campaign-hub .record-chip", { hasText: "E2E Timeline NPC" }))
      .toBeVisible({ timeout: 10_000 });
    await expect(playerPage.locator("#campaign-hub .record-chip", { hasText: "E2E Timeline NPC" }))
      .toBeVisible({ timeout: 10_000 });

    await gmPage.locator('#campaign-hub .record-chip [data-action="detachRecord"]').click();
    await expect(gmPage.locator("#campaign-hub .record-chip", { hasText: "E2E Timeline NPC" }))
      .toHaveCount(0, { timeout: 10_000 });
  });
});
