import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, deleteScenesByPrefix } from "./helpers/foundry.mjs";

// Runtime verification for the linked-scene click behavior (Task 2 Step 6):
// the capture-phase interceptor on a Campaign Record sheet must pre-empt
// Foundry's default content-link handler and, for a user who can view the
// scene, load it via scene.view(). Also confirms Scene#canView exists on the
// live v13 build (the design flagged this to verify, not assume) and that the
// image branch never files a media entry.
const P = "E2E SceneClick";

test.describe("linked-scene content-link click", () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
  });

  test.afterAll(async () => {
    await deleteScenesByPrefix(page, P);
    await deleteGroupsByPrefix(page, P);
    await page.close();
  });

  test("Scene#canView exists on the live build and is true for the GM", async () => {
    const canView = await page.evaluate(async (P) => {
      const scene = await Scene.create({ name: `${P} CanView`, width: 1000, height: 1000 });
      return { present: "canView" in scene || scene.canView !== undefined, value: scene.canView };
    }, P);
    // If canView is undefined the sheet's fallback (isGM || testUserPermission)
    // still covers the GM, but the design asked us to confirm the API exists.
    expect(canView.present, "Scene#canView is exposed on v13.351").toBe(true);
    expect(canView.value, "GM can view any scene").toBe(true);
  });

  test("GM click on a linked-scene content link loads the scene (interceptor pre-empts core)", async () => {
    // Build a group + Place record linked to a fresh, non-active scene.
    const ids = await page.evaluate(async (P) => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const group = await createGroup(`${P} Group`);
      const scene = await Scene.create({
        name: `${P} Keep`,
        width: 1000,
        height: 1000,
        background: { src: "icons/svg/direction.svg" }
      });
      const [place] = await group.createEmbeddedDocuments("JournalEntryPage", [
        { name: `${P} Place`, type: "campaign-record.place", system: { scene: scene.uuid } }
      ]);
      // Make sure the target scene is not already the viewed one, so a
      // successful view() is observable as a real transition.
      if (canvas?.scene?.id === scene.id) {
        const other = game.scenes.find((s) => s.id !== scene.id);
        if (other) await other.view();
      }
      return { groupId: group.id, sceneId: scene.id, placeUuid: place.uuid };
    }, P);

    // Render the Place sheet in view mode, confirm the interceptor bound, then
    // dispatch a real click on the rendered scene content link.
    const result = await page.evaluate(async ({ placeUuid, sceneId }) => {
      const place = await fromUuid(placeUuid);
      const sheet = place.sheet;
      await sheet.render(true);
      // Wait for the enriched content link to appear in the sheet element.
      const deadline = Date.now() + 5000;
      let link = null;
      while (Date.now() < deadline) {
        link = sheet.element.querySelector("a.content-link[data-uuid]");
        if (link) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!link) return { error: "no content link rendered" };

      const bound = sheet.element.dataset.crSceneLinkBound === "1";
      const linkUuid = link.dataset.uuid;

      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      // Poll for the async handler (fromUuid + scene.view()) to settle.
      const settleBy = Date.now() + 5000;
      while (Date.now() < settleBy && canvas?.scene?.id !== sceneId) {
        await new Promise((r) => setTimeout(r, 50));
      }

      // Any Scene config sheet open would mean core's default handler leaked
      // through instead of being pre-empted.
      const sceneConfigOpen = Object.values(ui.windows).some(
        (w) => w?.document?.id === sceneId && /SceneConfig/.test(w?.constructor?.name ?? "")
      );

      await sheet.close();
      return {
        bound,
        linkUuid,
        viewedSceneId: canvas?.scene?.id ?? null,
        sceneConfigOpen
      };
    }, ids);

    expect(result.error, "content link should render on the Place view").toBeUndefined();
    expect(result.bound, "capture-phase interceptor is bound to the record sheet").toBe(true);
    expect(result.linkUuid, "the rendered link points at the linked scene").toContain("Scene.");
    expect(result.viewedSceneId, "clicking loaded the linked scene onto the GM canvas").toBe(ids.sceneId);
    expect(result.sceneConfigOpen, "core's default handler did not also open the Scene config").toBe(false);
  });

  test("image branch reads background then thumb, and never files a media entry", async () => {
    // The player-facing branch is exercised through the module's own pure
    // decision logic (identical to what the sheet calls) plus a guarantee that
    // the local ImagePopout render never triggers auto-capture. resolveScene-
    // ClickAction is unit-tested; here we confirm on the live build that the
    // scene primitives it reads are shaped as expected and that rendering an
    // ImagePopout locally creates no JournalEntryPage.
    const out = await page.evaluate(async (P) => {
      const { resolveSceneClickAction } = await import(
        "/modules/campaign-record/scripts/logic/scene-link.mjs"
      );
      const scene = await Scene.create({
        name: `${P} Peek`,
        width: 1000,
        height: 1000,
        background: { src: "icons/svg/door-closed.svg" }
      });
      const action = resolveSceneClickAction({
        canView: false,
        backgroundSrc: scene.background?.src,
        thumb: scene.thumb,
        name: scene.name
      });

      // Render the popout exactly as the sheet does (local, never shared) and
      // confirm it does not create a media page anywhere.
      const pagesBefore = game.journal.reduce((n, j) => n + j.pages.size, 0);
      const popout = new foundry.applications.apps.ImagePopout({
        src: action.src,
        window: { title: action.title }
      });
      await popout.render(true);
      await new Promise((r) => setTimeout(r, 300));
      const pagesAfter = game.journal.reduce((n, j) => n + j.pages.size, 0);
      await popout.close();

      return { action, pagesBefore, pagesAfter };
    }, P);

    expect(out.action.kind, "cannot-view with a background yields the image branch").toBe("image");
    expect(out.action.src, "image branch prefers the scene background").toBe("icons/svg/door-closed.svg");
    expect(out.pagesAfter, "showing the scene image creates no media entry").toBe(out.pagesBefore);
  });
});
