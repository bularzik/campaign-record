// tests/auto-link.test.js
import { describe, it, expect } from "vitest";
import { tokenizeHtml, extractWords, diffAddedWordFlags } from "../scripts/logic/auto-link.mjs";

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

describe("extractWords", () => {
  it("lists words from text segments only, with segment offsets, skipping links/tags", () => {
    const segs = tokenizeHtml("<p>Met @UUID[x]{Frodo} today</p>");
    const words = extractWords(segs);
    expect(words.map((w) => w.text)).toEqual(["Met", "today"]);
    const met = words[0];
    expect(segs[met.segIndex].raw.slice(met.start, met.end)).toBe("Met");
  });

  it("treats apostrophes and hyphens as intra-word", () => {
    expect(extractWords(tokenizeHtml("Al'Akbar half-elf")).map((w) => w.text))
      .toEqual(["Al'Akbar", "half-elf"]);
  });
});

describe("diffAddedWordFlags", () => {
  it("flags only inserted words", () => {
    const base = ["we", "met", "gandalf"];
    const next = ["we", "met", "gandalf", "then", "frodo", "joined"];
    expect(diffAddedWordFlags(base, next)).toEqual([false, false, false, true, true, true]);
  });

  it("flags a new occurrence of a word already present elsewhere", () => {
    const base = ["we", "met", "gandalf"];
    const next = ["we", "met", "gandalf", "gandalf", "grinned"];
    // LCS keeps the first three; the 4th 'gandalf' and 'grinned' are added.
    expect(diffAddedWordFlags(base, next)).toEqual([false, false, false, true, true]);
  });

  it("is case-insensitive when aligning", () => {
    expect(diffAddedWordFlags(["Gandalf"], ["gandalf", "smiled"]))
      .toEqual([false, true]);
  });

  it("flags everything when baseline is empty", () => {
    expect(diffAddedWordFlags([], ["a", "b"])).toEqual([true, true]);
  });
});
