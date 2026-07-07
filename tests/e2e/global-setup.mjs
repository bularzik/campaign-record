import { chromium } from "@playwright/test";
import { ensureTestWorld, login, ensureModuleEnabled, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

/** Boot the test world, enable the module, and clear leftover E2E documents. */
export default async function globalSetup() {
  await ensureTestWorld();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await login(page, "Gamemaster");
    await ensureModuleEnabled(page);
    await deleteGroupsByPrefix(page, "E2E ");
    // An active scene makes every headless client render its canvas via
    // software WebGL, which starves player-side tests into timeouts.
    await page.evaluate(async () => {
      if (game.scenes.active) await game.scenes.active.update({ active: false });
    });
  } finally {
    await browser.close();
  }
}
