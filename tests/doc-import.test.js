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
    "Session 5 saw the party finally reach the ruined tower",
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

import { JSDOM } from "jsdom";
import { splitSections } from "../scripts/logic/doc-import.mjs";

function body(html) {
  return new JSDOM(`<body>${html}</body>`).window.document.body;
}

describe("splitSections", () => {
  it("splits on h1-h3 and captures the doc title from a leading h1", () => {
    const { title, sections } = splitSections(body(`
      <h1>Adventure Notes</h1>
      <p>Some intro prose.</p>
      <h1>Character List**</h1>
      <p>Aracusa - Half Elf Rogue</p>
      <h3>Radiant Citadel - April 27th 2025</h3>
      <p>We arrive at the citadel.</p>`));
    expect(title).toBe("Adventure Notes");
    expect(sections.map((s) => s.title)).toEqual(
      ["Introduction", "Character List", "Radiant Citadel - April 27th 2025"]);
    expect(sections[2].date).toBe("2025-04-27");
  });

  it("splits on plain and fully-bold session-header paragraphs", () => {
    const { sections } = splitSections(body(`
      <p>Session Zero 10/6/2024</p>
      <p>We are in Natick again.</p>
      <p><strong>Arc 2 Session 3 2/23/25</strong></p>
      <p>We fight the cult.</p>
      <p><strong>Not a session</strong> but a bold lead-in to a very long paragraph of prose.</p>`));
    expect(sections.map((s) => s.title)).toEqual(
      ["Session Zero 10/6/2024", "Arc 2 Session 3 2/23/25"]);
    expect(sections[0].isSession).toBe(true);
    expect(sections[0].date).toBe("2024-10-06");
    expect(sections[1].html).toContain("cult");
    expect(sections[1].html).toContain("bold lead-in");
  });

  it("drops whitespace-only paragraphs and flags empty sections", () => {
    // h2, not h1: a leading h1 is consumed as the document title.
    const { sections } = splitSections(body(`
      <h2>Party Inventory</h2>
      <p>  </p>
      <p> </p>`));
    expect(sections).toHaveLength(1);
    expect(sections[0].empty).toBe(true);
    expect(sections[0].wordCount).toBe(0);
  });

  it("keeps tables and lists inside their section html", () => {
    const { sections } = splitSections(body(`
      <h2>Bastion</h2>
      <table><tr><td>Aracusa</td><td>Bedroom</td></tr></table>
      <ul><li>one</li><li>two</li></ul>`));
    expect(sections[0].html).toContain("<table>");
    expect(sections[0].html).toContain("<li>one</li>");
    expect(sections[0].empty).toBe(false);
  });
});
