import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

// Players cannot drag Actors out of the sidebar (core gates the drag on
// TOKEN_CREATE, default Assistant GM), so record sheets offer a "Link Actor"
// picker as a drag-free path. These tests run the picker as a regular player.
test.describe("actor picker (drag-free linking for players)", () => {
  let gmPage, playerCtx, playerPage, actorUuid;

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    actorUuid = await gmPage.evaluate(async () => {
      const actor = await Actor.create({
        name: "E2E Picker Actor",
        type: "npc",
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
      });
      return actor.uuid;
    });
    playerCtx = await browser.newContext();
    playerPage = await playerCtx.newPage();
    await login(playerPage, "User 2");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(gmPage, "E2E Picker");
    await gmPage.evaluate(async (uuid) => {
      const actor = await fromUuid(uuid);
      await actor?.delete();
    }, actorUuid);
    await playerCtx.close();
    await gmPage.close();
  });

  const pickActor = async (p, sheet) => {
    await sheet.locator('button[data-action="linkActor"]').first().click();
    const dialog = p.locator("dialog.application").last();
    const select = dialog.locator('select[name="actor"]');
    await select.waitFor({ timeout: 15_000 });
    await select.selectOption({ label: "E2E Picker Actor" });
    await dialog.locator('button[data-action="ok"]').click();
  };

  test("player links an actor to an NPC record via the picker", async () => {
    const ids = await createGroupWithPage(
      gmPage, "E2E Picker Group", "E2E Picker NPC", "campaign-record.npc"
    );
    await playerPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      ids
    );
    const sheet = playerPage.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[name="system.role"]').waitFor({ timeout: 15_000 });

    await pickActor(playerPage, sheet);

    await expect
      .poll(() =>
        playerPage.evaluate(
          ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.actor,
          ids
        )
      )
      .toBe(actorUuid);
    // the re-rendered sheet shows the link instead of the drop hint
    await expect(sheet.locator("a.content-link")).toContainText("E2E Picker Actor", {
      timeout: 15_000
    });
    await playerPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.close(),
      ids
    );
  });

  test("player adds a combatant to an Encounter record via the picker", async () => {
    const ids = await createGroupWithPage(
      gmPage, "E2E Picker Enc Group", "E2E Picker Encounter", "campaign-record.encounter"
    );
    await playerPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      ids
    );
    const sheet = playerPage.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[name="system.location"]').waitFor({ timeout: 15_000 });

    await pickActor(playerPage, sheet);

    await expect
      .poll(() =>
        playerPage.evaluate(
          ({ groupId, pageId }) =>
            game.journal.get(groupId).pages.get(pageId).system.combatants.map((c) => ({
              name: c.name,
              actor: c.actor
            })),
          ids
        )
      )
      .toEqual([{ name: "E2E Picker Actor", actor: actorUuid }]);
    await playerPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.close(),
      ids
    );
  });
});
