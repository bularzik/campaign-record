import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

// Player without FILES_UPLOAD adds media through the GM relay; without a GM
// the paths degrade to clear warnings; RecordPane.mount survives concurrent
// calls without destroying live ProseMirror editors.
const P = "E2E Relay";

// 1x1 transparent PNG
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const dropFile = (page, selector, filename) =>
  page.evaluate(({ selector, filename, b64 }) => {
    const dt = new DataTransfer();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], filename, { type: "image/png" }));
    const el = document.querySelector(selector);
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { selector, filename, b64: PNG_B64 });

async function loginGm(browser) {
  const page = await browser.newPage();
  await login(page, "Gamemaster");
  return page;
}

test.describe("player media upload via GM relay", () => {
  let gmPage;
  let playerPage;
  let priorUploadRoles;

  test.beforeAll(async ({ browser }) => {
    gmPage = await loginGm(browser);
    // Ensure the player role genuinely lacks FILES_UPLOAD for this world,
    // whatever its current configuration; restored in afterAll.
    priorUploadRoles = await gmPage.evaluate(async () => {
      const perms = foundry.utils.deepClone(game.settings.get("core", "permissions"));
      const prior = [...(perms.FILES_UPLOAD ?? [])];
      perms.FILES_UPLOAD = [CONST.USER_ROLES.ASSISTANT, CONST.USER_ROLES.GAMEMASTER];
      await game.settings.set("core", "permissions", perms);
      return prior;
    });
    playerPage = await browser.newPage();
    await login(playerPage, "User 1");
  });

  test.afterAll(async ({ browser }) => {
    if (!gmPage || gmPage.isClosed()) gmPage = await loginGm(browser);
    await gmPage.evaluate(async (prior) => {
      const perms = foundry.utils.deepClone(game.settings.get("core", "permissions"));
      perms.FILES_UPLOAD = prior;
      await game.settings.set("core", "permissions", perms);
      await game.settings.set("campaign-record", "autoCaptureTargetGroup", "");
    }, priorUploadRoles);
    await deleteGroupsByPrefix(gmPage, P);
    if (playerPage && !playerPage.isClosed()) await playerPage.close();
    await gmPage.close();
  });

  test("player without FILES_UPLOAD drops an image and the GM relays the upload", async () => {
    const { groupId } = await gmPage.evaluate(async (P) => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const { addTimepoint } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = await createGroup(`${P} Drop`);
      await game.settings.set("campaign-record", "autoCaptureTargetGroup", group.id);
      await addTimepoint(group, `${P} TP1`);
      return { groupId: group.id };
    }, P);

    // Sanity: the permission override actually bit.
    expect(await playerPage.evaluate(() => game.user.can("FILES_UPLOAD"))).toBe(false);
    expect(await playerPage.evaluate(() => !!game.users.activeGM)).toBe(true);

    await playerPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    await playerPage.waitForSelector("#campaign-hub .window-content");

    await dropFile(playerPage, "#campaign-hub .window-content", "relayed.png");

    // The GM client uploads into campaign-record-media/<groupId>/ and the
    // gallery filing lands via the existing drop-media relay.
    await expect.poll(() => gmPage.evaluate((groupId) => {
      const g = game.journal.get(groupId);
      const gallery = g.pages.find((p) => p.type === "campaign-record.media");
      const img = gallery?.system.images.find((i) => i.src.includes("relayed"));
      return img?.src ?? null;
    }, groupId), { timeout: 30_000 }).toContain(`campaign-record-media/${groupId}/`);
  });

  test("concurrent RecordPane.mount calls never crash a live editor", async () => {
    const errors = [];
    gmPage.on("pageerror", (err) => errors.push(String(err)));
    await gmPage.evaluate(async (P) => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const { RecordPane } = await import("/modules/campaign-record/scripts/apps/hub/record-pane.mjs");
      const group = await createGroup(`${P} Race`);
      const [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
        { name: `${P} Notes`, type: "text", text: { content: "<p>hello</p>", format: 1 } }
      ]);
      const container = document.createElement("div");
      document.body.append(container);
      const pane = new RecordPane();
      // Pre-fix, interleaved mounts re-parent a sheet whose editor is mid-init
      // and throw replaceWith/matchesNode TypeErrors from ProseMirror.
      await Promise.all([
        pane.mount(container, page, "edit"),
        pane.mount(container, page, "view"),
        pane.mount(container, page, "edit"),
        pane.mount(container, page, "view"),
        pane.mount(container, page, "edit")
      ]);
      await new Promise((r) => setTimeout(r, 1000));
      await pane.close();
      container.remove();
    }, P);
    expect(errors).toEqual([]);
  });

  test("player drop with no GM online degrades to a clear warning", async () => {
    // Last scenario: disconnect the GM so activeGM goes null on the player.
    await gmPage.close();
    await playerPage.waitForFunction(() => !game.users.activeGM, null, { timeout: 30_000 });

    await playerPage.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    await playerPage.waitForSelector("#campaign-hub .window-content");
    await dropFile(playerPage, "#campaign-hub .window-content", "orphan.png");

    await expect(playerPage.locator("#notifications .notification", {
      hasText: "no GM is connected"
    }).first()).toBeVisible({ timeout: 15_000 });
  });
});
