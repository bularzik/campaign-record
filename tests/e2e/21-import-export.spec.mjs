import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { login, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "adventure-notes.docx");

test.describe("import and export", () => {
  let gmPage;

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    // The shared test world may carry a schema stamp from a newer branch
    // (e.g. a main-checkout session), which puts this checkout's module in
    // read-only mode and blocks all imports. Restore this checkout's version
    // (the same restore 18-migrations.spec.mjs performs) and reload so the
    // write guards lift.
    const restored = await gmPage.evaluate(async () => {
      const { SCHEMA_VERSION, SCHEMA_SETTING } =
        await import("/modules/campaign-record/scripts/constants.mjs");
      const stored = game.settings.get("campaign-record", SCHEMA_SETTING);
      if (stored <= SCHEMA_VERSION) return false;
      await game.settings.set("campaign-record", SCHEMA_SETTING, SCHEMA_VERSION);
      return true;
    });
    if (restored) {
      await gmPage.reload();
      await gmPage.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
    }
  });

  test.afterAll(async () => {
    await deleteGroupsByPrefix(gmPage, "E2E Import");
    await gmPage.close();
  });

  test("GM imports the adventure-notes docx through the wizard", async () => {
    await gmPage.evaluate(async () => {
      const { ImportWizard } = await import("/modules/campaign-record/scripts/apps/import-wizard.mjs");
      ImportWizard.open();
    });
    const wizard = gmPage.locator("#campaign-record-import");
    await wizard.waitFor({ timeout: 15_000 });

    await wizard.locator('[data-source-id="docx-file"] input[type="file"]').setInputFiles(FIXTURE);

    // Review step: the doc has ~33 session blocks plus list/table sections.
    const rows = wizard.locator("table.import-sections tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(30);

    // Session rows come pre-checked for timepoints with parsed dates.
    await expect(wizard.locator('input[name="timepoint-1"]')).toBeChecked();

    // New group with an E2E-prefixed name; retype one section to a record type.
    await wizard.locator('input[name="group-name"]').fill("E2E Import Adventure");
    await wizard.locator('select[name="type-0"]').selectOption("place");

    await wizard.locator('[data-action="createImport"]').click();
    await wizard.waitFor({ state: "detached", timeout: 60_000 });

    const summary = await gmPage.evaluate(() => {
      const group = game.journal.find((j) => j.name === "E2E Import Adventure");
      if (!group) return null;
      return {
        pages: group.pages.size,
        placePages: group.pages.filter((p) => p.type === "campaign-record.place").length,
        timepoints: (group.getFlag("campaign-record", "group")?.timepoints ?? []).length
      };
    });
    expect(summary).not.toBeNull();
    expect(summary.pages).toBeGreaterThanOrEqual(30);
    expect(summary.placePages).toBeGreaterThanOrEqual(1);
    expect(summary.timepoints).toBeGreaterThanOrEqual(25);
  });

  test("review step keeps the Create button on-screen for a many-section import", async () => {
    await gmPage.evaluate(async () => {
      const { ImportWizard } = await import("/modules/campaign-record/scripts/apps/import-wizard.mjs");
      ImportWizard.open();
    });
    const wizard = gmPage.locator("#campaign-record-import");
    await wizard.waitFor({ timeout: 15_000 });

    await wizard.locator('[data-source-id="docx-file"] input[type="file"]').setInputFiles(FIXTURE);

    // Review step: the fixture produces 30+ rows — enough to overflow the viewport.
    const rows = wizard.locator("table.import-sections tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(30);

    const viewport = gmPage.viewportSize();
    const win = await wizard.boundingBox();

    // The window must never be taller than the screen.
    expect(win.y + win.height).toBeLessThanOrEqual(viewport.height + 1);

    // The Create button must be fully visible within the window bounds.
    const createBtn = wizard.locator('[data-action="createImport"]');
    await expect(createBtn).toBeInViewport();
    const btnBox = await createBtn.boundingBox();
    expect(btnBox.y + btnBox.height).toBeLessThanOrEqual(win.y + win.height + 1);

    // The section list — not the window — must be the scroll region.
    const listScrolls = await wizard.locator(".import-sections-scroll").evaluate(
      (el) => el.scrollHeight > el.clientHeight + 1
    );
    expect(listScrolls).toBe(true);

    // Close without importing (creates no group; nothing to clean up).
    await wizard.locator('[data-action="cancel"]').click();
    await wizard.waitFor({ state: "detached", timeout: 10_000 });
  });

  test("split dialog keeps the Split button on-screen for a many-block section", async () => {
    await gmPage.evaluate(async () => {
      const { ImportWizard } = await import("/modules/campaign-record/scripts/apps/import-wizard.mjs");
      ImportWizard.open();
    });
    const wizard = gmPage.locator("#campaign-record-import");
    await wizard.waitFor({ timeout: 15_000 });
    await wizard.locator('[data-source-id="docx-file"] input[type="file"]').setInputFiles(FIXTURE);

    // Wait for the review step, then open the split dialog on the first
    // section that can be split (a section with more than one block).
    await expect(wizard.locator("table.import-sections tbody tr").first()).toBeVisible({ timeout: 30_000 });
    const splitBtn = wizard.locator('[data-action="splitSection"]:not([disabled])').first();
    await expect(splitBtn).toBeVisible({ timeout: 15_000 });
    await splitBtn.click();

    const dialog = gmPage.locator("dialog, .application.dialog").last();
    await dialog.waitFor({ timeout: 15_000 });
    const modal = dialog.locator(".cr-split-modal");
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // The block list must be a bounded scroll region (the fix); pre-fix the
    // computed overflow-y is "visible" and max-height is "none".
    const box = await modal.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { overflowY: cs.overflowY, maxHeight: cs.maxHeight };
    });
    expect(box.overflowY).toBe("auto");
    expect(box.maxHeight).not.toBe("none");

    // The dialog must fit the viewport and the Split button must be on-screen.
    const viewport = gmPage.viewportSize();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewport.height + 1);
    await expect(dialog.locator('[data-action="split"]')).toBeInViewport();

    // Close the dialog, then the wizard.
    await dialog.locator('[data-action="cancel"]').click();
    await dialog.waitFor({ state: "detached", timeout: 10_000 });
    await wizard.locator('[data-action="cancel"]').click();
    await wizard.waitFor({ state: "detached", timeout: 10_000 });
  });

  test("GM exports a group with and without GM content", async () => {
    // Build a small group: one NPC with gmNotes, one hidden NPC.
    await gmPage.evaluate(async () => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const group = await createGroup("E2E Import ExportSrc");
      await group.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Export Verity", type: "campaign-record.npc",
          system: { role: "Captain", description: "<p>A stern captain.</p>",
            gmNotes: "<p>secretly a dragon</p>" } },
        { name: "E2E Export Hidden", type: "campaign-record.npc",
          system: { hidden: true, description: "<p>shh</p>" } }
      ]);
    });

    const exportOnce = async (includeGM) => {
      await gmPage.evaluate(async () => {
        const { exportGroupDialog } = await import("/modules/campaign-record/scripts/apps/export-dialog.mjs");
        const group = game.journal.find((j) => j.name === "E2E Import ExportSrc");
        exportGroupDialog(group); // no await: the dialog blocks until submitted
      });
      const dialog = gmPage.locator('dialog, .application.dialog').last();
      await dialog.waitFor({ timeout: 10_000 });
      if (includeGM) await dialog.locator('input[name="includeGM"]').check();
      const downloadPromise = gmPage.waitForEvent("download", { timeout: 30_000 });
      await dialog.locator('button[data-action="ok"]').click();
      const download = await downloadPromise;
      const file = test.info().outputPath(`export-${includeGM ? "gm" : "player"}.docx`);
      await download.saveAs(file);
      return execFileSync("unzip", ["-p", file, "word/document.xml"], { encoding: "utf8" });
    };

    const playerXml = await exportOnce(false);
    expect(playerXml).toContain("E2E Export Verity");
    expect(playerXml).toContain("A stern captain.");
    expect(playerXml).toContain("Campaign Record type: npc");
    expect(playerXml).not.toContain("secretly a dragon");
    expect(playerXml).not.toContain("E2E Export Hidden");

    const gmXml = await exportOnce(true);
    expect(gmXml).toContain("secretly a dragon");
    expect(gmXml).toContain("E2E Export Hidden");
  });
});
