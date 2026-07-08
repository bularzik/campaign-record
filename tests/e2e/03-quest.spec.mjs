import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("quest objectives", () => {
  let gmPage, ids;

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    ids = await createGroupWithPage(gmPage, "E2E Quest Group", "E2E Quest", "campaign-record.quest");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(gmPage, "E2E Quest");
    await gmPage.close();
  });

  const questSystem = (p) =>
    p.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.toObject(),
      { groupId: ids.groupId, pageId: ids.pageId }
    );

  test("objectives: add, edit text, toggle, and survive structured-field edits", async () => {
    await gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = gmPage.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[data-action="addObjective"]').waitFor({ timeout: 15_000 });

    // add
    await sheet.locator('[data-action="addObjective"]').click();
    await expect.poll(async () => (await questSystem(gmPage)).objectives.length).toBe(1);

    // edit text (id-based listener, not form serialization)
    const textInput = sheet.locator('input[data-row-field="text"]').first();
    await textInput.fill("Find the macguffin");
    await textInput.dispatchEvent("change");
    await expect
      .poll(async () => (await questSystem(gmPage)).objectives[0].text)
      .toBe("Find the macguffin");

    // toggle done
    await sheet.locator('[data-action="toggleObjective"]').first().click();
    await expect.poll(async () => (await questSystem(gmPage)).objectives[0].done).toBe(true);

    // structured-field edit with objectives present must not corrupt the array
    const source = sheet.locator('[name="system.source"]');
    await source.fill("Mayor of Phandalin");
    await source.dispatchEvent("change");
    await expect.poll(async () => (await questSystem(gmPage)).source).toBe("Mayor of Phandalin");
    const after = await questSystem(gmPage);
    expect(after.objectives).toHaveLength(1);
    expect(after.objectives[0]).toMatchObject({
      text: "Find the macguffin",
      done: true,
      gmOnly: false
    });
    expect(after.objectives[0].id).toBeTruthy();
  });

  test("GM-only objectives are hidden from players; players can toggle visible ones in view mode", async ({
    browser
  }) => {
    // GM adds a second, GM-only objective
    await gmPage.evaluate(
      async ({ groupId, pageId }) => {
        const quest = game.journal.get(groupId).pages.get(pageId);
        const objectives = quest.system.toObject().objectives;
        objectives.push({ id: foundry.utils.randomID(), text: "Secret twist", done: false, gmOnly: true });
        await quest.update({ "system.objectives": objectives });
        await quest.sheet.close();
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );

    const ctx = await browser.newContext();
    const playerPage = await ctx.newPage();
    await login(playerPage, "User 1");
    await playerPage.evaluate(
      async ({ groupId, pageId }) => {
        const g = game.journal.get(groupId);
        await g.sheet.render(true);
        await g.sheet.goToPage(pageId);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const view = playerPage.locator(".journal-entry-page .quest-objectives");
    await view.waitFor({ timeout: 15_000 });
    await expect(view).toContainText("Find the macguffin");
    await expect(view).not.toContainText("Secret twist");

    // player toggles the visible objective from view mode (id-based action)
    await view.locator('[data-action="toggleObjective"]').first().click();
    await expect
      .poll(async () => (await questSystem(gmPage)).objectives.find((o) => !o.gmOnly).done)
      .toBe(false); // was true from the previous test; player unchecked it
    await ctx.close();
  });
});
