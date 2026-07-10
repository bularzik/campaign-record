import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

test.describe("schema migrations", () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page, "Gamemaster");
  });

  test.afterAll(async () => {
    // always restore the real schema version, even on failure
    await page.evaluate(async () => {
      await game.settings.set("campaign-record", "schemaVersion", 2);
    });
    await deleteGroupsByPrefix(page, "E2E Migration");
    await page.close();
  });

  test("legacy group flags are normalized on reload", async () => {
    await page.evaluate(async () => {
      await JournalEntry.create({
        name: "E2E Migration Legacy",
        flags: { "campaign-record": { group: true } } // dev-era malformed flag
      });
      await game.settings.set("campaign-record", "schemaVersion", 0);
    });
    await page.reload();
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
    await expect
      .poll(() =>
        page.evaluate(() =>
          game.journal.getName("E2E Migration Legacy")?.getFlag("campaign-record", "group")
        )
      )
      .toEqual({ timepoints: [] });
    expect(await page.evaluate(() => game.settings.get("campaign-record", "schemaVersion"))).toBe(2);
  });

  test("a newer stored schema puts the module in read-only", async () => {
    const pageId = await page.evaluate(async () => {
      const entry = game.journal.getName("E2E Migration Legacy");
      const [p] = await entry.createEmbeddedDocuments("JournalEntryPage", [
        { name: "E2E Migration NPC", type: "campaign-record.npc" }
      ]);
      await game.settings.set("campaign-record", "schemaVersion", 999);
      return p.id;
    });
    await page.reload();
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });

    // warned...
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.querySelectorAll(".notification.warning")].filter((n) =>
            n.textContent.includes("read-only")
          ).length
        )
      )
      .toBeGreaterThan(0);

    // ...and module-page updates are blocked
    const role = await page.evaluate(async (pageId) => {
      const p = game.journal.getName("E2E Migration Legacy").pages.get(pageId);
      await p.update({ "system.role": "Should Not Persist" }).catch(() => {});
      return p.system.role;
    }, pageId);
    expect(role).toBeUndefined();

    // ...and module-page creates/deletes are blocked
    const { countBefore, countAfter } = await page.evaluate(async () => {
      const entry = game.journal.getName("E2E Migration Legacy");
      const countBefore = entry.pages.size;
      await entry
        .createEmbeddedDocuments("JournalEntryPage", [{ name: "E2E RO Create", type: "campaign-record.npc" }])
        .catch(() => {});
      const countAfter = entry.pages.size;
      return { countBefore, countAfter };
    });
    expect(countAfter).toBe(countBefore);

    // restore and confirm normal operation returns
    await page.evaluate(async () => {
      await game.settings.set("campaign-record", "schemaVersion", 2);
    });
    await page.reload();
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
    const roleAfter = await page.evaluate(async (pageId) => {
      const p = game.journal.getName("E2E Migration Legacy").pages.get(pageId);
      await p.update({ "system.role": "Writable Again" });
      return p.system.role;
    }, pageId);
    expect(roleAfter).toBe("Writable Again");
  });

  test("migration 2 stamps the group sheet flag, respecting manual overrides", async () => {
    const result = await page.evaluate(async () => {
      // Simulate two pre-migration groups: no core flags at all, and a manual override.
      const [plain] = await JournalEntry.createDocuments([{
        name: "E2E Migration Plain",
        flags: { "campaign-record": { group: { timepoints: [] } } }
      }]);
      const [manual] = await JournalEntry.createDocuments([{
        name: "E2E Migration Manual",
        flags: {
          "campaign-record": { group: { timepoints: [] } },
          core: { sheetClass: "core.JournalEntrySheet" }
        }
      }]);
      await game.settings.set("campaign-record", "schemaVersion", 1);
      const { runMigrations } = await import("/modules/campaign-record/scripts/data/migration-runner.mjs");
      await runMigrations();
      const out = {
        plain: plain.flags?.core?.sheetClass ?? null,
        manual: manual.flags?.core?.sheetClass ?? null,
        version: game.settings.get("campaign-record", "schemaVersion")
      };
      await plain.delete();
      await manual.delete();
      return out;
    });
    expect(result.plain).toBe("campaign-record.GroupHubSheet");
    expect(result.manual).toBe("core.JournalEntrySheet");
    expect(result.version).toBe(2);
  });
});
