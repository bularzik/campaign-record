import { test, expect } from "@playwright/test";
import { login, createGroupWithPage, deleteGroupsByPrefix, expectPaneTitle } from "./helpers/foundry.mjs";

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
    await expect(sheet.locator(".hub-index")).toBeVisible();
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
    await expectPaneTitle(sheet, "E2E Sheet Npc");
    await expect(sheet.locator(".record-pane-mount dl.record-facts")).toBeVisible();
  });

  test("cross-group record links open in this hub's own pane", async ({ page }) => {
    await login(page, "Gamemaster");
    // Content links only render as clickable anchors in the read-only
    // (enriched) view — inline editing shows a live editor instead.
    await page.evaluate(() => game.settings.set("campaign-record", "inlineEditing", false));
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
    // The SAME hub window shows the remote page; Beta's own hub never opens.
    await expectPaneTitle(alpha, "E2E Sheet Remote");
    const betaHubOpen = await page.evaluate(
      ({ b }) => game.journal.get(b.groupId).sheet.rendered, { b }
    );
    expect(betaHubOpen).toBe(false);
  });

  test("a record created via New Entry opens in this hub's pane in edit mode", async ({ page }) => {
    await login(page, "Gamemaster");
    const a = await createGroupWithPage(page, "E2E Sheet Alpha", "E2E Sheet Src", "campaign-record.npc");
    // A second group exists purely to prove scoping holds even when other
    // groups are available to pick from.
    const b = await createGroupWithPage(page, "E2E Sheet Beta", "E2E Sheet Other", "campaign-record.place");
    await page.evaluate(({ a }) => game.journal.get(a.groupId).sheet.render(true), { a });
    const sheet = page.locator(".group-hub");
    await sheet.locator('.hub-index [data-action="newRecord"]').click();
    const nameInput = page.locator('dialog input[name="name"], .application.dialog input[name="name"]');
    await nameInput.waitFor({ timeout: 10_000 });
    await nameInput.fill("E2E Sheet Created Elsewhere");
    await page.locator('dialog select[name="type"], .application.dialog select[name="type"]')
      .selectOption("campaign-record.npc");
    // Since "Hide New Entry record selector when hub is scoped to a group"
    // (PR #18), a GroupHubSheet's New Entry dialog never shows a group
    // picker at all — the record always creates into the scoped group
    // (Alpha), regardless of how many other groups exist.
    await expect(
      page.locator('dialog select[name="group"], .application.dialog select[name="group"]')
    ).toHaveCount(0);
    await page.locator('dialog button[data-action="ok"], .application.dialog button[data-action="ok"]').click();

    // Lands in ALPHA's own pane. New records open in view mode
    // (#onNewRecord's navigateToRecord call takes no mode option), but
    // inline editing (client-scoped, default on) renders an NPC's view as
    // live inputs — the same "inline-edit" class other specs assert on
    // (e.g. tests/e2e/18-inline-edit.spec.mjs) — so the record is editable
    // immediately, matching this test's original "in edit mode" intent. A
    // literal <form> only appears in true edit mode, which new records
    // never enter here.
    await expectPaneTitle(sheet, "E2E Sheet Created Elsewhere");
    await expect(sheet.locator(".record-pane-mount .campaign-record-content.inline-edit")).toBeVisible();
    await expect(sheet.locator('.record-pane-mount [name="system.role"]')).toBeVisible();
    const inAlpha = await page.evaluate(
      ({ a }) => !!game.journal.get(a.groupId).pages.getName("E2E Sheet Created Elsewhere"), { a }
    );
    expect(inAlpha).toBe(true);
    const inBeta = await page.evaluate(
      ({ b }) => !!game.journal.get(b.groupId).pages.getName("E2E Sheet Created Elsewhere"), { b }
    );
    expect(inBeta).toBe(false);
  });
});
