import { describe, it, expect } from "vitest";
import { classifyLinkTarget } from "../scripts/logic/record-links.mjs";

describe("classifyLinkTarget", () => {
  it("classifies any journal page as in-pane, carrying its uuid", () => {
    const page = {
      documentName: "JournalEntryPage",
      uuid: "JournalEntry.g1.JournalEntryPage.p1"
    };
    expect(classifyLinkTarget(page)).toEqual({
      kind: "in-pane", uuid: "JournalEntry.g1.JournalEntryPage.p1"
    });
  });

  it("pages in ordinary journals are in-pane too — parent flags are irrelevant", () => {
    const page = {
      documentName: "JournalEntryPage",
      uuid: "JournalEntry.j1.JournalEntryPage.p2",
      parent: { id: "j1", flags: {} }
    };
    expect(classifyLinkTarget(page).kind).toBe("in-pane");
  });

  it("classifies non-page documents and null as external", () => {
    expect(classifyLinkTarget({ documentName: "Actor", uuid: "Actor.a1" }).kind).toBe("external");
    expect(classifyLinkTarget(null).kind).toBe("external");
  });
});
