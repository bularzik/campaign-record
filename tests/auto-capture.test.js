import { describe, it, expect } from "vitest";
import { resolveTargetGroup } from "../scripts/logic/auto-capture.mjs";

describe("resolveTargetGroup", () => {
  const groups = [{ id: "a" }, { id: "b" }];
  it("returns the matching group", () => {
    expect(resolveTargetGroup("b", groups)).toBe(groups[1]);
  });
  it("returns null for an empty setting", () => {
    expect(resolveTargetGroup("", groups)).toBe(null);
  });
  it("returns null for a stale id", () => {
    expect(resolveTargetGroup("gone", groups)).toBe(null);
  });
});
