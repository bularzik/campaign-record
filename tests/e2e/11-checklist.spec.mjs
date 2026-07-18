import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage, deleteActorsByPrefix } from "./helpers/foundry.mjs";

test.describe("checklist", () => {
  let gmPage, ids, actorId;

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    ids = await createGroupWithPage(gmPage, "E2E Checklist Group", "E2E Checklist", "campaign-record.checklist");
    // LIMITED default ownership: players see the assignee as a clickable link.
    actorId = await gmPage.evaluate(async () => {
      const actor = await Actor.create({
        name: "E2E Checklist PC",
        type: "character",
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED }
      });
      return actor.id;
    });
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(gmPage, "E2E Checklist");
    await deleteActorsByPrefix(gmPage, "E2E Checklist PC");
    await gmPage.close();
  });

  const items = () =>
    gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.toObject().items,
      { groupId: ids.groupId, pageId: ids.pageId }
    );

  test("GM adds items, edits text, assigns a character, toggles done", async () => {
    await gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = gmPage.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[data-action="addItem"]').waitFor({ timeout: 15_000 });
    await sheet.locator('[data-action="addItem"]').click();
    await expect.poll(async () => (await items()).length).toBe(1);

    const text = sheet.locator('[data-rows="items"] [data-row-field="text"]').first();
    await text.fill("Buy rations");
    await text.dispatchEvent("change");
    await expect.poll(async () => (await items())[0].text).toBe("Buy rations");

    const assignee = sheet.locator('[data-rows="items"] [data-row-field="assignee"]').first();
    await assignee.selectOption(actorId);
    await assignee.dispatchEvent("change");
    await expect.poll(async () => (await items())[0].assignee).toBe(actorId);

    await sheet.locator('[data-action="toggleItem"]').first().click();
    await expect.poll(async () => (await items())[0].done).toBe(true);
    await gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.close(),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
  });

  test("player sees the assignee, opens the actor sheet, toggles an item", async ({ browser }) => {
    const ctx = await browser.newContext();
    const playerPage = await ctx.newPage();
    await login(playerPage, "User 1");
    // Inline editing (client-scoped, default on) renders items as inputs;
    // that branch is covered by 18-inline-edit. This test asserts the
    // read-only view, so switch the toggle off for this client.
    await playerPage.evaluate(() =>
      game.settings.set("campaign-record", "inlineEditing", false)
    );
    await playerPage.evaluate(
      async ({ groupId, pageId }) => {
        const g = game.journal.get(groupId);
        await g.sheet.render(true);
        await g.sheet.goToPage(pageId);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const view = playerPage.locator(".journal-entry-page .checklist-items");
    await view.waitFor({ timeout: 15_000 });
    await expect(view).toContainText("Buy rations");
    await expect(view.locator('[data-action="openAssignee"]').first()).toHaveText("E2E Checklist PC");
    await view.locator('[data-action="openAssignee"]').first().click();
    await expect
      .poll(async () =>
        playerPage.evaluate((id) => game.actors.get(id)?.sheet?.rendered ?? false, actorId)
      )
      .toBe(true);
    // The actor sheet window overlaps the checklist item in the viewport and
    // intercepts pointer events; close it now that we've confirmed it opened.
    await playerPage.evaluate((id) => game.actors.get(id)?.sheet?.close(), actorId);
    await view.locator('[data-action="toggleItem"]').first().click();
    await expect.poll(async () => (await items())[0].done).toBe(false); // GM toggled it true earlier
    await ctx.close();
  });
});
