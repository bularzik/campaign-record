import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage, settle } from "./helpers/foundry.mjs";

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

    // Scope to this spec's group: journal collection order is per-client
    // (initial payload vs. live-created appends), so a bare `.last()` can
    // land on a permanent group like "Black Keep Campaign".
    await gmHub.locator(`.timeline-group[data-group-id="${ids.groupId}"] button[data-action="addTimepoint"]`).last().click();
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
    await playerHub.locator(`.timeline-group[data-group-id="${ids.groupId}"] button[data-action="addTimepoint"]`).last().click();
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

    const labels = playerPage.locator(
      `#campaign-hub .timeline-group[data-group-id="${ids.groupId}"] .timepoint-label`
    );
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

  test("drop handlers: record attach, cross-group guards, malformed payload no-op", async () => {
    await openTimeline(gmPage);
    const dropSelector = `#campaign-hub .timeline-group[data-group-id="${ids.groupId}"] [data-drop-timepoint]`;

    const dispatchDrop = (selector, payload) =>
      gmPage.evaluate(
        ({ selector, payload }) => {
          const dt = new DataTransfer();
          dt.setData("text/plain", typeof payload === "string" ? payload : JSON.stringify(payload));
          const el = document.querySelector(selector);
          if (!el) throw new Error(`drop target not found: ${selector}`);
          el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
        },
        { selector, payload }
      );

    const isAttached = (groupId, pageId, timepointId) =>
      gmPage.evaluate(
        ({ groupId, pageId, timepointId }) => {
          const page = game.journal.get(groupId).pages.get(pageId);
          return !!page.system?.timepoints?.has?.(timepointId);
        },
        { groupId, pageId, timepointId }
      );

    const timepointOrder = (groupId) =>
      gmPage.evaluate(async (groupId) => {
        const { getTimepoints } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
        return getTimepoints(game.journal.get(groupId)).map((t) => t.id);
      }, groupId);

    const timepointId = await gmPage.evaluate(
      (selector) => document.querySelector(selector).dataset.timepointId,
      dropSelector
    );

    // 1. Same-group record attach via drop.
    await dispatchDrop(dropSelector, { kind: "campaign-record.record", uuid: ids.pageUuid });
    await expect.poll(() => isAttached(ids.groupId, ids.pageId, timepointId), { timeout: 10_000 })
      .toBe(true);

    await gmPage.evaluate(
      async ({ groupId, pageId, timepointId }) => {
        const { detachRecord } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
        const group = game.journal.get(groupId);
        await detachRecord(group.pages.get(pageId), timepointId);
      },
      { groupId: ids.groupId, pageId: ids.pageId, timepointId }
    );
    await expect.poll(() => isAttached(ids.groupId, ids.pageId, timepointId)).toBe(false);

    // 2. Cross-group record drop attaches as a link instead of warning.
    const otherIds = await createGroupWithPage(
      gmPage, "E2E Timeline Other", "E2E Timeline Other NPC", "campaign-record.npc"
    );
    await dispatchDrop(dropSelector, { kind: "campaign-record.record", uuid: otherIds.pageUuid });
    await expect(gmPage.locator("#campaign-hub .link-chip", { hasText: "E2E Timeline Other NPC" }))
      .toBeVisible({ timeout: 10_000 });

    // 3. Cross-group timepoint reorder is a no-op (guarded by data.groupId mismatch).
    const orderBefore = await timepointOrder(ids.groupId);
    await dispatchDrop(dropSelector, {
      kind: "campaign-record.timepoint", id: timepointId, groupId: "not-the-real-group"
    });
    await settle(gmPage);
    expect(await timepointOrder(ids.groupId)).toEqual(orderBefore);

    await deleteGroupsByPrefix(gmPage, "E2E Timeline Other");

    // 4. Malformed payload is a no-op (JSON.parse throws, caught and swallowed).
    await expect(dispatchDrop(dropSelector, "not json")).resolves.toBeUndefined();
    await expect.poll(() => isAttached(ids.groupId, ids.pageId, timepointId)).toBe(false);
    expect(await timepointOrder(ids.groupId)).toEqual(orderBefore);
  });

  test("player never sees a hidden attached record's chip; GM still does", async () => {
    const timepointId = await gmPage.evaluate(async ({ groupId, pageId }) => {
      const { getTimepoints, attachRecord } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const { setRecordHidden } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const group = game.journal.get(groupId);
      const page = group.pages.get(pageId);
      const tp = getTimepoints(group)[0];
      await attachRecord(page, tp.id);
      await setRecordHidden(page, true);
      return tp.id;
    }, { groupId: ids.groupId, pageId: ids.pageId });

    await expect(gmPage.locator("#campaign-hub .record-chip", { hasText: "E2E Timeline NPC" }))
      .toBeVisible({ timeout: 10_000 });
    await expect(playerPage.locator("#campaign-hub .record-chip", { hasText: "E2E Timeline NPC" }))
      .toHaveCount(0, { timeout: 10_000 });

    await gmPage.evaluate(async ({ groupId, pageId, timepointId }) => {
      const { detachRecord } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const { setRecordHidden } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const group = game.journal.get(groupId);
      const page = group.pages.get(pageId);
      await setRecordHidden(page, false);
      await detachRecord(page, timepointId);
    }, { groupId: ids.groupId, pageId: ids.pageId, timepointId });

    await expect(gmPage.locator("#campaign-hub .record-chip", { hasText: "E2E Timeline NPC" }))
      .toHaveCount(0, { timeout: 10_000 });
  });

  test("dragenter on the timeline tab nav link switches to it mid-drag", async () => {
    const gmHub = gmPage.locator("#campaign-hub");
    await gmHub.locator('[data-action="tab"][data-tab="index"]').click();
    await expect(gmHub.locator('.hub-index[data-tab="index"]')).toHaveClass(/active/);

    await gmPage.evaluate(() => {
      const link = document.querySelector(
        '#campaign-hub .hub-header nav.tabs a[data-action="tab"][data-tab="timeline"]'
      );
      link.dispatchEvent(new DragEvent("dragenter", { bubbles: true }));
    });

    await expect(gmHub.locator('.hub-timeline[data-tab="timeline"]')).toHaveClass(/active/);
    await expect(gmHub.locator('.hub-index[data-tab="index"]')).not.toHaveClass(/active/);
  });
});
