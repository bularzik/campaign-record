import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage, settle } from "./helpers/foundry.mjs";

test.describe("hub timeline links", () => {
  let gmPage, playerCtx, playerPage, ids, actors;

  const openTimeline = async (p) => {
    await p.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = p.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    await hub.locator('[data-action="tab"][data-tab="timeline"]').click();
    return hub;
  };

  const dispatchDrop = (p, selector, payload) =>
    p.evaluate(([selector, payload]) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify(payload));
      const el = document.querySelector(selector);
      if (!el) throw new Error(`drop target not found: ${selector}`);
      el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, [selector, payload]);

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    ids = await createGroupWithPage(gmPage, "E2E Links Group", "E2E Links NPC", "campaign-record.npc");
    actors = await gmPage.evaluate(async () => {
      const secret = await Actor.implementation.create({
        name: "E2E Secret Villain", type: game.system.id === "dnd5e" ? "npc" : Object.keys(CONFIG.Actor.dataModels)[0] ?? "base",
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }
      });
      const known = await Actor.implementation.create({
        name: "E2E Known Ally", type: secret.type,
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
      });
      const { addTimepoint } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = game.journal.getName("E2E Links Group");
      await addTimepoint(group, "Linked Session");
      return { secretUuid: secret.uuid, knownUuid: known.uuid, secretId: secret.id, knownId: known.id };
    });
    playerCtx = await browser.newContext();
    playerPage = await playerCtx.newPage();
    await login(playerPage, "User 1");
  });

  test.afterAll(async () => {
    await gmPage.evaluate(async ({ secretId, knownId }) => {
      await game.actors.get(secretId)?.delete();
      await game.actors.get(knownId)?.delete();
    }, actors);
    await deleteGroupsByPrefix(gmPage, "E2E Links");
    await playerCtx.close();
    await gmPage.close();
  });

  test("dropped actors become link chips filtered by ownership", async () => {
    const gmHub = await openTimeline(gmPage);
    const dropSelector = `#campaign-hub .timeline-group[data-group-id="${ids.groupId}"] [data-drop-timepoint]`;
    await dispatchDrop(gmPage, dropSelector, { type: "Actor", uuid: actors.secretUuid });
    await dispatchDrop(gmPage, dropSelector, { type: "Actor", uuid: actors.knownUuid });

    await expect(gmHub.locator(".link-chip", { hasText: "E2E Secret Villain" })).toBeVisible({ timeout: 10_000 });
    await expect(gmHub.locator(".link-chip", { hasText: "E2E Known Ally" })).toBeVisible();

    const playerHub = await openTimeline(playerPage);
    await expect(playerHub.locator(".link-chip", { hasText: "E2E Known Ally" })).toBeVisible({ timeout: 10_000 });
    await expect(playerHub.locator(".link-chip", { hasText: "E2E Secret Villain" })).toHaveCount(0);
  });

  test("duplicate drop of the same document does not add a second chip", async () => {
    const gmHub = gmPage.locator("#campaign-hub");
    const dropSelector = `#campaign-hub .timeline-group[data-group-id="${ids.groupId}"] [data-drop-timepoint]`;
    await dispatchDrop(gmPage, dropSelector, { type: "Actor", uuid: actors.knownUuid });
    await settle(gmPage);
    await expect(gmHub.locator(".link-chip", { hasText: "E2E Known Ally" })).toHaveCount(1);
  });

  test("image drop prompts for player visibility; eye toggle reveals it live", async () => {
    const gmHub = gmPage.locator("#campaign-hub");
    const dropSelector = `#campaign-hub .timeline-group[data-group-id="${ids.groupId}"] [data-drop-timepoint]`;
    await dispatchDrop(gmPage, dropSelector, { src: "icons/svg/mystery-man.svg" });
    const noButton = gmPage.locator('dialog button[data-action="no"], .application.dialog button[data-action="no"]');
    await noButton.waitFor({ timeout: 10_000 });
    await noButton.click();

    const gmImageChip = gmHub.locator(".link-chip", { hasText: "mystery-man.svg" });
    await expect(gmImageChip).toBeVisible({ timeout: 10_000 });

    const playerHub = playerPage.locator("#campaign-hub");
    await expect(playerHub.locator(".link-chip", { hasText: "mystery-man.svg" })).toHaveCount(0);

    await gmImageChip.locator('[data-action="toggleLinkShowPlayers"]').click();
    await expect(playerHub.locator(".link-chip", { hasText: "mystery-man.svg" }))
      .toBeVisible({ timeout: 10_000 });
  });

  test("clicking an image chip opens an image popout", async () => {
    const gmHub = gmPage.locator("#campaign-hub");
    // click the chip body, not its inner action anchors
    await gmHub.locator(".link-chip", { hasText: "mystery-man.svg" }).locator("i").first().click();
    const popout = gmPage.locator(".image-popout, .app.image-popout, .application.image-popout");
    await expect(popout).toBeVisible({ timeout: 10_000 });
    // Close via the popout's own header button: Escape would close every open
    // window in v13 (ClientKeybindings dismiss, "Case 4"), taking the hub with it.
    await popout.locator('[data-action="close"]').first().click();
    await expect(popout).toHaveCount(0, { timeout: 10_000 });
  });

  test("dangling links render GM-only as broken chips", async () => {
    await gmPage.evaluate(async ({ groupId }) => {
      const { getTimepoints, addLink } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = game.journal.get(groupId);
      await addLink(group, getTimepoints(group)[0].id, {
        uuid: "Actor.deadbeefdead", name: "E2E Ghost", type: "Actor"
      });
    }, { groupId: ids.groupId });
    const gmHub = gmPage.locator("#campaign-hub");
    await expect(gmHub.locator(".link-chip.broken", { hasText: "E2E Ghost" })).toBeVisible({ timeout: 10_000 });
    await expect(playerPage.locator("#campaign-hub .link-chip", { hasText: "E2E Ghost" })).toHaveCount(0);
  });

  test("thumbnail toggle switches image chips to thumbnails and persists the setting", async () => {
    const gmHub = gmPage.locator("#campaign-hub");
    await gmHub.locator('button[data-action="toggleThumbnails"]').click();
    await expect(gmHub.locator(".link-chip img.link-thumb").first()).toBeVisible({ timeout: 10_000 });
    const stored = await gmPage.evaluate(() => game.settings.get("campaign-record", "timelineThumbnails"));
    expect(stored).toBe(true);
    await gmHub.locator('button[data-action="toggleThumbnails"]').click();
    await expect(gmHub.locator(".link-chip img.link-thumb")).toHaveCount(0);
  });

  test("cross-group record drop attaches as a link instead of warning", async () => {
    const otherIds = await createGroupWithPage(
      gmPage, "E2E Links Other Group", "E2E Links Other NPC", "campaign-record.npc"
    );
    const dropSelector = `#campaign-hub .timeline-group[data-group-id="${ids.groupId}"] [data-drop-timepoint]`;
    await dispatchDrop(gmPage, dropSelector, { kind: "campaign-record.record", uuid: otherIds.pageUuid });
    await expect(gmPage.locator("#campaign-hub .link-chip", { hasText: "E2E Links Other NPC" }))
      .toBeVisible({ timeout: 10_000 });
  });

  test("GM removes a link with the chip's remove control", async () => {
    const gmHub = gmPage.locator("#campaign-hub");
    const chip = gmHub.locator(".link-chip", { hasText: "E2E Known Ally" });
    await chip.locator('[data-action="removeLink"]').click();
    await expect(gmHub.locator(".link-chip", { hasText: "E2E Known Ally" })).toHaveCount(0, { timeout: 10_000 });
  });
});
