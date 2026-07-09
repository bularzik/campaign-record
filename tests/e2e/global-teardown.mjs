import { releaseLock, lockStatus } from "./helpers/env-lock.mjs";
import { pinSymlink, MAIN_CHECKOUT } from "./helpers/deploy.mjs";

/**
 * Restore the symlink for interactive use, then release the lock.
 * If a live foreign session holds the lock (it force-unlocked us and took
 * over), leave the symlink alone — never mutate the environment under its
 * run. releaseLock() already refuses to remove a live foreign lock.
 */
export default async function globalTeardown() {
  try {
    const { held, info, alive } = lockStatus();
    const foreignLiveHolder = held && info && alive && info.pid !== process.pid;
    if (!foreignLiveHolder) pinSymlink(MAIN_CHECKOUT);
  } finally {
    releaseLock();
  }
}
