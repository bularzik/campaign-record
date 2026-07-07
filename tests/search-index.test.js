import { describe, it, expect, beforeEach } from "vitest";
import {
  createIndex, indexRecord, removeRecord, search, stripHtml, tokenize
} from "../scripts/logic/search-index.mjs";

const npc = {
  uuid: "u1", name: "Strahd von Zarovich", type: "campaign-record.npc",
  tags: ["vampire", "villain"],
  fields: { role: "Dark lord of Barovia", description: "<p>Rules from Castle Ravenloft.</p>" },
  gmFields: { gmNotes: "<p>Secretly seeks Ireena.</p>" }
};
const place = {
  uuid: "u2", name: "Vallaki", type: "campaign-record.place",
  tags: [], fields: { description: "A town under the Baron's iron fist." }, gmFields: {}
};

let index;
beforeEach(() => {
  index = createIndex();
  indexRecord(index, npc);
  indexRecord(index, place);
});

describe("tokenize / stripHtml", () => {
  it("strips tags and lowercases tokens of length >= 2", () => {
    expect(stripHtml("<p>Hello <b>World</b></p>")).toContain("Hello");
    expect(tokenize("<p>Hello, World! A</p>")).toEqual(["hello", "world"]);
  });
});

describe("search", () => {
  it("matches by prefix across name and fields", () => {
    const hits = search(index, "strah", { gm: false });
    expect(hits).toHaveLength(1);
    expect(hits[0].uuid).toBe("u1");
    expect(hits[0].matches.some((m) => m.field === "name")).toBe(true);
  });

  it("matches tags", () => {
    expect(search(index, "vampire", { gm: false })[0].uuid).toBe("u1");
  });

  it("ANDs multiple terms", () => {
    expect(search(index, "castle ravenloft", { gm: false })).toHaveLength(1);
    expect(search(index, "castle vallaki", { gm: false })).toHaveLength(0);
  });

  it("GM-only fields hit for GMs and are invisible to players", () => {
    expect(search(index, "ireena", { gm: true })).toHaveLength(1);
    expect(search(index, "ireena", { gm: false })).toHaveLength(0);
  });

  it("returns a snippet containing the matched term", () => {
    const [hit] = search(index, "baron", { gm: false });
    expect(hit.uuid).toBe("u2");
    const snippet = hit.matches.find((m) => m.field === "description").snippet;
    expect(snippet.toLowerCase()).toContain("baron");
  });

  it("re-indexing a record replaces its old tokens", () => {
    indexRecord(index, { ...place, fields: { description: "A quiet hamlet." } });
    expect(search(index, "baron", { gm: false })).toHaveLength(0);
    expect(search(index, "hamlet", { gm: false })).toHaveLength(1);
  });

  it("removeRecord drops the record from results", () => {
    removeRecord(index, "u1");
    expect(search(index, "strahd", { gm: true })).toHaveLength(0);
  });

  it("empty or too-short queries return no results", () => {
    expect(search(index, "", { gm: true })).toEqual([]);
    expect(search(index, "a", { gm: true })).toEqual([]);
  });
});
