import { defineConfig } from "@playwright/test";

/**
 * E2E tests run against a local Foundry VTT v13 server with the dedicated
 * test world (world-b) active. Global setup starts/switches the server as
 * needed. See tests/e2e/README.md for environment details and overrides.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.mjs",
  globalTeardown: "./tests/e2e/global-teardown.mjs",
  use: {
    baseURL: process.env.FOUNDRY_URL ?? "http://localhost:30000",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure"
  }
});
