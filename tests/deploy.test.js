import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  md5Hex, pinSymlink, currentSymlinkTarget, moduleLinkPath, SENTINELS
} from "./e2e/helpers/deploy.mjs";

describe("deploy helpers", () => {
  let tmp;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("md5Hex matches a known digest", () => {
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  it("moduleLinkPath nests under Data/modules", () => {
    expect(moduleLinkPath("/data/root")).toBe("/data/root/Data/modules/campaign-record");
  });

  it("pins a new symlink and reads its target back", () => {
    const link = path.join(tmp, "campaign-record");
    expect(currentSymlinkTarget(link)).toBeNull();
    pinSymlink("/checkout/a", link);
    expect(currentSymlinkTarget(link)).toBe("/checkout/a");
  });

  it("replaces an existing symlink", () => {
    const link = path.join(tmp, "campaign-record");
    pinSymlink("/checkout/a", link);
    pinSymlink("/checkout/b", link);
    expect(currentSymlinkTarget(link)).toBe("/checkout/b");
  });

  it("refuses to replace a real directory", () => {
    const link = path.join(tmp, "campaign-record");
    fs.mkdirSync(link);
    expect(() => pinSymlink("/checkout/a", link)).toThrow(/not a symlink/);
  });

  it("exposes the two sentinel files", () => {
    expect(SENTINELS).toEqual(["module.json", "scripts/apps/hub/campaign-hub.mjs"]);
  });
});
