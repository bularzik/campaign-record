import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

// Drops synthetic OS files (DataTransfer + File) onto the Campaign Hub and
// asserts the three routing paths: open media entry, shared auto-gallery on
// the newest timepoint, and a specific timepoint row (image link).
const P = "E2E MediaDrop";

// 1x1 transparent PNG
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Dispatch a synthetic file-drop on the first element matching selector. */
const dropFile = (page, selector, filename) =>
  page.evaluate(({ selector, filename, b64 }) => {
    const dt = new DataTransfer();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], filename, { type: "image/png" }));
    const el = document.querySelector(selector);
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { selector, filename, b64: PNG_B64 });

test.describe("hub media drag-and-drop upload", () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
  });

  test.afterAll(async () => {
    await page.evaluate(async () => {
      await game.settings.set("campaign-record", "autoCaptureTargetGroup", "");
    });
    await deleteGroupsByPrefix(page, P);
    await page.close();
  });

  test("hub-wide drop files into the newest-timepoint shared gallery", async () => {
    const ids = await page.evaluate(async (P) => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const { addTimepoint } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = await createGroup(`${P} Gallery`);
      await game.settings.set("campaign-record", "autoCaptureTargetGroup", group.id);
      const tp = await addTimepoint(group, `${P} TP1`);
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
      return { groupId: group.id, tpId: tp.id };
    }, P);
    await page.waitForSelector("#campaign-hub .window-content");

    await dropFile(page, "#campaign-hub .window-content", "drop-gallery.png");

    await expect.poll(() => page.evaluate(({ groupId, tpId }) => {
      const g = game.journal.get(groupId);
      const gallery = g.pages.find(
        (p) => p.type === "campaign-record.media"
          && p.getFlag("campaign-record", "autoMediaTimepoint") === tpId
      );
      return gallery?.system.images.length ?? 0;
    }, ids), { timeout: 15_000 }).toBe(1);

    // the stored src points at the uploaded copy, not a local path
    const src = await page.evaluate(({ groupId, tpId }) => {
      const g = game.journal.get(groupId);
      const gallery = g.pages.find(
        (p) => p.getFlag("campaign-record", "autoMediaTimepoint") === tpId
      );
      return gallery.system.images[0].src;
    }, ids);
    expect(src).toContain(`campaign-record-media/${ids.groupId}/`);
    expect(src).toContain("drop-gallery.png");

    // gallery is linked to the timepoint
    const linked = await page.evaluate(async ({ groupId, tpId }) => {
      const { getTimepoints } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const g = game.journal.get(groupId);
      return getTimepoints(g).find((t) => t.id === tpId).links.length;
    }, ids);
    expect(linked).toBe(1);
  });

  test("drop lands in the open media entry", async () => {
    const ids = await page.evaluate(async (P) => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const group = await createGroup(`${P} Entry`);
      const [media] = await group.createEmbeddedDocuments("JournalEntryPage", [
        { name: `${P} Slides`, type: "campaign-record.media", system: { images: [] } }
      ]);
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const hub = CampaignHub.open();
      await hub.navigateToRecord(media.uuid);
      return { groupId: group.id, mediaId: media.id };
    }, P);
    await page.waitForSelector("#campaign-hub .record-pane-mount .record-pane-sheet");

    await dropFile(page, "#campaign-hub .window-content", "drop-entry.png");

    await expect.poll(() => page.evaluate(({ groupId, mediaId }) => {
      const media = game.journal.get(groupId).pages.get(mediaId);
      return media.system.images.length;
    }, ids), { timeout: 15_000 }).toBe(1);

    const img = await page.evaluate(({ groupId, mediaId }) => {
      return game.journal.get(groupId).pages.get(mediaId).system.images[0];
    }, ids);
    expect(img.src).toContain("drop-entry.png");
    expect(img.caption).toBe("");
  });

  test("drop on a timepoint row attaches an image link to that timepoint", async () => {
    const ids = await page.evaluate(async (P) => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const { addTimepoint } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = await createGroup(`${P} Row`);
      const tpOld = await addTimepoint(group, `${P} Older`);
      await addTimepoint(group, `${P} Newest`);
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      const hub = CampaignHub.open();
      await hub.navigateToIndex();
      hub.state.groupId = group.id;
      await hub.render();
      return { groupId: group.id, tpOldId: tpOld.id };
    }, P);
    await page.waitForSelector(`#campaign-hub [data-drop-timepoint][data-timepoint-id="${ids.tpOldId}"]`);

    // Drop on the OLDER row: routing must honor the explicit row, not the newest timepoint.
    await dropFile(
      page,
      `#campaign-hub [data-drop-timepoint][data-timepoint-id="${ids.tpOldId}"]`,
      "drop-row.png"
    );

    // ShowPlayers confirm dialog → "No" (showPlayers: false)
    const noButton = page.locator('dialog button[data-action="no"], .application.dialog button[data-action="no"]');
    await noButton.first().click({ timeout: 15_000 });

    await expect.poll(() => page.evaluate(async ({ groupId, tpOldId }) => {
      const { getTimepoints } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const g = game.journal.get(groupId);
      const tp = getTimepoints(g).find((t) => t.id === tpOldId);
      return tp.links.length;
    }, ids), { timeout: 15_000 }).toBe(1);

    const link = await page.evaluate(async ({ groupId, tpOldId }) => {
      const { getTimepoints } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const g = game.journal.get(groupId);
      return getTimepoints(g).find((t) => t.id === tpOldId).links[0];
    }, ids);
    expect(link.src).toContain("drop-row.png");
    expect(link.showPlayers).toBe(false);
  });
});
