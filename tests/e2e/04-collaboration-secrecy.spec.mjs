import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("multi-client collaboration and GM secrecy", () => {
  let gmPage, playerCtx, playerPage, ids;

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    ids = await createGroupWithPage(gmPage, "E2E Collab Group", "E2E Collab NPC", "campaign-record.npc");
    await gmPage.evaluate(
      ({ groupId, pageId }) =>
        game.journal.get(groupId).pages.get(pageId).update({
          "system.gmNotes": "<p>SECRET-GM-NOTE</p>"
        }),
      ids
    );
    playerCtx = await browser.newContext();
    playerPage = await playerCtx.newPage();
    await login(playerPage, "User 1");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(gmPage, "E2E Collab");
    await playerCtx.close();
    await gmPage.close();
  });

  const openEditSheet = async (p) => {
    await p.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      ids
    );
    const sheet = p.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[name="system.role"]').waitFor({ timeout: 15_000 });
    return sheet;
  };

  test("player can edit records; structured edits propagate live to the other client", async () => {
    const gmSheet = await openEditSheet(gmPage);
    const playerSheet = await openEditSheet(playerPage);

    // player edits a field — persists (default OWNER) and appears on the GM's open sheet
    const playerRole = playerSheet.locator('[name="system.role"]');
    await playerRole.fill("Blacksmith");
    await playerRole.dispatchEvent("change");
    await expect(gmSheet.locator('[name="system.role"]')).toHaveValue("Blacksmith", {
      timeout: 15_000
    });

    // GM edits another field — appears on the player's open sheet
    const gmFaction = gmSheet.locator('[name="system.faction"]');
    await gmFaction.fill("Iron Circle");
    await gmFaction.dispatchEvent("change");
    await expect(playerSheet.locator('[name="system.faction"]')).toHaveValue("Iron Circle", {
      timeout: 15_000
    });
  });

  test("description editing is collaborative: GM keystrokes stream into the player's open editor", async () => {
    const gmSheet = gmPage.locator(".campaign-record.record-sheet").last();
    const playerSheet = playerPage.locator(".campaign-record.record-sheet").last();

    // open the description editor on both clients (toggled prose-mirror)
    for (const sheet of [gmSheet, playerSheet]) {
      const pm = sheet.locator('prose-mirror[name="system.description"]');
      await pm.locator('button[data-action="edit"], button.icon.toggle').first().click();
      await pm.locator('.editor-content.ProseMirror, .ProseMirror[contenteditable="true"]').waitFor({
        timeout: 15_000
      });
    }

    // GM types; the player's still-open editor receives the collaborative steps
    const gmEditor = gmSheet
      .locator('prose-mirror[name="system.description"] .ProseMirror[contenteditable="true"]')
      .first();
    await gmEditor.click();
    await gmPage.keyboard.type("COLLAB-FROM-GM");
    await expect(
      playerPage
        .locator('prose-mirror[name="system.description"] .ProseMirror[contenteditable="true"]')
        .first()
    ).toContainText("COLLAB-FROM-GM", { timeout: 20_000 });

    // player types into the same paragraph; GM sees it too
    const playerEditor = playerPage
      .locator('prose-mirror[name="system.description"] .ProseMirror[contenteditable="true"]')
      .first();
    await playerEditor.click();
    await playerPage.keyboard.press("End");
    await playerPage.keyboard.type(" AND-FROM-PLAYER");
    await expect(gmEditor).toContainText("AND-FROM-PLAYER", { timeout: 20_000 });

    // close sheets without saving concerns; collaborative session persists via server
    await gmPage.evaluate(({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.close(), ids);
    await playerPage.evaluate(({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.close(), ids);
  });

  test("GM notes never reach the player's DOM", async () => {
    const playerSheet = await openEditSheet(playerPage);
    await expect(playerSheet.locator('prose-mirror[name="system.gmNotes"]')).toHaveCount(0);
    const domHasSecret = await playerPage.evaluate(
      () => document.body.innerHTML.includes("SECRET-GM-NOTE")
    );
    expect(domHasSecret).toBe(false);
    await playerPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.close(),
      ids
    );
  });

  test("players cannot set the hidden flag (client guard strips it)", async () => {
    const result = await playerPage.evaluate(async ({ groupId, pageId }) => {
      const record = game.journal.get(groupId).pages.get(pageId);
      await record.update({ "system.hidden": true });
      return record.system.hidden;
    }, ids);
    expect(result).toBe(false);
  });

  test("hiding a record removes it from the player's journal TOC; revealing restores it", async () => {
    await gmPage.evaluate(async ({ groupId, pageId }) => {
      const { setRecordHidden } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      await setRecordHidden(game.journal.get(groupId).pages.get(pageId), true);
    }, ids);

    await expect
      .poll(() =>
        playerPage.evaluate(
          ({ groupId, pageId }) =>
            game.journal
              .get(groupId)
              .pages.get(pageId)
              ?.testUserPermission(game.user, "OBSERVER") ?? false,
          ids
        )
      )
      .toBe(false);

    await gmPage.evaluate(async ({ groupId, pageId }) => {
      const { setRecordHidden } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      await setRecordHidden(game.journal.get(groupId).pages.get(pageId), false);
    }, ids);

    await expect
      .poll(() =>
        playerPage.evaluate(
          ({ groupId, pageId }) =>
            game.journal
              .get(groupId)
              .pages.get(pageId)
              ?.testUserPermission(game.user, "OBSERVER") ?? false,
          ids
        )
      )
      .toBe(true);
  });
});
