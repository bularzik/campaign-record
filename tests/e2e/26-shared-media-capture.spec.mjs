import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

// Drives Foundry's native image share (ImagePopout.prototype.shareImage, as
// invoked by the real "Show Players" button: `this.shareImage()` with no
// args, reading src/caption/title off the instance's `this.options`) as GM
// and asserts the shared media lands in a "Shared media" gallery linked to
// the newest timepoint of the auto-capture target group.
const P = "E2E ShareMedia";

test.describe("shared-media capture", () => {
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

  test("shares roll into one gallery per newest timepoint; a new timepoint starts a fresh gallery", async () => {
    // --- setup: target group with one timepoint ---
    const ids = await page.evaluate(async (P) => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const { addTimepoint } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = await createGroup(`${P} Target`);
      await game.settings.set("campaign-record", "autoCaptureTargetGroup", group.id);
      const tp1 = await addTimepoint(group, `${P} TP1`);
      return { groupId: group.id, tp1: tp1.id };
    }, P);

    // --- share images -> one gallery, deduped by src ---
    // Construct real ImagePopout instances and call the wrapped prototype
    // method exactly as the "Show Players" button does (no args; src/caption/
    // title come from the instance's own `this.options`). captureSharedMedia
    // is fire-and-forget from shareImage()'s point of view (its promise isn't
    // chained to shareImage()'s return), so — just like a real GM clicking
    // "Show Players" once per image, a few seconds apart — each share here
    // is awaited to completion (via poll) before the next is fired; firing
    // them back-to-back races findAutoGallery against the previous share's
    // still-pending gallery creation.
    const galleryImageCount = ({ groupId, tp1 }) => page.evaluate(({ groupId, tp1 }) => {
      const g = game.journal.get(groupId);
      const gallery = g.pages.find(
        (p) => p.type === "campaign-record.media" && p.getFlag("campaign-record", "autoMediaTimepoint") === tp1
      );
      return gallery ? gallery.system.images.length : 0;
    }, { groupId, tp1 });

    const share = (src, caption) => page.evaluate(({ src, caption }) => {
      const ImagePopout = foundry.applications.apps.ImagePopout;
      new ImagePopout({ src, caption, window: { title: caption } }).shareImage();
    }, { src, caption });

    await share("icons/svg/mystery-man.svg", "Handout A");
    await expect.poll(() => galleryImageCount(ids), { timeout: 15_000 }).toBe(1);

    await share("icons/svg/cowled.svg", "Handout B");
    await expect.poll(() => galleryImageCount(ids), { timeout: 15_000 }).toBe(2);

    // re-share A: should dedup, not add a third image
    await share("icons/svg/mystery-man.svg", "Handout A again");
    await page.waitForTimeout(1000);
    expect(await galleryImageCount(ids)).toBe(2);

    // the gallery is linked to tp1
    const linkedToTp1 = await page.evaluate(async ({ groupId, tp1 }) => {
      const { timepointsForRecord } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const g = game.journal.get(groupId);
      const gallery = g.pages.find(
        (p) => p.type === "campaign-record.media" && p.getFlag("campaign-record", "autoMediaTimepoint") === tp1
      );
      return timepointsForRecord(g, gallery.uuid).includes(tp1);
    }, ids);
    expect(linkedToTp1).toBe(true);

    // --- add a newer timepoint, share again -> a second, distinct gallery ---
    const tp2 = await page.evaluate(async ({ groupId }) => {
      const { addTimepoint } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const g = game.journal.get(groupId);
      const tp = await addTimepoint(g, "E2E ShareMedia TP2");
      const ImagePopout = foundry.applications.apps.ImagePopout;
      new ImagePopout({
        src: "icons/svg/sun.svg",
        caption: "Handout C",
        window: { title: "Handout C" }
      }).shareImage();
      return tp.id;
    }, ids);

    await expect.poll(
      () => page.evaluate(({ groupId, tp2 }) => {
        const g = game.journal.get(groupId);
        const galleries = g.pages.filter((p) => p.type === "campaign-record.media");
        const newer = galleries.find((p) => p.getFlag("campaign-record", "autoMediaTimepoint") === tp2);
        return galleries.length === 2 && !!newer && newer.system.images.length === 1;
      }, { groupId: ids.groupId, tp2 }),
      { timeout: 15_000 }
    ).toBe(true);
  });
});
