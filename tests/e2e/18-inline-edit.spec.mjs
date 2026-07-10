import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage, settle } from "./helpers/foundry.mjs";

test.describe("inline-editable record views", () => {
  let gmPage, ids;

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    await gmPage.evaluate(() => game.settings.set("campaign-record", "inlineEditing", true));
    ids = await createGroupWithPage(gmPage, "E2E Inline Group", "E2E Inline Quest", "campaign-record.quest");
  });

  test.afterAll(async () => {
    await gmPage.evaluate(() => game.settings.set("campaign-record", "inlineEditing", true));
    await deleteGroupsByPrefix(gmPage, "E2E Inline");
    await gmPage.close();
  });

  const questSystem = (p) =>
    p.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.toObject(),
      { groupId: ids.groupId, pageId: ids.pageId }
    );

  // The group's sheet is the GroupHubSheet: goToPage lands the record in-pane.
  const openView = async (p) => {
    await p.evaluate(
      async ({ groupId, pageId }) => {
        const sheet = game.journal.get(groupId).sheet;
        await sheet.render({ force: true });
        await sheet.goToPage(pageId);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    await p
      .locator(".group-hub .record-pane-mount .campaign-record-content.inline-edit")
      .first()
      .waitFor({ timeout: 15_000 });
  };

  test("view mode is inline-editable by default and plain fields auto-save", async () => {
    expect(
      await gmPage.evaluate(
        () => game.settings.settings.get("campaign-record.inlineEditing").default
      )
    ).toBe(true);
    await openView(gmPage);
    const view = gmPage.locator(".record-pane-mount .campaign-record-content.inline-edit").first();
    const source = view.locator('input[name="system.source"]');
    await source.fill("Innkeeper rumor");
    await source.dispatchEvent("change");
    await expect.poll(async () => (await questSystem(gmPage)).source).toBe("Innkeeper rumor");

    const status = view.locator('select[name="system.status"]');
    await status.selectOption("active");
    await expect.poll(async () => (await questSystem(gmPage)).status).toBe("active");
  });

  test("Enter in an inline control never writes junk to the group document", async () => {
    await openView(gmPage);
    const view = gmPage.locator(".record-pane-mount .campaign-record-content.inline-edit").first();
    const source = view.locator('input[name="system.source"]');
    // Pressing Enter in a single-line text input fires an implicit submit on
    // the ancestor GroupHubSheet <form>. That must not serialize system.* or
    // hub-UI keys into a JournalEntry update — the record sheet's change
    // listener is the only thing that persists.
    await source.fill("Enter key test");
    await source.press("Enter");
    await expect.poll(async () => (await questSystem(gmPage)).source).toBe("Enter key test");
    // Force the submit path deterministically too (implicit submission rules
    // vary with form contents) and confirm the group document stays clean.
    await gmPage.evaluate(
      ({ groupId }) => {
        const form = game.journal.get(groupId).sheet.element;
        form.requestSubmit();
      },
      { groupId: ids.groupId }
    );
    await settle(gmPage);
    const group = await gmPage.evaluate(
      ({ groupId }) => {
        const g = game.journal.get(groupId);
        return { name: g.name, source: g.toObject() };
      },
      { groupId: ids.groupId }
    );
    expect(group.name).toBe("E2E Inline Group");
    expect(group.source.system).toBeUndefined();
    expect(group.source["group-select"]).toBeUndefined();
    expect(await gmPage.locator("#notifications .notification.error").count()).toBe(0);
  });

  test("prose fields save as-you-type after the debounce and keep focus", async () => {
    await openView(gmPage);
    const editor = gmPage
      .locator('.record-pane-mount .campaign-record-content.inline-edit prose-mirror[name="system.description"] .editor-content')
      .first();
    await editor.click();
    await gmPage.keyboard.type("The road to Phandalin is dangerous.");
    // debounce is 2s of idle; wait past it, then verify the document updated
    await expect
      .poll(async () => (await questSystem(gmPage)).description, { timeout: 10_000 })
      .toContain("The road to Phandalin is dangerous.");
    // Neither the quiet save nor the hub's document-change re-render (which is
    // deferred while typing) may destroy the editor or steal focus.
    const focusInEditor = await gmPage.evaluate(() =>
      !!document.activeElement?.closest('prose-mirror[name="system.description"]')
    );
    expect(focusInEditor).toBe(true);

    // Re-mount survival: blur the editor, then change the document so the hub
    // re-renders and re-parents the pane sheet. Re-parenting disconnects the
    // always-open editor (core saves + destroys it and it cannot reactivate);
    // RecordPane must rebuild the sheet so the editor comes back alive.
    await gmPage.evaluate(() => document.activeElement?.blur?.());
    // {render: false} keeps the page sheet from re-rendering itself, so the
    // hub's hook-driven re-render + pane re-mount is the ONLY thing that
    // touches the editor — the exact sequence that kills it without the fix.
    await gmPage.evaluate(
      ({ groupId, pageId }) =>
        game.journal
          .get(groupId)
          .pages.get(pageId)
          .update({ "system.source": "remount trigger" }, { render: false }),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const editorSel =
      '.record-pane-mount .campaign-record-content.inline-edit ' +
      'prose-mirror[name="system.description"] .editor-content[contenteditable="true"]';
    await expect
      .poll(() => gmPage.evaluate((sel) => !!document.querySelector(sel), editorSel), {
        timeout: 10_000
      })
      .toBe(true);
    // ...with the typed content intact.
    await expect(gmPage.locator(editorSel).first()).toContainText(
      "The road to Phandalin is dangerous."
    );
  });

  test("objective rows can be added and edited from the view", async () => {
    await openView(gmPage);
    const view = gmPage.locator(".record-pane-mount .campaign-record-content.inline-edit").first();
    await view.locator('[data-action="addObjective"]').click();
    await expect.poll(async () => (await questSystem(gmPage)).objectives.length).toBe(1);
    const text = gmPage
      .locator('.record-pane-mount .campaign-record-content.inline-edit input[data-row-field="text"]')
      .first();
    await text.fill("Reach the ruined tower");
    await text.dispatchEvent("change");
    await expect
      .poll(async () => (await questSystem(gmPage)).objectives[0].text)
      .toBe("Reach the ruined tower");
  });

  test("hub toggle flips the setting and icon; views become read-only", async () => {
    // open the standalone hub from the journal sidebar footer
    await gmPage.evaluate(() => ui.sidebar.changeTab("journal", "primary"));
    // DOM click: the sidebar footer button can sit outside the Playwright
    // viewport (same workaround as 05-hub.spec.mjs).
    await gmPage.locator(".campaign-record-open-hub").evaluate((el) => el.click());
    const hub = gmPage.locator("#campaign-hub");
    const toggle = hub.locator('[data-action="toggleInlineEdit"]');
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle.locator("i")).toHaveClass(/fa-pen(?!-)/);
    await toggle.click();
    await expect
      .poll(() => gmPage.evaluate(() => game.settings.get("campaign-record", "inlineEditing")))
      .toBe(false);
    await expect(hub.locator('[data-action="toggleInlineEdit"]')).toHaveAttribute("aria-pressed", "false");
    await expect(hub.locator('[data-action="toggleInlineEdit"] i')).toHaveClass(/fa-pen-slash/);
    await openViewReadOnly();
    // restore for later tests
    await gmPage.evaluate(() => game.settings.set("campaign-record", "inlineEditing", true));

    async function openViewReadOnly() {
      await gmPage.evaluate(
        async ({ groupId, pageId }) => {
          const sheet = game.journal.get(groupId).sheet;
          await sheet.render({ force: true });
          await sheet.goToPage(pageId);
        },
        { groupId: ids.groupId, pageId: ids.pageId }
      );
      await gmPage
        .locator(".record-pane-mount .campaign-record-content.record-view")
        .first()
        .waitFor({ timeout: 15_000 });
      await settle(gmPage);
      expect(
        await gmPage.locator(".record-pane-mount .campaign-record-content.inline-edit").count()
      ).toBe(0);
      expect(
        await gmPage
          .locator('.record-pane-mount .campaign-record-content.record-view input[name="system.source"]')
          .count()
      ).toBe(0);
    }
  });

  test("users without update permission get the read-only view despite the toggle", async ({
    browser
  }) => {
    const observerIds = await gmPage.evaluate(async () => {
      const entry = await JournalEntry.create({
        name: "E2E Inline Observer Group",
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
        flags: {
          "campaign-record": { group: { timepoints: [] } },
          core: { sheetClass: "campaign-record.GroupHubSheet" }
        }
      });
      const [page] = await entry.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Inline Observer Quest", type: "campaign-record.quest" }
      ]);
      return { groupId: entry.id, pageId: page.id };
    });
    const ctx = await browser.newContext();
    const playerPage = await ctx.newPage();
    await login(playerPage, "User 1");
    await playerPage.evaluate(() => game.settings.set("campaign-record", "inlineEditing", true));
    await playerPage.evaluate(
      async ({ groupId, pageId }) => {
        const sheet = game.journal.get(groupId).sheet;
        await sheet.render({ force: true });
        await sheet.goToPage(pageId);
      },
      observerIds
    );
    await playerPage
      .locator(".record-pane-mount .campaign-record-content.record-view")
      .first()
      .waitFor({ timeout: 15_000 });
    await settle(playerPage);
    expect(
      await playerPage.locator(".record-pane-mount .campaign-record-content.inline-edit").count()
    ).toBe(0);
    await ctx.close();
  });

  test("edit mode: untouched description survives a plain-field change (prose value fix)", async () => {
    await gmPage.evaluate(
      async ({ groupId, pageId }) => {
        const page = game.journal.get(groupId).pages.get(pageId);
        await page.update({ "system.description": "<p>Keep me intact.</p>" });
        await page.sheet.render(true);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
    const sheet = gmPage.locator(".campaign-record.record-sheet").last();
    const source = sheet.locator('input[name="system.source"]');
    await source.waitFor({ timeout: 15_000 });
    await source.fill("Changed in edit mode");
    await source.dispatchEvent("change");
    await expect.poll(async () => (await questSystem(gmPage)).source).toBe("Changed in edit mode");
    expect((await questSystem(gmPage)).description).toContain("Keep me intact.");
    await gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.close(),
      { groupId: ids.groupId, pageId: ids.pageId }
    );
  });
});
