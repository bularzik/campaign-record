import { test, expect } from "@playwright/test";
import { login, createGroupWithPage, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

test.describe("group hub sheet", () => {
  test.afterEach(async ({ page }) => {
    await deleteGroupsByPrefix(page, "E2E Sheet");
  });

  test("opening a group from the sidebar renders the hub, scoped, no dropdown", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(page, "E2E Sheet Group", "E2E Sheet Npc", "campaign-record.npc");
    await page.evaluate(({ groupId }) => game.journal.get(groupId).sheet.render(true), ids);

    const sheet = page.locator(".group-hub");
    await sheet.waitFor();
    await expect(sheet.locator('.hub-index[data-tab="index"]')).toBeVisible();
    await expect(sheet.locator('select[name="group-select"]')).toHaveCount(0);
    await expect(sheet.locator(".record-row", { hasText: "E2E Sheet Npc" })).toBeVisible();

    // Sidebar entry itself opens the same sheet class.
    await page.evaluate(() => ui.sidebar.changeTab("journal", "primary"));
    const cls = await page.evaluate(
      ({ groupId }) => game.journal.get(groupId).sheet.constructor.name,
      ids
    );
    expect(cls).toBe("GroupHubSheet");
  });

  test("goToPage/content-link routing lands in-pane", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(page, "E2E Sheet Group", "E2E Sheet Npc", "campaign-record.npc");
    await page.evaluate(async ({ groupId, pageId }) => {
      const g = game.journal.get(groupId);
      await g.sheet.render(true);
      await g.sheet.goToPage(pageId);
    }, ids);
    const sheet = page.locator(".group-hub");
    await expect(sheet.locator(".record-pane-title")).toHaveText("E2E Sheet Npc");
    await expect(sheet.locator(".record-pane-mount dl.record-facts")).toBeVisible();
  });

  test("cross-group record links open the other group's hub", async ({ page }) => {
    await login(page, "Gamemaster");
    const a = await createGroupWithPage(page, "E2E Sheet Alpha", "E2E Sheet Source", "campaign-record.npc");
    const b = await createGroupWithPage(page, "E2E Sheet Beta", "E2E Sheet Remote", "campaign-record.place");
    await page.evaluate(async ({ a, b }) => {
      const source = game.journal.get(a.groupId).pages.get(a.pageId);
      const remote = game.journal.get(b.groupId).pages.get(b.pageId);
      await source.update({ "system.description": `<p>@UUID[${remote.uuid}]{far away}</p>` });
      await game.journal.get(a.groupId).sheet.render(true);
      await game.journal.get(a.groupId).sheet.goToPage(a.pageId);
    }, { a, b });

    const alpha = page.locator(".group-hub").first();
    await alpha.locator(".record-pane-mount a.content-link", { hasText: "far away" }).click();
    const beta = page.locator(".group-hub", { hasText: "E2E Sheet Remote" }).last();
    await expect(beta.locator(".record-pane-title")).toHaveText("E2E Sheet Remote");
  });
});
