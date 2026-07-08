import { test, expect } from "@playwright/test";
import { login, settle } from "./helpers/foundry.mjs";

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

    await broadcast({ action: "goto", index: 1 });
    await expect.poll(() => playerImg.getAttribute("src")).toContain("chest.svg");

    // malformed payloads are ignored
    await broadcast({ action: "goto", index: 99 });
    await broadcast({ action: "self-destruct" });
    await expect.poll(() => playerImg.getAttribute("src")).toContain("chest.svg");

    await broadcast({ action: "end" });
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
