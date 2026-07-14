// tests/auto-link.test.js
import { describe, it, expect } from "vitest";
import { tokenizeHtml } from "../scripts/logic/auto-link.mjs";

describe("tokenizeHtml", () => {
  it("classifies text, tags, anchors, shorthand links and code; round-trips losslessly", () => {
    const html =
      '<p>Met @UUID[JournalEntry.a.JournalEntryPage.b]{Frodo} and ' +
      '<a class="content-link" data-uuid="x">Sam</a> near <code>town</code>.</p>';
    const segs = tokenizeHtml(html);
    expect(segs.map((s) => s.raw).join("")).toBe(html);
    const types = segs.map((s) => s.type);
    expect(types).toContain("text");
    expect(types).toContain("tag");
    expect(types.filter((t) => t === "link")).toHaveLength(2); // shorthand + anchor
    expect(types).toContain("code");
  });

  it("returns a single text segment for plain prose", () => {
    expect(tokenizeHtml("Just words")).toEqual([{ type: "text", raw: "Just words" }]);
  });
});
