import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { UNLOCK_HINT } from "./env-lock.mjs";

const DEFAULT_DATA = process.env.FOUNDRY_DATA ?? "/Users/danbularzik/FoundryVTT/Data";

export const MAIN_CHECKOUT =
  process.env.FOUNDRY_MAIN_CHECKOUT ??
  "/Users/danbularzik/Claude/Projects/campaign-record/campaign-record";

/** Files whose served bytes must match this checkout before any spec runs. */
export const SENTINELS = ["module.json", "scripts/apps/hub/campaign-hub.mjs"];

export function moduleLinkPath(dataDir = DEFAULT_DATA) {
  return process.env.FOUNDRY_MODULE_LINK ?? path.join(dataDir, "Data", "modules", "campaign-record");
}

export function md5Hex(data) {
  return crypto.createHash("md5").update(data).digest("hex");
}

export function currentSymlinkTarget(linkPath = moduleLinkPath()) {
  try {
    return fs.readlinkSync(linkPath);
  } catch {
    return null;
  }
}

/** Point the module symlink at a checkout. Refuses to clobber a non-symlink. */
export function pinSymlink(target, linkPath = moduleLinkPath()) {
  const st = fs.lstatSync(linkPath, { throwIfNoEntry: false });
  if (st && !st.isSymbolicLink()) {
    throw new Error(`${linkPath} exists and is not a symlink — refusing to replace it.`);
  }
  if (st) fs.unlinkSync(linkPath);
  fs.symlinkSync(target, linkPath);
}

/**
 * Assert the running Foundry server serves exactly this checkout's code:
 * the symlink resolves here and each sentinel's served md5 matches disk.
 */
export async function verifyDeployment({
  baseURL, repoRoot, sentinels = SENTINELS, linkPath = moduleLinkPath()
}) {
  const link = currentSymlinkTarget(linkPath);
  if (!link || path.resolve(link) !== path.resolve(repoRoot)) {
    throw new Error(
      `Deployment check failed: module symlink points at ${link}, expected ${repoRoot}. ` +
      `Another session may own the environment. ${UNLOCK_HINT}`
    );
  }
  for (const rel of sentinels) {
    const res = await fetch(`${baseURL}/modules/campaign-record/${rel}`);
    if (!res.ok) {
      throw new Error(`Deployment check failed: could not fetch ${rel} (HTTP ${res.status}).`);
    }
    const served = md5Hex(Buffer.from(await res.arrayBuffer()));
    const disk = md5Hex(fs.readFileSync(path.join(repoRoot, rel)));
    if (served !== disk) {
      throw new Error(
        `Deployment check failed: Foundry is serving different code than this checkout (${rel}). ${UNLOCK_HINT}`
      );
    }
  }
}
