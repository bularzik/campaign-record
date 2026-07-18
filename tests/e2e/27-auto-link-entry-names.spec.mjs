import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage, expectPaneTitle } from "./helpers/foundry.mjs";

// Proves the preUpdateJournalEntryPage auto-link hook end-to-end: a
// newly-typed mention of a sibling record's name becomes an @UUID content
// link on a committed (blur-flushed) save, a pre-existing mention is left
// byte-for-byte untouched by a later edit, and a same-name mention from a
// DIFFERENT campaign record (group) is never linked.
test.describe("auto-link entry names on save", () => {
  let gmPage, ids, gandalfUuid;

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    await gmPage.evaluate(() => game.settings.set("campaign-record", "inlineEditing", true));
    ids = await createGroupWithPage(gmPage, "E2E Auto Link Group", "E2E Frodo", "campaign-record.npc");
    const gandalf = await gmPage.evaluate(async ({ groupId }) => {
      const [page] = await game.journal
        .get(groupId)
        .createEmbeddedDocuments("JournalEntryPage", [{ name: "E2E Gandalf", type: "campaign-record.npc" }]);
      return { pageId: page.id, pageUuid: page.uuid };
    }, { groupId: ids.groupId });
    gandalfUuid = gandalf.pageUuid;
  });

  test.afterAll(async () => {
    await gmPage.evaluate(() => game.settings.set("campaign-record", "inlineEditing", true));
    // A single prefix covers both this suite's groups (main + the negative
    // test's second group) for the hygiene sweep.
    await deleteGroupsByPrefix(gmPage, "E2E Auto Link");
    await gmPage.close();
  });

  const frodoSystem = () =>
    gmPage.evaluate(
      ({ groupId, pageId }) => game.journal.get(groupId).pages.get(pageId).system.toObject(),
      { groupId: ids.groupId, pageId: ids.pageId }
    );

  // The group's own sheet is the GroupHubSheet: goToPage lands the record
  // in-pane, exactly as 18-inline-edit.spec.mjs and 22-group-hub-sheet.spec.mjs do.
  const openFrodo = async () => {
    await gmPage.evaluate(
      async ({ groupId, pageId }) => {
        const sheet = game.journal.get(groupId).sheet;
        await sheet.render({ force: true });
        await sheet.goToPage(pageId);
      },
      { groupId: ids.groupId, pageId: ids.pageId }
    );
  };

  const openFrodoInline = async () => {
    await openFrodo();
    await gmPage
      .locator(".group-hub .record-pane-mount .campaign-record-content.inline-edit")
      .first()
      .waitFor({ timeout: 15_000 });
  };

  const descriptionEditor = () =>
    gmPage
      .locator(
        '.group-hub .record-pane-mount .campaign-record-content.inline-edit ' +
          'prose-mirror[name="system.description"] .editor-content'
      )
      .first();

  // Collapses the caret to the end of the already-open description editor
  // before typing, so a second edit appends to (rather than clobbers) the
  // first edit's content — needed to prove the baseline mention survives.
  const typeAppended = async (text) => {
    const editor = descriptionEditor();
    // An empty ProseMirror .editor-content collapses to zero height, so
    // Playwright treats it as "not visible" and .click() times out. Focus it
    // programmatically instead, then collapse the caret to the end so a second
    // edit appends to (rather than clobbers) the first edit's content.
    await editor.evaluate((el) => {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await gmPage.keyboard.type(text);
  };

  // focusout is what the inline editor's debounced saver flushes on — the
  // committed (non-quiet) save path the auto-link hook actually reacts to.
  const blur = () => gmPage.evaluate(() => document.activeElement?.blur?.());

  test("typing a fresh entry-name mention links it on the committed save", async () => {
    await openFrodoInline();
    await typeAppended("We met E2E Gandalf today");
    await blur();

    await expect
      .poll(async () => (await frodoSystem()).description, { timeout: 10_000 })
      .toMatch(/@UUID\[[^\]]+\]\{E2E Gandalf\}/);
  });

  test("the committed link renders as a content-link and navigates in-pane on click", async () => {
    // The always-open inline editor shows the raw @UUID shorthand, not the
    // enriched anchor — switch off inline editing to see/click the rendered
    // link, mirroring 21-hub-record-pane.spec.mjs / 22-group-hub-sheet.spec.mjs.
    await gmPage.evaluate(() => game.settings.set("campaign-record", "inlineEditing", false));
    await openFrodo();
    await gmPage.locator(".group-hub .record-pane-title").waitFor({ timeout: 15_000 });
    await expectPaneTitle(gmPage.locator(".group-hub"), "E2E Frodo");

    const link = gmPage.locator(".group-hub .record-pane-mount a.content-link", { hasText: "E2E Gandalf" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("data-uuid", gandalfUuid);

    await link.click();
    await expectPaneTitle(gmPage.locator(".group-hub"), "E2E Gandalf");

    await gmPage.evaluate(() => game.settings.set("campaign-record", "inlineEditing", true));
  });

  test("a baseline mention is left untouched while a new mention in the same field gets linked", async () => {
    const before = (await frodoSystem()).description;
    const [firstLink] = before.match(/@UUID\[[^\]]+\]\{E2E Gandalf\}/);
    expect(firstLink).toBeTruthy();

    await openFrodoInline();
    await typeAppended(" Later, E2E Gandalf waved from the road.");
    await blur();

    await expect
      .poll(
        async () => {
          const description = (await frodoSystem()).description;
          return (description.match(/@UUID\[[^\]]+\]\{E2E Gandalf\}/g) ?? []).length;
        },
        { timeout: 10_000 }
      )
      .toBe(2);

    const after = (await frodoSystem()).description;
    // The original occurrence is byte-for-byte unchanged...
    expect(after).toContain(firstLink);
    // ...and the second, freshly-typed occurrence is also now linked.
    expect(after).toContain("waved from the road.");
  });

  test("a same-name mention from a different campaign record is not linked", async () => {
    await createGroupWithPage(gmPage, "E2E Auto Link Other Group", "E2E Bilbo", "campaign-record.npc");

    await openFrodoInline();
    await typeAppended(" E2E Bilbo appeared at the door.");
    await blur();

    // Poll on the plain-text arrival of the committed save (Bilbo is never a
    // link candidate here, so the raw text is the only observable signal).
    await expect
      .poll(async () => (await frodoSystem()).description, { timeout: 10_000 })
      .toContain("E2E Bilbo appeared at the door.");

    const description = (await frodoSystem()).description;
    expect(description).not.toMatch(/@UUID\[[^\]]+\]\{E2E Bilbo\}/);
  });
});
