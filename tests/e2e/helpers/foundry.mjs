import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const BASE_URL = process.env.FOUNDRY_URL ?? "http://localhost:30000";
export const TEST_WORLD = process.env.FOUNDRY_TEST_WORLD ?? "world-b";

const FOUNDRY_APP =
  process.env.FOUNDRY_APP ?? "/Users/danbularzik/FoundryVTT/FoundryVTT-Node-13.351";
const FOUNDRY_DATA = process.env.FOUNDRY_DATA ?? "/Users/danbularzik/FoundryVTT/Data";
const FOUNDRY_NODE = process.env.FOUNDRY_NODE ?? "/opt/homebrew/opt/node@22/bin/node";
const PID_FILE = path.join(FOUNDRY_DATA, ".pid");

async function serverStatus() {
  try {
    const res = await fetch(`${BASE_URL}/api/status`, { signal: AbortSignal.timeout(3000) });
    return await res.json();
  } catch {
    return null;
  }
}

function stopServer() {
  try {
    const port = new URL(BASE_URL).port || "30000";
    const pids = execFileSync("lsof", ["-ti", `:${port}`], { encoding: "utf8" }).trim();
    for (const pid of pids.split("\n").filter((p) => /^\d+$/.test(p))) {
      process.kill(Number(pid));
    }
  } catch {
    /* nothing listening */
  }
  if (fs.existsSync(PID_FILE)) fs.rmSync(PID_FILE);
}

function startServer(worldId) {
  const log = fs.openSync(path.join(FOUNDRY_DATA, "Logs", "stdout.log"), "a");
  const child = spawn(
    FOUNDRY_NODE,
    ["main.js", `--dataPath=${FOUNDRY_DATA}`, `--world=${worldId}`],
    { cwd: FOUNDRY_APP, detached: true, stdio: ["ignore", log, log] }
  );
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
}

/** Ensure the Foundry server is running with the test world active. */
export async function ensureTestWorld() {
  let status = await serverStatus();
  if (status?.active && status.world === TEST_WORLD) return status;
  stopServer();
  await new Promise((r) => setTimeout(r, 2000));
  startServer(TEST_WORLD);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    status = await serverStatus();
    if (status?.active && status.world === TEST_WORLD) return status;
  }
  throw new Error(`Foundry did not come up with world "${TEST_WORLD}" on ${BASE_URL}`);
}

/** Log a page in as the named user (no passwords in the test worlds). */
export async function login(page, userName) {
  await page.goto(`${BASE_URL}/join`);
  const select = page.locator('select[name="userid"]');
  await select.waitFor({ timeout: 15_000 });
  const disabled = await select
    .locator("option", { hasText: userName })
    .first()
    .isDisabled()
    .catch(() => false);
  if (disabled) {
    throw new Error(
      `User "${userName}" is already connected to the test world — close other sessions (browsers, stray test runners) and retry.`
    );
  }
  await select.selectOption({ label: userName });
  await page.locator('button[name="join"], form#join-game-form button[type="submit"]').first().click();
  await page.waitForURL("**/game", { timeout: 30_000 });
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
}

/** As a logged-in GM page: enable the module if needed (reloads on change). */
export async function ensureModuleEnabled(page) {
  const active = await page.evaluate(() => game.modules.get("campaign-record")?.active === true);
  if (active) return;
  await page.evaluate(async () => {
    const cfg = foundry.utils.deepClone(game.settings.get("core", "moduleConfiguration"));
    cfg["campaign-record"] = true;
    await game.settings.set("core", "moduleConfiguration", cfg);
  });
  await page.goto(`${BASE_URL}/game`);
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
  const nowActive = await page.evaluate(() => game.modules.get("campaign-record")?.active === true);
  if (!nowActive) throw new Error("campaign-record module could not be enabled in the test world");
}

/** Delete all campaign groups whose name starts with the prefix (GM page). */
export async function deleteGroupsByPrefix(page, prefix) {
  await page.evaluate(async (p) => {
    const doomed = game.journal.filter(
      (e) => e.getFlag("campaign-record", "group") && e.name.startsWith(p)
    );
    for (const entry of doomed) await entry.delete();
  }, prefix);
}

/**
 * Bounded settle for asserting a change did NOT happen: a no-op has no
 * observable completion signal to await, so we wait out the round-trip window.
 */
export async function settle(page, ms = 300) {
  await page.waitForTimeout(ms);
}

/** Create a group + one page of the given type via the module API; returns ids. */
export async function createGroupWithPage(page, groupName, pageName, type) {
  return page.evaluate(
    async ({ groupName, pageName, type }) => {
      const { createGroup } = await import("/modules/campaign-record/scripts/data/groups.mjs");
      const group = await createGroup(groupName);
      const [recordPage] = await group.createEmbeddedDocuments("JournalEntryPage", [
        { name: pageName, type }
      ]);
      return { groupId: group.id, pageId: recordPage.id, pageUuid: recordPage.uuid };
    },
    { groupName, pageName, type }
  );
}
