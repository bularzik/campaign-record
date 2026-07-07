import { describe, it, expect } from "vitest";
import { MODULE_ID, GROUP_FLAG, typeId } from "../scripts/constants.mjs";
import { isRecordVisible, canSetHidden, hasGroupFlag } from "../scripts/logic/visibility.mjs";

describe("constants", () => {
  it("exposes the module id", () => {
    expect(MODULE_ID).toBe("campaign-record");
    expect(GROUP_FLAG).toBe("group");
  });

  it("builds namespaced type ids", () => {
    expect(typeId("npc")).toBe("campaign-record.npc");
  });
});

describe("isRecordVisible", () => {
  const gm = { isGM: true };
  const player = { isGM: false };

  it("GMs see everything", () => {
    expect(isRecordVisible(gm, { system: { hidden: true } })).toBe(true);
  });

  it("players see non-hidden records", () => {
    expect(isRecordVisible(player, { system: { hidden: false } })).toBe(true);
  });

  it("players do not see hidden records", () => {
    expect(isRecordVisible(player, { system: { hidden: true } })).toBe(false);
  });

  it("pages without system data (core text pages) are visible", () => {
    expect(isRecordVisible(player, { system: {} })).toBe(true);
    expect(isRecordVisible(player, {})).toBe(true);
  });
});

describe("canSetHidden", () => {
  it("only GMs may set hidden", () => {
    expect(canSetHidden({ isGM: true })).toBe(true);
    expect(canSetHidden({ isGM: false })).toBe(false);
    expect(canSetHidden(undefined)).toBe(false);
  });
});

describe("hasGroupFlag", () => {
  it("detects the group flag on a flags object", () => {
    expect(hasGroupFlag({ "campaign-record": { group: { timepoints: [] } } })).toBe(true);
    expect(hasGroupFlag({ "campaign-record": {} })).toBe(false);
    expect(hasGroupFlag({})).toBe(false);
    expect(hasGroupFlag(undefined)).toBe(false);
  });
});
