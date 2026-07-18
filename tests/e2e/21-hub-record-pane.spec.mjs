import { test, expect } from "@playwright/test";
import { login, createGroupWithPage, deleteGroupsByPrefix, expectPaneTitle } from "./helpers/foundry.mjs";

test.describe("hub record pane", () => {
  test.afterEach(async ({ page }) => {
    await deleteGroupsByPrefix(page, "E2E Pane");
  });

  test("index click opens the record in-pane", async ({ page }) => {
    await login(page, "Gamemaster");
    await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Npc", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.waitFor();
    await hub.locator(".record-row", { hasText: "E2E Pane Npc" }).click();

    await expectPaneTitle(hub, "E2E Pane Npc");
    await expect(hub.locator(".record-pane-mount dl.record-facts")).toBeVisible();
    // The index stays visible as the searchable left pane while viewing a record.
    await expect(hub.locator(".hub-index")).toBeVisible();
  });

  test("close button dismisses the record and reveals the timeline", async ({ page }) => {
    await login(page, "Gamemaster");
    await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Closer", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.waitFor();
    await hub.locator(".record-row", { hasText: "E2E Pane Closer" }).click();
    await expect(hub.locator(".hub-record.active")).toBeVisible();

    await hub.locator('.hub-record.active [data-action="closeRecord"]').click();

    await expect(hub.locator(".hub-record.active")).toHaveCount(0);
    await expect(hub.locator(".hub-timeline")).toBeVisible();
  });

  test("record view keeps a searchable index in the left pane", async ({ page }) => {
    await login(page, "Gamemaster");
    await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Npc", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.waitFor();
    await hub.locator(".record-row", { hasText: "E2E Pane Npc" }).click();

    // The left pane exposes the index controls and rows...
    await expect(hub.locator(".hub-index .doctype-filter")).toBeVisible();
    await expect(hub.locator(".hub-index input[name='index-search']")).toBeVisible();
    // ...the current record is flagged...
    await expect(hub.locator(".hub-index .record-row.current")).toHaveCount(1);
    // ...and the record pane overlays the (still-mounted) timeline.
    await expect(hub.locator(".hub-record.active")).toBeVisible();
    // The old rail markup is gone.
    await expect(hub.locator(".record-rail")).toHaveCount(0);
  });

  test("deleting the viewed record falls back to the index", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Doomed", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.locator(".record-row", { hasText: "E2E Pane Doomed" }).click();
    await expectPaneTitle(hub, "E2E Pane Doomed");
    await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).delete(),
      ids
    );
    await expect(hub.locator(".hub-index")).toBeVisible();
  });

  test("left index highlights current record and jumps on click", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane One", "campaign-record.npc");
    await page.evaluate(async ({ groupId }) => {
      await game.journal.get(groupId).createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Pane Two", type: "campaign-record.place" }
      ]);
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    }, ids);
    const hub = page.locator("#campaign-hub");
    await hub.locator(".record-row", { hasText: "E2E Pane One" }).click();

    const index = hub.locator(".hub-index");
    await expect(index.locator(".record-row", { hasText: "E2E Pane One" })).toHaveClass(/current/);
    await index.locator(".record-row", { hasText: "E2E Pane Two" }).click();
    await expectPaneTitle(hub, "E2E Pane Two");
    await expect(index.locator(".record-row", { hasText: "E2E Pane Two" })).toHaveClass(/current/);
  });

  test("index collapses from the default view and the toggle stays reachable", async ({ page }) => {
    await login(page, "Gamemaster");
    await createGroupWithPage(page, "E2E Pane Group", "E2E Pane One", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.waitFor();
    const toggle = hub.locator('.hub-index [data-action="toggleRail"]');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(hub).toHaveClass(/rail-collapsed/);
    await expect(hub.locator(".hub-index .record-list")).toBeHidden();
    await expect(toggle).toBeVisible();
  });

  test("left index collapse persists across a close/reopen", async ({ page }) => {
    await login(page, "Gamemaster");
    await createGroupWithPage(page, "E2E Pane Group", "E2E Pane One", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.locator('.hub-index [data-action="toggleRail"]').click();
    await expect(hub).toHaveClass(/rail-collapsed/);
    await expect(hub.locator(".hub-index .record-list")).toBeHidden();

    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.toggle(); // close
      CampaignHub.toggle(); // reopen
    });
    // The setting is applied on render, independent of whether a record is
    // being viewed — the strip stays collapsed immediately on reopen.
    await expect(hub).toHaveClass(/rail-collapsed/);
    await expect(hub.locator(".hub-index .record-list")).toBeHidden();
  });

  test("back/forward traverse visits, loops included", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane A", "campaign-record.npc");
    await page.evaluate(async ({ groupId }) => {
      await game.journal.get(groupId).createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Pane B", type: "campaign-record.place" }
      ]);
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    }, ids);
    const hub = page.locator("#campaign-hub");
    const index = hub.locator(".hub-index");
    // The shared right-pane nav also renders in the timeline tools, so scope
    // Back/Forward to the record header while a record is being viewed.
    const recordNav = hub.locator(".hub-record.active .record-pane-header");

    // Visit A -> B -> A (a loop) via index jumps.
    await hub.locator(".record-row", { hasText: "E2E Pane A" }).click();
    await index.locator(".record-row", { hasText: "E2E Pane B" }).click();
    await index.locator(".record-row", { hasText: "E2E Pane A" }).click();
    await expectPaneTitle(hub, "E2E Pane A");

    await recordNav.locator('[data-action="paneBack"]').click();
    await expectPaneTitle(hub, "E2E Pane B");
    // Forward works while a record is still showing (the pane, including its
    // Back/Forward header, is part of the record overlay).
    await recordNav.locator('[data-action="paneForward"]').click();
    await expectPaneTitle(hub, "E2E Pane A");
    await recordNav.locator('[data-action="paneBack"]').click();
    await expectPaneTitle(hub, "E2E Pane B");
    await recordNav.locator('[data-action="paneBack"]').click();
    await expectPaneTitle(hub, "E2E Pane A");
    await recordNav.locator('[data-action="paneBack"]').click();
    // Root: the record pane (including its Back/Forward header) overlays
    // nothing here and is hidden entirely — only the index is visible.
    await expect(hub.locator(".hub-index")).toBeVisible();
    await expect(hub.locator(".hub-record.active")).toHaveCount(0);
  });

  test("edit toggle flips to the edit form and persists a change", async ({ page }) => {
    await login(page, "Gamemaster");
    // Inline editing (client-scoped, default on) renders view-mode facts as
    // inputs; that branch is covered by 18-inline-edit. This test asserts the
    // read-only view text after leaving edit mode, so switch the toggle off.
    await page.evaluate(() => game.settings.set("campaign-record", "inlineEditing", false));
    const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Editable", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.locator(".record-row", { hasText: "E2E Pane Editable" }).click();

    await hub.locator('[data-action="toggleEditMode"]').click();
    const roleInput = hub.locator('.record-pane-mount [name="system.role"]');
    await roleInput.waitFor();
    await roleInput.fill("Quartermaster");
    await roleInput.blur(); // submitOnChange persists

    await hub.locator('[data-action="toggleEditMode"]').click();
    await expect(hub.locator(".record-pane-mount dl.record-facts")).toContainText("Quartermaster");
    const stored = await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.role,
      ids
    );
    expect(stored).toBe("Quartermaster");
  });

  test("text pages view and edit in-pane", async ({ page }) => {
    await login(page, "Gamemaster");
    // Inline editing (client-scoped, default on) makes a non-markdown text
    // page's view mode directly editable, with no separate edit-toggle
    // button (see shouldShowEditToggle/isInlineEditableView in
    // scripts/logic/inline-edit.mjs). This test asserts the manual
    // toggle-driven view -> edit transition, so switch inline editing off,
    // matching the sibling "edit toggle flips..." test above.
    await page.evaluate(() => game.settings.set("campaign-record", "inlineEditing", false));
    const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Text", "text");
    await page.evaluate(async ({ groupId, pageId }) => {
      await game.journal.get(groupId).pages.get(pageId).update({
        "text.content": "<p>Chronicle of the keep</p>"
      });
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    }, ids);
    const hub = page.locator("#campaign-hub");
    await hub.locator(".record-row", { hasText: "E2E Pane Text" }).click();
    await expect(hub.locator(".record-pane-mount")).toContainText("Chronicle of the keep");

    await hub.locator('[data-action="toggleEditMode"]').click();
    await expect(hub.locator('.record-pane-mount [contenteditable="true"]').first()).toBeVisible();
  });

  test("new record opens in-pane in edit mode", async ({ page }) => {
    await login(page, "Gamemaster");
    await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Seed", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    // The shared right-pane nav also renders in the (inactive) record
    // header, so scope New Entry to the timeline tools shown by default.
    await hub.locator('.hub-timeline [data-action="newRecord"]').click();
    const nameInput = page.locator('dialog input[name="name"], .application.dialog input[name="name"]');
    await nameInput.waitFor({ timeout: 10_000 });
    await nameInput.fill("E2E Pane Fresh");
    // The New Entry dialog defaults its type to "Journal" (text) since the
    // 2026-07-17 new-creation-defaults change (buildNewRecordTypeOptions in
    // scripts/logic/new-record-form.mjs). This test wants a system-backed
    // record with a "system.role" field, so select NPC explicitly.
    const typeSelect = page.locator('dialog select[name="type"], .application.dialog select[name="type"]');
    await typeSelect.selectOption({ label: "NPC" });
    const groupSelect = page.locator('dialog select[name="group"], .application.dialog select[name="group"]');
    await groupSelect.selectOption({ label: "E2E Pane Group" });
    await page
      .locator('dialog button[data-action="ok"], .application.dialog button[data-action="ok"]')
      .click();

    await expectPaneTitle(hub, "E2E Pane Fresh");
    await expect(hub.locator('.record-pane-mount [name="system.role"]')).toBeVisible();
  });

  test("record links inside a record navigate in-pane", async ({ page }) => {
    await login(page, "Gamemaster");
    // Content links only render as clickable anchors in the read-only
    // (enriched) view — inline editing shows a live editor instead.
    await page.evaluate(() => game.settings.set("campaign-record", "inlineEditing", false));
    const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Source", "campaign-record.npc");
    await page.evaluate(async ({ groupId }) => {
      const group = game.journal.get(groupId);
      const [target] = await group.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Pane Target", type: "campaign-record.place" }
      ]);
      const source = group.pages.getName("E2E Pane Source");
      await source.update({ "system.description": `<p>See @UUID[${target.uuid}]{the target}</p>` });
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    }, ids);
    const hub = page.locator("#campaign-hub");
    await hub.locator(".record-row", { hasText: "E2E Pane Source" }).click();
    await hub.locator(".record-pane-mount a.content-link", { hasText: "the target" }).click();
    await expectPaneTitle(hub, "E2E Pane Target");
    await expect(hub.locator(".hub-index .record-row", { hasText: "E2E Pane Target" })).toHaveClass(/current/);
  });

  test("player without update permission gets no edit toggle", async ({ page, browser }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Locked", "campaign-record.npc");
    await page.evaluate(async ({ groupId }) => {
      await game.journal.get(groupId).update({
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
      });
    }, ids);

    const ctx = await browser.newContext();
    const playerPage = await ctx.newPage();
    try {
      await login(playerPage, "User 1");
      await playerPage.evaluate(async () => {
        const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
        CampaignHub.open();
      });
      const hub = playerPage.locator("#campaign-hub");
      await hub.locator(".record-row", { hasText: "E2E Pane Locked" }).click();
      await expectPaneTitle(hub, "E2E Pane Locked");
      await expect(hub.locator('[data-action="toggleEditMode"]')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test("a page the player cannot observe falls back to the index silently", async ({ page, browser }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(
      page, "E2E Pane Restricted Group", "E2E Pane Restricted Page", "campaign-record.npc"
    );
    await page.evaluate(async ({ groupId, pageId }) => {
      const target = game.journal.get(groupId).pages.get(pageId);
      await target.update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE } });
    }, ids);

    const ctx = await browser.newContext();
    const playerPage = await ctx.newPage();
    try {
      await login(playerPage, "User 1");
      await playerPage.evaluate(async ({ pageUuid }) => {
        const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
        const hub = CampaignHub.open();
        await hub.navigateToRecord(pageUuid);
      }, ids);

      const hub = playerPage.locator("#campaign-hub");
      await expect(hub.locator(".hub-index")).toBeVisible();
      await expect(hub.locator(".record-pane-title")).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test("editable record renders the title as an input", async ({ page }) => {
    const { hub, input } = await openRenameFixture(page);
    await expect(input).toHaveValue("E2E Pane Rename");
    await expect(hub.locator("h2.record-pane-title")).toHaveCount(0);
  });

  test("observer without update permission still gets the static title", async ({ browser, page }) => {
    await login(page, "Gamemaster");
    const ids = await page.evaluate(async () => {
      const entry = await JournalEntry.create({
        name: "E2E Pane Observer Group",
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
        flags: {
          "campaign-record": { group: { timepoints: [] } },
          core: { sheetClass: "campaign-record.GroupHubSheet" }
        }
      });
      const [recordPage] = await entry.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Pane Observed", type: "campaign-record.npc" }
      ]);
      return { groupId: entry.id, pageId: recordPage.id };
    });
    const ctx = await browser.newContext();
    const playerPage = await ctx.newPage();
    try {
      await login(playerPage, "User 1");
      await playerPage.evaluate(async ({ groupId, pageId }) => {
        await game.settings.set("campaign-record", "inlineEditing", true);
        const sheet = game.journal.get(groupId).sheet;
        await sheet.render({ force: true });
        await sheet.goToPage(pageId);
      }, ids);
      const sheet = playerPage.locator(".group-hub");
      await expect(sheet.locator("h2.record-pane-title")).toHaveText("E2E Pane Observed");
      await expect(sheet.locator("input.record-pane-title")).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  async function openRenameFixture(page) {
    await login(page, "Gamemaster");
    await createGroupWithPage(page, "E2E Pane Group", "E2E Pane Rename", "campaign-record.npc");
    await page.evaluate(async () => {
      await game.settings.set("campaign-record", "inlineEditing", true);
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.waitFor();
    await hub.locator(".record-row", { hasText: "E2E Pane Rename" }).click();
    const input = hub.locator("input.record-pane-title");
    await expect(input).toHaveValue("E2E Pane Rename");
    return { hub, input };
  }

  test("typing a new name and pressing Enter renames the record", async ({ page }) => {
    const { hub, input } = await openRenameFixture(page);
    await input.fill("E2E Pane Renamed");
    await input.press("Enter");

    // The document saved and the index row picked up the new name.
    await expect(hub.locator(".hub-index .record-row", { hasText: "E2E Pane Renamed" })).toHaveCount(1);
    await expect(input).toHaveValue("E2E Pane Renamed");
    expect(await page.evaluate(() =>
      game.journal.getName("E2E Pane Group").pages.getName("E2E Pane Renamed")?.name
    )).toBe("E2E Pane Renamed");
  });

  test("Escape reverts the title without saving", async ({ page }) => {
    const { hub, input } = await openRenameFixture(page);
    await input.fill("E2E Pane Discarded");
    await input.press("Escape");

    await expect(input).toHaveValue("E2E Pane Rename");
    // The hub window itself must survive the Escape (not close).
    await expect(hub).toBeVisible();
    expect(await page.evaluate(() =>
      game.journal.getName("E2E Pane Group").pages.getName("E2E Pane Rename")?.name
    )).toBe("E2E Pane Rename");
  });

  test("committing an empty name reverts instead of saving", async ({ page }) => {
    const { input } = await openRenameFixture(page);
    await input.fill("   ");
    await input.press("Enter");

    await expect(input).toHaveValue("E2E Pane Rename");
    expect(await page.evaluate(() =>
      game.journal.getName("E2E Pane Group").pages.getName("E2E Pane Rename")?.name
    )).toBe("E2E Pane Rename");
  });
});
