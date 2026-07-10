import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("media sheet", () => {
  let page, ids;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
    ids = await createGroupWithPage(page, "E2E Media Group", "E2E Media", "campaign-record.media");
    await page.evaluate(
      async ({ groupId, pageId }) => {
        const p = game.journal.get(groupId).pages.get(pageId);
        await p.update({
          "system.images": [
            { id: foundry.utils.randomID(), src: "icons/svg/book.svg", caption: "First" },
            { id: foundry.utils.randomID(), src: "icons/svg/chest.svg", caption: "Second" }
          ]
        });
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(page, "E2E Media");
    await page.close();
  });

  const images = () =>
    page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.toObject().images,
      { groupId: ids.groupId, pageId: ids.pageId }
    );

  test("caption edit, reorder, and delete persist in order", async () => {
    await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = page.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[data-action="addImage"]').waitFor({ timeout: 15_000 });

    const caption = sheet.locator('[data-rows="images"] [data-row-field="caption"]').first();
    await caption.fill("Cover");
    await caption.dispatchEvent("change");
    await expect.poll(async () => (await images())[0].caption).toBe("Cover");

    // move the second image up
    await sheet.locator('[data-action="moveImage"][data-dir="-1"]').last().click();
    await expect.poll(async () => (await images()).map((i) => i.caption)).toEqual(["Second", "Cover"]);

    // moveImage at the list boundary is a no-op
    await sheet.locator('[data-action="moveImage"][data-dir="-1"]').first().click();
    await expect.poll(async () => (await images()).map((i) => i.caption)).toEqual(["Second", "Cover"]);

    await sheet.locator('[data-action="deleteImage"]').first().click();
    await expect.poll(async () => (await images()).length).toBe(1);
    expect((await images())[0].caption).toBe("Cover");

    const interval = sheet.locator('[name="system.slideshowInterval"]');
    await interval.fill("10");
    await interval.dispatchEvent("change");
    await expect
      .poll(async () =>
        page.evaluate(
          ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.slideshowInterval,
          { groupId: ids.groupId, pageId: ids.pageId }
        )
      )
      .toBe(10);
  });

  test("view mode renders the gallery with captions", async () => {
    // Inline editing (client-scoped, default on) renders the editable
    // images fieldset in view mode for update-capable users; that branch
    // is covered by 18-inline-edit. This test asserts the read-only
    // gallery markup, so switch the toggle off for this client, then
    // restore it since `page` is reused across this describe block.
    await page.evaluate(() => game.settings.set("campaign-record", "inlineEditing", false));
    await page.evaluate(
      async ({ groupId, pageId }) => {
        const g = game.journal.get(groupId);
        await g.pages.get(pageId).sheet.close();
        await g.sheet.render(true);
        await g.sheet.goToPage(pageId);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const gallery = page.locator(".journal-entry-page .media-gallery");
    await gallery.waitFor({ timeout: 15_000 });
    await expect(gallery.locator("figure")).toHaveCount(1);
    await expect(gallery).toContainText("Cover");
    await page.evaluate(({ groupId }) => game.journal.get(groupId).sheet.close(), ids);
    await page.evaluate(() => game.settings.set("campaign-record", "inlineEditing", true));
  });
});
