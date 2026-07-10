import { describe, it, expect } from "vitest";
import { classifyLinkTarget } from "../scripts/logic/record-links.mjs";

const groupFlags = { "campaign-record": { group: { timepoints: [] } } };
const pageIn = (groupId, pageId = "p1", flags = groupFlags) => ({
  documentName: "JournalEntryPage",
  id: pageId,
  parent: { id: groupId, flags }
});

describe("classifyLinkTarget", () => {
  const scope = new Set(["g1"]);

  it("classifies a page in a scoped group as in-pane", () => {
    expect(classifyLinkTarget(pageIn("g1"), scope)).toEqual({
      kind: "in-pane", groupId: "g1", pageId: "p1"
    });
  });

  it("classifies a page in another campaign group as other-group", () => {
    expect(classifyLinkTarget(pageIn("g2"), scope)).toEqual({
      kind: "other-group", groupId: "g2", pageId: "p1"
    });
  });

  it("classifies a page in a non-group journal as external", () => {
    expect(classifyLinkTarget(pageIn("g1", "p1", {}), scope).kind).toBe("external");
  });

  it("classifies non-page documents and null as external", () => {
    expect(classifyLinkTarget({ documentName: "Actor", id: "a1" }, scope).kind).toBe("external");
    expect(classifyLinkTarget(null, scope).kind).toBe("external");
  });

  it("treats every group as in scope for the all-groups hub", () => {
    const all = new Set(["g1", "g2"]);
    expect(classifyLinkTarget(pageIn("g2"), all).kind).toBe("in-pane");
  });
});
