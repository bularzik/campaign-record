import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureTestWorld, login, ensureModuleEnabled,
  deleteGroupsByPrefix, deleteActorsByPrefix, deleteScenesByPrefix, BASE_URL
} from "./helpers/foundry.mjs";
import { acquireLock, releaseLock } from "./helpers/env-lock.mjs";
import { pinSymlink, verifyDeployment } from "./helpers/deploy.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Exclusive-access gate for the shared Foundry install: lock, pin the module
 * symlink to this checkout, boot, verify served code, sweep E2E leftovers.
 */
export default async function globalSetup() {
  acquireLock({ worktree: REPO_ROOT });
  try {
    pinSymlink(REPO_ROOT);
    await ensureTestWorld();
    await verifyDeployment({ baseURL: BASE_URL, repoRoot: REPO_ROOT });
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await login(page, "Gamemaster");
      await ensureModuleEnabled(page);
      await deleteGroupsByPrefix(page, "E2E ");
      await deleteActorsByPrefix(page, "E2E ");
      await deleteScenesByPrefix(page, "E2E ");
      // An active scene makes every headless client render its canvas via
      // software WebGL, which starves player-side tests into timeouts.
      await page.evaluate(async () => {
        if (game.scenes.active) await game.scenes.active.update({ active: false });
      });
    } finally {
      await browser.close();
    }
  } catch (err) {
    releaseLock();
    throw err;
  }
}
