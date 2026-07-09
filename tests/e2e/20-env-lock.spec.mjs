import { test, expect } from "@playwright/test";
import { lockStatus } from "./helpers/env-lock.mjs";

test.describe("e2e environment lock", () => {
  test("the lock is held by a live process for the duration of the run", () => {
    const { held, info, alive } = lockStatus();
    expect(held).toBe(true);
    expect(alive).toBe(true);
    expect(typeof info.pid).toBe("number");
    expect(typeof info.worktree).toBe("string");
  });
});
