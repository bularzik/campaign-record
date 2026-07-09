import fs from "node:fs";
import path from "node:path";

const DEFAULT_DATA = process.env.FOUNDRY_DATA ?? "/Users/danbularzik/FoundryVTT/Data";
const STALE_MS = 2 * 60 * 60 * 1000;

export const UNLOCK_HINT = "Run `npm run e2e:unlock` to force-release it.";

export class LockHeldError extends Error {}

export function lockDirPath(dataDir = DEFAULT_DATA) {
  return path.join(dataDir, ".claude-e2e-lock");
}

function infoPath(dataDir) {
  return path.join(lockDirPath(dataDir), "info.json");
}

/** True when a process with this pid exists (EPERM still means "exists"). */
export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

export function lockStatus({ dataDir = DEFAULT_DATA, isAlive = isPidAlive } = {}) {
  const held = fs.existsSync(lockDirPath(dataDir));
  let info = null;
  try {
    info = JSON.parse(fs.readFileSync(infoPath(dataDir), "utf8"));
  } catch {
    /* missing or corrupt info — treated as unidentifiable holder */
  }
  return { held, info, alive: held && info ? isAlive(info.pid) : false };
}

/**
 * Acquire the environment lock (atomic mkdir).
 * Live foreign holder -> LockHeldError naming the holder + unlock hint.
 * Dead, own, or unidentifiable holder -> steal with a console note.
 */
export function acquireLock({
  dataDir = DEFAULT_DATA,
  worktree,
  pid = process.pid,
  isAlive = isPidAlive,
  now = () => Date.now(),
  sessionHint = process.env.CLAUDE_SESSION_ID ?? null
} = {}) {
  const dir = lockDirPath(dataDir);
  try {
    fs.mkdirSync(dir);
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    const { info, alive } = lockStatus({ dataDir, isAlive });
    if (info && alive && info.pid !== pid) {
      const ageMs = now() - Date.parse(info.acquiredAt);
      const ageMin = Math.round(ageMs / 60000);
      const stale = ageMs > STALE_MS
        ? ` WARNING: this lock is ${Math.round(ageMs / 3600000)}h old — the holder may be wedged.`
        : "";
      throw new LockHeldError(
        `Foundry e2e environment is locked by pid ${info.pid} ` +
        `(worktree ${info.worktree}, acquired ${ageMin} min ago).${stale} ${UNLOCK_HINT}`
      );
    }
    console.warn(`env-lock | stealing lock from ${info ? (alive ? "own" : "dead") : "unidentifiable"} holder:`, info);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir);
  }
  const info = { pid, worktree, acquiredAt: new Date(now()).toISOString(), sessionHint };
  fs.writeFileSync(infoPath(dataDir), JSON.stringify(info, null, 2));
  return info;
}

/** Remove the lock if it is ours or its holder is dead. Never removes a live foreign lock. */
export function releaseLock({ dataDir = DEFAULT_DATA, pid = process.pid, isAlive = isPidAlive } = {}) {
  const { held, info } = lockStatus({ dataDir, isAlive });
  if (!held) return false;
  if (info && info.pid !== pid && isAlive(info.pid)) return false;
  fs.rmSync(lockDirPath(dataDir), { recursive: true, force: true });
  return true;
}

/** Unconditional removal for the user-facing unlock script. Returns the prior status. */
export function forceUnlock({ dataDir = DEFAULT_DATA } = {}) {
  const status = lockStatus({ dataDir });
  fs.rmSync(lockDirPath(dataDir), { recursive: true, force: true });
  return status;
}
