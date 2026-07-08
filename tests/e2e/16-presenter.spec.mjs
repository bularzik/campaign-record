import { test, expect } from "@playwright/test";
import { login, settle, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("presenter socket relay", () => {
  let gmPage, playerCtx, playerPage;

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    playerCtx = await browser.newContext();
    playerPage = await playerCtx.newPage();
    await login(playerPage, "User 1");
  });

  test.afterAll(async () => {
    await playerCtx.close();
    await gmPage.close();
  });

  test("broadcast show/goto/end reaches the player client; junk payloads no-op", async () => {
    const broadcast = (payload) =>
      gmPage.evaluate(async (payload) => {
        const { broadcastPresenterMessage } =
          await import("/modules/campaign-record/scripts/presenter/socket.mjs");
        broadcastPresenterMessage(payload);
      }, payload);

    const gmId = await gmPage.evaluate(() => game.user.id);
    await broadcast({
      action: "show",
      images: [{ src: "icons/svg/book.svg", caption: "One" }, { src: "icons/svg/chest.svg", caption: "Two" }],
      index: 0,
      presenterId: gmId,
      interval: 0
    });

    const playerImg = playerPage.locator("#campaign-record-overlay img");
    await playerImg.waitFor({ timeout: 15_000 });
    expect(await playerImg.getAttribute("src")).toContain("book.svg");
    // GM (sender) applies locally too
    await gmPage.locator("#campaign-record-overlay img").waitFor({ timeout: 15_000 });
    // player is not the presenter: no step controls
    await expect(playerPage.locator('#campaign-record-overlay [data-action="stepImage"]')).toHaveCount(0);

    await broadcast({ action: "goto", index: 1, presenterId: gmId });
    await expect.poll(() => playerImg.getAttribute("src")).toContain("chest.svg");

    // malformed payloads are ignored
    await broadcast({ action: "goto", index: 99 });
    await broadcast({ action: "self-destruct" });
    await expect.poll(() => playerImg.getAttribute("src")).toContain("chest.svg");

    await broadcast({ action: "end", presenterId: gmId });
    await expect(playerPage.locator("#campaign-record-overlay")).toHaveCount(0, { timeout: 15_000 });
    await expect(gmPage.locator("#campaign-record-overlay")).toHaveCount(0, { timeout: 15_000 });
  });

  test("player broadcasts and raw emits are rejected: presenting is GM-only", async () => {
    // (a) API path: the sender guard returns before emitting or applying locally.
    // (b) raw emit: the receiver guard rejects a non-GM presenterId on the GM client.
    await playerPage.evaluate(async () => {
      const { broadcastPresenterMessage, SOCKET_NAME } =
        await import("/modules/campaign-record/scripts/presenter/socket.mjs");
      const payload = {
        action: "show",
        images: [{ src: "icons/svg/book.svg", caption: "Sneaky" }],
        index: 0,
        presenterId: game.user.id,
        interval: 0
      };
      broadcastPresenterMessage(payload);
      game.socket.emit(SOCKET_NAME, payload);
    });

    await settle(gmPage, 1000); // no-op has no completion signal; wait out the round trip
    await expect(gmPage.locator("#campaign-record-overlay")).toHaveCount(0);
    await expect(playerPage.locator("#campaign-record-overlay")).toHaveCount(0);
  });
});

test.describe("media sheet presenting", () => {
  let gmPage, playerCtx, playerPage, ids;

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    ids = await createGroupWithPage(gmPage, "E2E Present Group", "E2E Present Media", "campaign-record.media");
    await gmPage.evaluate(
      async ({ groupId, pageId }) => {
        await game.journal.get(groupId).pages.get(pageId).update({
          "system.images": [
            { id: foundry.utils.randomID(), src: "icons/svg/book.svg", caption: "One" },
            { id: foundry.utils.randomID(), src: "icons/svg/chest.svg", caption: "Two" }
          ]
        });
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    playerCtx = await browser.newContext();
    playerPage = await playerCtx.newPage();
    await login(playerPage, "User 1");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(gmPage, "E2E Present");
    await playerCtx.close();
    await gmPage.close();
  });

  const playerOverlay = () => playerPage.locator("#campaign-record-overlay");

  test("present, sync, prev wrap, local viewer dismiss, presenter dismiss ends for all", async () => {
    await gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = gmPage.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[data-action="showImage"]').first().waitFor({ timeout: 15_000 });
    await sheet.locator('[data-action="showImage"]').first().click();

    await playerOverlay().locator("img").waitFor({ timeout: 15_000 });
    expect(await playerOverlay().locator("img").getAttribute("src")).toContain("book.svg");

    // presenter steps forward from the GM overlay controls
    await gmPage.locator('#campaign-record-overlay [data-action="stepImage"][data-dir="1"]').click();
    await expect.poll(() => playerOverlay().locator("img").getAttribute("src")).toContain("chest.svg");

    // presenter steps back; negative wrap keeps the index in range
    await gmPage.locator('#campaign-record-overlay [data-action="stepImage"][data-dir="-1"]').click();
    await expect.poll(() => playerOverlay().locator("img").getAttribute("src")).toContain("book.svg");

    // prev at index 0 wraps to the last image
    await gmPage.locator('#campaign-record-overlay [data-action="stepImage"][data-dir="-1"]').click();
    await expect.poll(() => playerOverlay().locator("img").getAttribute("src")).toContain("chest.svg");

    // presenter dismiss ends the presentation for everyone
    await gmPage.locator('#campaign-record-overlay [data-action="dismissOverlay"]').click();
    await expect(playerOverlay()).toHaveCount(0, { timeout: 15_000 });
    await expect(gmPage.locator("#campaign-record-overlay")).toHaveCount(0, { timeout: 15_000 });

    // re-present: player gets the overlay again
    await sheet.locator('[data-action="showImage"]').first().click();
    await playerOverlay().locator("img").waitFor({ timeout: 15_000 });

    // player dismiss is local: GM keeps presenting
    await playerOverlay().locator('[data-action="dismissOverlay"]').click();
    await expect(playerOverlay()).toHaveCount(0);
    await expect(gmPage.locator("#campaign-record-overlay img")).toBeVisible();

    // sheet-level End works directly. The GM's fullscreen overlay covers the
    // sheet, so a real pointer click cannot reach the button; dispatch a
    // bubbling click, which ApplicationV2's delegated action listener handles.
    await sheet.locator('[data-action="endPresentation"]').dispatchEvent("click");
    await expect(gmPage.locator("#campaign-record-overlay")).toHaveCount(0, { timeout: 15_000 });
  });

  test("goto with a mismatched presenterId is ignored", async () => {
    await gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = gmPage.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[data-action="showImage"]').first().click();
    await playerOverlay().locator("img").waitFor({ timeout: 15_000 });
    const srcBefore = await playerOverlay().locator("img").getAttribute("src");
    await playerPage.evaluate(async () => {
      const { SOCKET_NAME } = await import("/modules/campaign-record/scripts/presenter/socket.mjs");
      game.socket.emit(SOCKET_NAME, { action: "goto", index: 1, presenterId: game.user.id });
    });
    await settle(playerPage);
    expect(await playerOverlay().locator("img").getAttribute("src")).toBe(srcBefore);
    // GM overlay covers the sheet: dispatch a bubbling click (see flow test)
    await sheet.locator('[data-action="endPresentation"]').dispatchEvent("click");
    await expect(playerOverlay()).toHaveCount(0, { timeout: 15_000 });
  });

  test("a reloading player re-acquires the running presentation", async () => {
    await gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.render(true),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = gmPage.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[data-action="showImage"]').first().click();
    await playerOverlay().locator("img").waitFor({ timeout: 15_000 });

    await playerPage.reload();
    await playerPage.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
    await playerOverlay().locator("img").waitFor({ timeout: 15_000 });

    // GM overlay covers the sheet: dispatch a bubbling click (see flow test)
    await sheet.locator('[data-action="endPresentation"]').dispatchEvent("click");
    await expect(playerOverlay()).toHaveCount(0, { timeout: 15_000 });
  });

  test("hidden media cannot be presented", async () => {
    await gmPage.evaluate(
      async ({ groupId, pageId }) => {
        const { setRecordHidden } = await import("/modules/campaign-record/scripts/data/groups.mjs");
        await setRecordHidden(game.journal.get(groupId).pages.get(pageId), true);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = gmPage.locator(".campaign-record.record-sheet").last();
    await sheet.locator('[data-action="showImage"]').first().click();
    await expect.poll(() =>
      gmPage.evaluate(() =>
        [...document.querySelectorAll(".notification.warning")].filter((n) =>
          n.textContent.includes("Hidden media")
        ).length
      )
    ).toBeGreaterThan(0);
    await settle(playerPage);
    await expect(playerOverlay()).toHaveCount(0);
  });
});
