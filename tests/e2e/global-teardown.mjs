import { releaseLock } from "./helpers/env-lock.mjs";
import { pinSymlink, MAIN_CHECKOUT } from "./helpers/deploy.mjs";

/** Restore the symlink for interactive use, then release the lock. */
export default async function globalTeardown() {
  try {
    pinSymlink(MAIN_CHECKOUT);
  } finally {
    releaseLock();
  }
}
