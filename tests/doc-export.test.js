import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { replaceUuidTags, htmlToNodes } from "../scripts/logic/doc-export.mjs";

function body(html) {
  return new JSDOM(`<body>${html}</body>`).window.document.body;
}

describe("replaceUuidTags", () => {
  it("renders labeled and label-less enrichers as bold text", () => {
    expect(replaceUuidTags("<p>See @UUID[JournalEntry.a.JournalEntryPage.b]{The Duke}.</p>"))
      .toBe("<p>See <strong>The Duke</strong>.</p>");
    expect(replaceUuidTags("<p>@UUID[Actor.abc]</p>")).toBe("<p><strong>abc</strong></p>");
  });
});

describe("htmlToNodes", () => {
  it("converts paragraphs with inline formatting and links", () => {
    const nodes = htmlToNodes(body(
      `<p>Meet <strong>Verity</strong>, an <em>elf</em> — <a href="https://5e.tools">rules</a></p>`));
    expect(nodes).toEqual([{
      kind: "paragraph",
      runs: [
        { text: "Meet " },
        { text: "Verity", bold: true },
        { text: ", an " },
        { text: "elf", italics: true },
        { text: " — " },
        { text: "rules", link: "https://5e.tools" }
      ]
    }]);
  });

  it("converts headings, nested lists, tables, and images", () => {
    const nodes = htmlToNodes(body(`
      <h2>Bastion</h2>
      <ul><li>outer<ul><li>inner</li></ul></li></ul>
      <ol><li>first</li></ol>
      <table><tr><td>Aracusa</td><td><strong>Bedroom</strong></td></tr></table>
      <img src="assets/map.png" alt="Old Map">`));
    expect(nodes[0]).toEqual({ kind: "heading", level: 2, text: "Bastion" });
    expect(nodes[1]).toEqual({
      kind: "list", ordered: false,
      items: [{ runs: [{ text: "outer" }], level: 0 }, { runs: [{ text: "inner" }], level: 1 }]
    });
    expect(nodes[2]).toEqual({ kind: "list", ordered: true, items: [{ runs: [{ text: "first" }], level: 0 }] });
    expect(nodes[3]).toEqual({
      kind: "table",
      rows: [[[{ text: "Aracusa" }], [{ text: "Bedroom", bold: true }]]]
    });
    expect(nodes[4]).toEqual({ kind: "image", src: "assets/map.png", caption: "Old Map" });
  });

  it("skips empty paragraphs and unwraps blockquotes/divs", () => {
    const nodes = htmlToNodes(body(`<p>  </p><blockquote><p>quoted</p></blockquote>`));
    expect(nodes).toEqual([{ kind: "paragraph", runs: [{ text: "quoted", italics: true }] }]);
  });
});
