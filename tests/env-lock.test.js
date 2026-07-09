import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquireLock, releaseLock, lockStatus, forceUnlock, lockDirPath,
  LockHeldError, UNLOCK_HINT
} from "./e2e/helpers/env-lock.mjs";

const alive = () => true;
const dead = () => false;

describe("env-lock", () => {
  let dataDir;
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "envlock-"));
  });
  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("acquires a free lock and records holder info", () => {
    const info = acquireLock({ dataDir, worktree: "/wt/a", pid: 111, isAlive: alive });
    expect(info.pid).toBe(111);
    expect(info.worktree).toBe("/wt/a");
    expect(fs.existsSync(lockDirPath(dataDir))).toBe(true);
    const status = lockStatus({ dataDir, isAlive: alive });
    expect(status).toMatchObject({ held: true, alive: true });
    expect(status.info.worktree).toBe("/wt/a");
  });

  it("rejects a live foreign holder with the unlock hint", () => {
    acquireLock({ dataDir, worktree: "/wt/a", pid: 111, isAlive: alive });
    expect(() => acquireLock({ dataDir, worktree: "/wt/b", pid: 222, isAlive: alive }))
      .toThrow(LockHeldError);
    try {
      acquireLock({ dataDir, worktree: "/wt/b", pid: 222, isAlive: alive });
    } catch (err) {
      expect(err.message).toContain("/wt/a");
      expect(err.message).toContain(UNLOCK_HINT);
    }
  });

  it("adds a staleness warning when a live lock is older than 2h", () => {
    const past = Date.parse("2026-07-09T00:00:00Z");
    acquireLock({ dataDir, worktree: "/wt/a", pid: 111, isAlive: alive, now: () => past });
    const later = () => past + 3 * 60 * 60 * 1000;
    expect(() => acquireLock({ dataDir, worktree: "/wt/b", pid: 222, isAlive: alive, now: later }))
      .toThrow(/WARNING/);
  });

  it("steals a dead holder's lock", () => {
    acquireLock({ dataDir, worktree: "/wt/a", pid: 111, isAlive: alive });
    const info = acquireLock({ dataDir, worktree: "/wt/b", pid: 222, isAlive: dead });
    expect(info.worktree).toBe("/wt/b");
    expect(lockStatus({ dataDir, isAlive: alive }).info.pid).toBe(222);
  });

  it("re-acquires its own leftover lock", () => {
    acquireLock({ dataDir, worktree: "/wt/a", pid: 111, isAlive: alive });
    const info = acquireLock({ dataDir, worktree: "/wt/a", pid: 111, isAlive: alive });
    expect(info.pid).toBe(111);
  });

  it("releases its own lock, keeps a live foreign lock, removes a dead one", () => {
    acquireLock({ dataDir, worktree: "/wt/a", pid: 111, isAlive: alive });
    expect(releaseLock({ dataDir, pid: 222, isAlive: alive })).toBe(false);
    expect(lockStatus({ dataDir, isAlive: alive }).held).toBe(true);
    expect(releaseLock({ dataDir, pid: 111, isAlive: alive })).toBe(true);
    expect(lockStatus({ dataDir, isAlive: alive }).held).toBe(false);
    acquireLock({ dataDir, worktree: "/wt/a", pid: 111, isAlive: alive });
    expect(releaseLock({ dataDir, pid: 222, isAlive: dead })).toBe(true);
  });

  it("reports unheld status and force-unlocks regardless of owner", () => {
    expect(lockStatus({ dataDir }).held).toBe(false);
    acquireLock({ dataDir, worktree: "/wt/a", pid: 111, isAlive: alive });
    const prior = forceUnlock({ dataDir });
    expect(prior.held).toBe(true);
    expect(lockStatus({ dataDir }).held).toBe(false);
    expect(forceUnlock({ dataDir }).held).toBe(false);
  });

  it("steals when the lock dir exists but info.json is missing or corrupt", () => {
    fs.mkdirSync(lockDirPath(dataDir));
    const info = acquireLock({ dataDir, worktree: "/wt/b", pid: 222, isAlive: alive });
    expect(info.pid).toBe(222);
  });
});
