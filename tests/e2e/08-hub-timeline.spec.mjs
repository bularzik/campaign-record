import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage, settle } from "./helpers/foundry.mjs";

test.describe("hub timeline", () => {
  let gmPage, playerCtx, playerPage, ids;

  // The test world may contain real campaign groups alongside this spec's
  // group; every locator must stay inside our group's section or clicks and
  // label reads can land in someone else's timeline.
  const groupSection = (p) =>
    p.locator(`#campaign-hub .timeline-group[data-group-id="${ids.groupId}"]`);

  // The timeline is always visible now (no tabs); this just opens the hub.
  const openTimeline = async (p) => {
    await p.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = p.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
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

    await groupSection(gmPage).locator('button[data-action="addTimepoint"]:not([data-position])').click();
    const dialogInput = gmPage.locator('dialog input[name="label"], .application.dialog input[name="label"]');
    await dialogInput.waitFor({ timeout: 10_000 });
    await dialogInput.fill("Session 1: The Hook");
    await gmPage.locator('dialog button[data-action="ok"], .application.dialog button[data-action="ok"]').click();

    await expect(groupSection(gmPage).locator(".timepoint-label", { hasText: "Session 1: The Hook" }))
      .toBeVisible({ timeout: 10_000 });
    await expect(groupSection(playerPage).locator(".timepoint-label", { hasText: "Session 1: The Hook" }))
      .toBeVisible({ timeout: 10_000 });
  });

  test("player can add and rename timepoints (collaborative by default)", async () => {
    await groupSection(playerPage).locator('button[data-action="addTimepoint"]:not([data-position])').click();
    const input = playerPage.locator('dialog input[name="label"], .application.dialog input[name="label"]');
    await input.waitFor({ timeout: 10_000 });
    await input.fill("Session 2");
    await playerPage.locator('dialog button[data-action="ok"], .application.dialog button[data-action="ok"]').click();
    await expect(groupSection(playerPage).locator(".timepoint-label", { hasText: "Session 2" }))
      .toBeVisible({ timeout: 10_000 });
    await expect(groupSection(gmPage).locator(".timepoint-label", { hasText: "Session 2" }))
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

    const labels = groupSection(playerPage).locator(".timepoint-label");
    await expect(labels.first()).toHaveText("Session 2", { timeout: 10_000 });
  });

  test("attaching a record shows its link chip on both clients; removeLink removes it", async () => {
    await gmPage.evaluate(async ({ groupId, pageId }) => {
      const { getTimepoints, addLink } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = game.journal.get(groupId);
      const page = group.pages.get(pageId);
      await addLink(group, getTimepoints(group)[0].id, { uuid: page.uuid, name: page.name, type: "JournalEntryPage" });
    }, ids);

    await expect(gmPage.locator("#campaign-hub .record-chip.link-chip", { hasText: "E2E Timeline NPC" }))
      .toBeVisible({ timeout: 10_000 });
    await expect(playerPage.locator("#campaign-hub .record-chip.link-chip", { hasText: "E2E Timeline NPC" }))
      .toBeVisible({ timeout: 10_000 });

    // The shared test world can contain real campaign groups with their own
    // attached link chips (see the file-level comment); scope the click to
    // our group's section so it doesn't hit a stray chip elsewhere in the hub.
    await groupSection(gmPage).locator('.link-chip [data-action="removeLink"]').click();
    await expect(gmPage.locator("#campaign-hub .record-chip.link-chip", { hasText: "E2E Timeline NPC" }))
      .toHaveCount(0, { timeout: 10_000 });
  });

  test("record drag payload resolves to an @UUID content link (Bug 1: Foundry document drop shape)", async () => {
    // The hub drags records with recordDragPayload(uuid), which must carry
    // Foundry's standard {type, uuid} document shape so a drop onto ANY
    // ProseMirror editor (not just our own timepoint drop targets) inserts a
    // real content link via core's ProseMirrorContentLinkPlugin. That plugin
    // calls exactly TextEditor.implementation.getContentLink(data) on drop, so
    // exercising that same call is a faithful, non-flaky proxy for "dragging
    // a record into a journal editor inserts @UUID[...]{Name}" without having
    // to simulate a pixel-accurate native drag onto core's Journal sheet DOM.
    const link = await gmPage.evaluate(async ({ pageUuid }) => {
      const { recordDragPayload } = await import("/modules/campaign-record/scripts/logic/timeline-links.mjs");
      const data = recordDragPayload(pageUuid);
      return foundry.applications.ux.TextEditor.implementation.getContentLink(data);
    }, { pageUuid: ids.pageUuid });

    expect(link).toContain("@UUID[");
    expect(link).toContain(ids.pageUuid);
    expect(link).toContain("E2E Timeline NPC");
  });

  test("drop handlers: record link-attach, cross-group guards, malformed payload no-op", async () => {
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

    // The old attach model stored membership on the record page
    // (page.system.timepoints); links now live on the timepoint itself.
    const linkFor = (groupId, timepointId, uuid) =>
      gmPage.evaluate(
        async ({ groupId, timepointId, uuid }) => {
          const { getTimepoints } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
          const tp = getTimepoints(game.journal.get(groupId)).find((t) => t.id === timepointId);
          return tp?.links?.find((l) => l.uuid === uuid) ?? null;
        },
        { groupId, timepointId, uuid }
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

    // 1. Same-group record drop attaches as a link (Foundry's document shape:
    // {type, uuid} is required for classifyDropData to recognize the drop).
    await dispatchDrop(dropSelector, { kind: "campaign-record.record", type: "JournalEntryPage", uuid: ids.pageUuid });
    await expect.poll(() => linkFor(ids.groupId, timepointId, ids.pageUuid), { timeout: 10_000 })
      .not.toBeNull();
    await expect(gmPage.locator("#campaign-hub .record-chip.link-chip", { hasText: "E2E Timeline NPC" }))
      .toBeVisible({ timeout: 10_000 });

    const attachedLink = await linkFor(ids.groupId, timepointId, ids.pageUuid);
    await gmPage.evaluate(
      async ({ groupId, timepointId, linkId }) => {
        const { removeLink } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
        await removeLink(game.journal.get(groupId), timepointId, linkId);
      },
      { groupId: ids.groupId, timepointId, linkId: attachedLink.id }
    );
    await expect.poll(() => linkFor(ids.groupId, timepointId, ids.pageUuid)).toBeNull();

    // 2. Cross-group record drop attaches as a link instead of warning.
    const otherIds = await createGroupWithPage(
      gmPage, "E2E Timeline Other", "E2E Timeline Other NPC", "campaign-record.npc"
    );
    await dispatchDrop(dropSelector, { kind: "campaign-record.record", type: "JournalEntryPage", uuid: otherIds.pageUuid });
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
    await expect.poll(() => linkFor(ids.groupId, timepointId, ids.pageUuid)).toBeNull();
    expect(await timepointOrder(ids.groupId)).toEqual(orderBefore);

    // 5. A plain (non-campaign-record) journal text page, dropped via Foundry's
    // native document drag shape (no "kind" wrapper — as if dragged straight
    // from the core Journal sidebar), also attaches as a link chip.
    const plainDrop = await gmPage.evaluate(async () => {
      const [journal] = await JournalEntry.createDocuments([{ name: "E2E Timeline Drop Journal" }]);
      const [plainPage] = await journal.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Timeline Drop Page", type: "text", text: { content: "<p>hi</p>" } }
      ]);
      return { journalId: journal.id, pageUuid: plainPage.uuid };
    });
    await dispatchDrop(dropSelector, { type: "JournalEntryPage", uuid: plainDrop.pageUuid });
    await expect(gmPage.locator("#campaign-hub .record-chip.link-chip", { hasText: "E2E Timeline Drop Page" }))
      .toBeVisible({ timeout: 10_000 });
    await gmPage.evaluate((id) => game.journal.get(id)?.delete(), plainDrop.journalId);
  });

  test("player never sees a hidden attached record's link chip; GM still does", async () => {
    const { timepointId, linkId } = await gmPage.evaluate(async ({ groupId, pageId }) => {
      const { getTimepoints, addLink } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const { setRecordHidden } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const group = game.journal.get(groupId);
      const page = group.pages.get(pageId);
      const tp = getTimepoints(group)[0];
      const link = await addLink(group, tp.id, { uuid: page.uuid, name: page.name, type: "JournalEntryPage" });
      await setRecordHidden(page, true);
      return { timepointId: tp.id, linkId: link.id };
    }, { groupId: ids.groupId, pageId: ids.pageId });

    await expect(gmPage.locator("#campaign-hub .record-chip.link-chip", { hasText: "E2E Timeline NPC" }))
      .toBeVisible({ timeout: 10_000 });
    await expect(playerPage.locator("#campaign-hub .record-chip.link-chip", { hasText: "E2E Timeline NPC" }))
      .toHaveCount(0, { timeout: 10_000 });

    await gmPage.evaluate(async ({ groupId, pageId, timepointId, linkId }) => {
      const { removeLink } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const { setRecordHidden } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const group = game.journal.get(groupId);
      const page = group.pages.get(pageId);
      await setRecordHidden(page, false);
      await removeLink(group, timepointId, linkId);
    }, { groupId: ids.groupId, pageId: ids.pageId, timepointId, linkId });

    await expect(gmPage.locator("#campaign-hub .record-chip.link-chip", { hasText: "E2E Timeline NPC" }))
      .toHaveCount(0, { timeout: 10_000 });
  });

  test("a link chip to an ordinary journal's page opens in this hub's pane", async () => {
    const pageName = "E2E Timeline Plain Page";
    const journalId = await gmPage.evaluate(async ({ groupId }) => {
      const [journal] = await JournalEntry.createDocuments([{ name: "E2E Timeline Plain Journal" }]);
      const [plain] = await journal.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Timeline Plain Page", type: "text", text: { content: "<p>plain</p>" } }
      ]);
      const { getTimepoints, addTimepoint, addLink } =
        await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = game.journal.get(groupId);
      await addTimepoint(group, "Plain Link Timepoint", null);
      const tp = getTimepoints(group).find((t) => t.label === "Plain Link Timepoint");
      await addLink(group, tp.id, { uuid: plain.uuid, name: plain.name, type: "JournalEntryPage" });
      return journal.id;
    }, ids);

    try {
      const hub = await openTimeline(gmPage);
      await groupSection(gmPage).locator(".link-chip", { hasText: pageName }).click();
      await expect(hub.locator(".record-pane-title")).toHaveText(pageName);
      // The core journal sheet did NOT open.
      const coreSheetOpen = await gmPage.evaluate(
        (id) => game.journal.get(id).sheet.rendered,
        journalId
      );
      expect(coreSheetOpen).toBe(false);
    } finally {
      await gmPage.evaluate((id) => game.journal.get(id)?.delete(), journalId);
    }
  });

  test("stores a campaign date and shows it in the date column", async () => {
    const tpId = await gmPage.evaluate(async (groupId) => {
      const { addTimepoint, editTimepoint, getTimepoints } =
        await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = game.journal.get(groupId);
      const tp = await addTimepoint(group, "Dated point");
      await editTimepoint(group, tp.id, {
        campaignDate: { year: 1492, month: 6, day: 15, hour: 14, minute: 30 }
      });
      const stored = getTimepoints(group).find((t) => t.id === tp.id);
      if (stored.campaignDate.day !== 15) throw new Error("campaign date not stored");
      await game.settings.set("campaign-record", "timelineOrder", "campaign");
      return tp.id;
    }, ids.groupId);

    try {
      await openTimeline(gmPage);
      const dateEl = groupSection(gmPage).locator(`.timepoint[data-timepoint-id="${tpId}"] .timepoint-date`);
      await expect(dateEl).toBeVisible({ timeout: 10_000 });
      const dateText = await dateEl.innerText();
      expect(dateText).toContain("1492");
      expect(dateText).toContain("15");
    } finally {
      await gmPage.evaluate(() => game.settings.set("campaign-record", "timelineOrder", "manual"));
    }
  });

  test("order toggle shows the date column outside manual mode and hides it in manual", async () => {
    await gmPage.evaluate(() => game.settings.set("campaign-record", "timelineOrder", "manual"));
    await openTimeline(gmPage);
    await expect(groupSection(gmPage).locator(".timepoints.with-dates")).toHaveCount(0, { timeout: 10_000 });
    expect(await groupSection(gmPage).locator(".timepoint-date").count()).toBe(0);

    await gmPage.evaluate(() => game.settings.set("campaign-record", "timelineOrder", "created"));
    await openTimeline(gmPage);
    await expect(groupSection(gmPage).locator(".timepoints.with-dates")).not.toHaveCount(0, { timeout: 10_000 });
    expect(await groupSection(gmPage).locator(".timepoint-date").count()).toBeGreaterThan(0);

    await gmPage.evaluate(() => game.settings.set("campaign-record", "timelineOrder", "manual"));
  });
});
