import { describe, it, expect } from "vitest";
import { cleanTitle, detectSessionHeader, parseSectionDate } from "../scripts/logic/doc-import.mjs";

describe("cleanTitle", () => {
  it("strips stray bold markers and trailing colons", () => {
    expect(cleanTitle("Character List**")).toBe("Character List");
    expect(cleanTitle("**Arc 5, Session 1**")).toBe("Arc 5, Session 1");
    expect(cleanTitle("  Loot:  ")).toBe("Loot");
  });
});

describe("detectSessionHeader", () => {
  it.each([
    "Session Zero 10/6/2024",
    "Arc 1 Session 1 10/26/24",
    "Arc 2 Session 3 2/23/25",
    "Arc 5, Session 1",
    "Arc 3 Session 2 5/18/25  part 1",
    "IN PERSON SESSION 1 11/14/25",
    "Out of Arc - 3/2/23  - Sidequest",
    "Arc 6  Session 6  6/14/26"
  ])("accepts %s", (line) => {
    expect(detectSessionHeader(line)).toBe(true);
  });

  it.each([
    "We talked about the session yesterday",
    "The session ended when Arc told us to stop by the tavern for a long rest",
    "Loot:",
    ""
  ])("rejects %s", (line) => {
    expect(detectSessionHeader(line)).toBe(false);
  });
});

describe("parseSectionDate", () => {
  it("parses numeric dates with 2- and 4-digit years", () => {
    expect(parseSectionDate("Session Zero 10/6/2024")).toBe("2024-10-06");
    expect(parseSectionDate("Arc 2 Session 3 2/23/25")).toBe("2025-02-23");
  });

  it("parses spelled-out month dates", () => {
    expect(parseSectionDate("Radiant Citadel - April 27th 2025")).toBe("2025-04-27");
  });

  it("returns null for missing or invalid dates", () => {
    expect(parseSectionDate("Arc 5, Session 1")).toBeNull();
    expect(parseSectionDate("Arc 3 Session 1 3/3025")).toBeNull(); // typo: not M/D/Y
    expect(parseSectionDate("Session 4 9/31/25")).toBeNull(); // Sept 31 doesn't exist
  });
});
