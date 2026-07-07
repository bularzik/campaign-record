import { defineConfig } from "vitest/config";

/** Unit tests only — tests/e2e/ belongs to Playwright (npm run test:e2e). */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    exclude: ["tests/e2e/**", "node_modules/**"]
  }
});
