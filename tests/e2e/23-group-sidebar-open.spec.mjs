import { test, expect } from "@playwright/test";
import { login, createGroupWithPage, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

/** Click the entry's activation target in the Journal sidebar. */
async function activateEntry(page, groupId) {
  await page.evaluate(() => ui.sidebar.changeTab("journal", "primary"));
  const row = page.locator(`[data-entry-id="${groupId}"]`);
  await row.waitFor({ state: "attached" });
  // Campaign Records live in the module's shared "Campaign Records" folder,
  // which starts collapsed in a fresh session. Expand it so the row is
  // actually visible before we click it, like a GM would after first use.
  await row.evaluate((li) => {
    const folder = li.closest(".directory-item.folder");
    if (folder && !folder.classList.contains("expanded")) {
      folder.querySelector('[data-action="toggleFolder"]')?.click();
    }
  });
  await row.waitFor();
  // Synthetic click on the real activation target; the sidebar row can sit
  // outside the viewport, making a positional click flaky.
  await row.evaluate((li) => {
    (li.querySelector('[data-action="activateEntry"]') ?? li).click();
  });
}

/** True once a rendered GroupHubSheet is bound to this group. */
function hubOpenFor(page, groupId) {
  return page.evaluate(({ groupId }) => {
    const g = game.journal.get(groupId);
    return [...foundry.applications.instances.values()].some(
      (a) => a.rendered && a.document === g && a.constructor.name === "GroupHubSheet"
    );
  }, { groupId });
}

/** How many rendered GroupHubSheet windows are bound to this group. */
function hubCountFor(page, groupId) {
  return page.evaluate(({ groupId }) => {
    const g = game.journal.get(groupId);
    return [...foundry.applications.instances.values()].filter(
      (a) => a.rendered && a.document === g && a.constructor.name === "GroupHubSheet"
    ).length;
  }, { groupId });
}

/** Rendered non-hub sheets bound to this group (e.g. the core journal editor). */
function otherSheetsFor(page, groupId) {
  return page.evaluate(({ groupId }) => {
    const g = game.journal.get(groupId);
    return [...foundry.applications.instances.values()]
      .filter((a) => a.rendered && a.document === g && a.constructor.name !== "GroupHubSheet")
      .map((a) => a.constructor.name);
  }, { groupId });
}

test.describe("campaign record sidebar activation", () => {
  test.afterEach(async ({ page }) => {
    await deleteGroupsByPrefix(page, "E2E Sidebar");
  });

  test("activating a flagged Campaign Record opens the scoped hub", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(
      page, "E2E Sidebar Flagged", "E2E Sidebar Npc", "campaign-record.npc"
    );
    await activateEntry(page, ids.groupId);

    const sheet = page.locator(".group-hub");
    await sheet.waitFor();
    await expect(sheet.locator('select[name="group-select"]')).toHaveCount(0);
    await expect(sheet.locator(".record-row", { hasText: "E2E Sidebar Npc" })).toBeVisible();
    await expect.poll(() => hubOpenFor(page, ids.groupId)).toBe(true);
  });

  test("activating a legacy Campaign Record (no sheetClass flag) still opens the hub", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(
      page, "E2E Sidebar Legacy", "E2E Sidebar Npc2", "campaign-record.npc"
    );
    // Simulate a pre-v2 group: strip the sheetClass override so the core
    // journal sheet would otherwise win on activation.
    await page.evaluate(async ({ groupId }) => {
      await game.journal.get(groupId).update({ "flags.core.-=sheetClass": null });
    }, { groupId: ids.groupId });

    await activateEntry(page, ids.groupId);

    await expect(page.locator(".group-hub")).toBeVisible();
    await expect.poll(() => hubOpenFor(page, ids.groupId)).toBe(true);
    // Determinism (spec B3): the core journal editor must NOT also open.
    await expect.poll(() => otherSheetsFor(page, ids.groupId)).toEqual([]);
  });

  test("re-activating a legacy Campaign Record reuses one hub window", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(
      page, "E2E Sidebar Reuse", "E2E Sidebar Npc3", "campaign-record.npc"
    );
    await page.evaluate(async ({ groupId }) => {
      await game.journal.get(groupId).update({ "flags.core.-=sheetClass": null });
    }, { groupId: ids.groupId });

    await activateEntry(page, ids.groupId);
    await expect.poll(() => hubOpenFor(page, ids.groupId)).toBe(true);
    await activateEntry(page, ids.groupId);
    // The WeakMap cache must reuse the same window, not stack a second one.
    await expect.poll(() => hubCountFor(page, ids.groupId)).toBe(1);
  });
});
