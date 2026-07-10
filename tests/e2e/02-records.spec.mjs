import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage } from "./helpers/foundry.mjs";

test.describe("record sheets (NPC, Place)", () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(page, "E2E Records");
    await page.close();
  });

  test("NPC edit sheet renders structured fields and persists on change", async () => {
    const { pageId, groupId } = await createGroupWithPage(
      page,
      "E2E Records Group",
      "E2E NPC",
      "campaign-record.npc"
    );
    await page.evaluate(
      async ({ groupId, pageId }) => {
        const sheet = game.journal.get(groupId).pages.get(pageId).sheet;
        await sheet.render(true);
      },
      { groupId, pageId }
    );
    const sheetEl = page.locator(".campaign-record.record-sheet").last();
    const role = sheetEl.locator('[name="system.role"]');
    await role.waitFor({ timeout: 15_000 });

    // structured fields, editors, and GM-only controls all present
    await expect(sheetEl.locator('select[name="system.status"]')).toBeVisible();
    await expect(sheetEl.locator("prose-mirror")).toHaveCount(2); // description + gmNotes (GM)
    await expect(sheetEl.locator('[data-action="toggleHidden"]')).toBeVisible();
    const pmUuid = await sheetEl.locator("prose-mirror").first().getAttribute("data-document-uuid");
    expect(pmUuid).toContain(pageId);

    // submitOnChange persistence
    await role.fill("Innkeeper");
    await role.dispatchEvent("change");
    await expect
      .poll(() =>
        page.evaluate(
          ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.role,
          { groupId, pageId }
        )
      )
      .toBe("Innkeeper");
    await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.close(),
      { groupId, pageId }
    );
  });

  test("NPC view mode shows the fact list inside the journal entry sheet", async () => {
    // Inline editing (client-scoped, default on) renders these facts as
    // inputs; that branch is covered by 18-inline-edit. This assertion
    // checks the read-only view text, so switch the toggle off for this
    // client (established fix from 03-quest).
    await page.evaluate(() => game.settings.set("campaign-record", "inlineEditing", false));
    const { groupId, pageId } = await page.evaluate(async () => {
      const g = game.journal.getName("E2E Records Group");
      const p = g.pages.getName("E2E NPC");
      await g.sheet.render(true);
      await g.sheet.goToPage(p.id);
      return { groupId: g.id, pageId: p.id };
    });
    const facts = page.locator(".journal-entry-page dl.record-facts");
    await facts.waitFor({ timeout: 15_000 });
    await expect(facts).toContainText("Innkeeper");
    await page.evaluate(({ groupId }) => game.journal.get(groupId).sheet.close(), { groupId, pageId });
  });

  test("Place sheet renders its type select and persists edits", async () => {
    const { groupId, pageId } = await page.evaluate(async () => {
      const g = game.journal.getName("E2E Records Group");
      const [p] = await g.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Place", type: "campaign-record.place" }
      ]);
      await p.sheet.render(true);
      return { groupId: g.id, pageId: p.id };
    });
    const sheetEl = page.locator(".campaign-record.record-sheet").last();
    const typeSelect = sheetEl.locator('select[name="system.placeType"]');
    await typeSelect.waitFor({ timeout: 15_000 });
    await typeSelect.selectOption("town");
    await typeSelect.dispatchEvent("change");
    await expect
      .poll(() =>
        page.evaluate(
          ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.placeType,
          { groupId, pageId }
        )
      )
      .toBe("town");
    await page.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).sheet.close(),
      { groupId, pageId }
    );
  });
});
