import { describe, it, expect } from "vitest";
import { RECORD_ICONS, recordIcon, RECORD_TYPES } from "../scripts/constants.mjs";

describe("RECORD_ICONS", () => {
  it("maps every record type plus journal to a non-empty icon class", () => {
    for (const type of RECORD_TYPES) {
      expect(typeof RECORD_ICONS[type], `missing icon for ${type}`).toBe("string");
      expect(RECORD_ICONS[type].length).toBeGreaterThan(0);
    }
    expect(typeof RECORD_ICONS.journal).toBe("string");
  });
});

describe("recordIcon", () => {
  it("returns the mapped icon for a known type", () => {
    expect(recordIcon("npc")).toBe("fa-solid fa-user");
    expect(recordIcon("quest")).toBe("fa-solid fa-scroll");
  });

  it("falls back to the journal icon for an unknown type", () => {
    expect(recordIcon("mystery")).toBe(RECORD_ICONS.journal);
  });
});
