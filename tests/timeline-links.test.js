import { describe, it, expect } from "vitest";
import {
  LINKABLE_TYPES, LINK_ICONS, isImagePath, filenameFromSrc,
  withLink, withoutLink, classifyDropData, displayLink
} from "../scripts/logic/timeline-links.mjs";

describe("isImagePath", () => {
  it("accepts common image extensions, case-insensitive", () => {
    expect(isImagePath("assets/map.png")).toBe(true);
    expect(isImagePath("assets/MAP.WEBP")).toBe(true);
    expect(isImagePath("https://example.com/a/b.jpg?x=1#frag")).toBe(true);
  });

  it("rejects non-images and junk", () => {
    expect(isImagePath("assets/theme.mp4")).toBe(false);
    expect(isImagePath("no-extension")).toBe(false);
    expect(isImagePath("")).toBe(false);
    expect(isImagePath(null)).toBe(false);
  });
});

describe("filenameFromSrc", () => {
  it("returns the decoded last path segment without query", () => {
    expect(filenameFromSrc("assets/art/old%20map.png?v=2")).toBe("old map.png");
    expect(filenameFromSrc("map.png")).toBe("map.png");
  });

  it("falls back to the raw segment on malformed percent-encoding", () => {
    expect(filenameFromSrc("assets/a%zz.png")).toBe("a%zz.png");
  });
});

describe("withLink / withoutLink", () => {
  const doc = { id: "l1", uuid: "Actor.abc", name: "Strahd", type: "Actor" };
  const img = { id: "l2", src: "assets/map.png", name: "map.png", showPlayers: false };

  it("appends to an empty/undefined list", () => {
    expect(withLink(undefined, doc)).toEqual([doc]);
    expect(withLink([doc], img)).toEqual([doc, img]);
  });

  it("returns null for a duplicate uuid or src, even with a different id", () => {
    expect(withLink([doc], { ...doc, id: "other" })).toBeNull();
    expect(withLink([img], { ...img, id: "other" })).toBeNull();
  });

  it("removes by link id and tolerates undefined", () => {
    expect(withoutLink([doc, img], "l1")).toEqual([img]);
    expect(withoutLink(undefined, "l1")).toEqual([]);
  });
});

describe("classifyDropData", () => {
  it("classifies Foundry document drag data", () => {
    for (const type of LINKABLE_TYPES) {
      expect(classifyDropData({ type, uuid: `${type}.x` }))
        .toEqual({ kind: "document", uuid: `${type}.x`, type });
    }
  });

  it("rejects unknown document types and missing uuids", () => {
    expect(classifyDropData({ type: "Macro", uuid: "Macro.x" })).toBeNull();
    expect(classifyDropData({ type: "Actor" })).toBeNull();
    expect(classifyDropData({})).toBeNull();
  });

  it("classifies image file payloads from src, path, or Tile texture", () => {
    expect(classifyDropData({ src: "a/b.png" })).toEqual({ kind: "image", src: "a/b.png" });
    expect(classifyDropData({ path: "a/b.webp" })).toEqual({ kind: "image", src: "a/b.webp" });
    expect(classifyDropData({ type: "Tile", texture: { src: "a/b.jpg" } }))
      .toEqual({ kind: "image", src: "a/b.jpg" });
  });

  it("falls back to a text/uri-list image URL", () => {
    expect(classifyDropData({}, "https://example.com/x.png\nhttps://other")).
      toEqual({ kind: "image", src: "https://example.com/x.png" });
  });

  it("rejects non-image files and empty payloads", () => {
    expect(classifyDropData({ src: "a/b.mp4" })).toBeNull();
    expect(classifyDropData({}, "")).toBeNull();
  });
});

describe("displayLink", () => {
  const docLink = { id: "l1", uuid: "Actor.abc", name: "Cached", type: "Actor" };
  const imgLink = { id: "l2", src: "assets/map.png", name: "map.png", showPlayers: false };

  it("renders a resolved, permitted document with live name and img", () => {
    const entry = displayLink(docLink, { isGM: false, doc: { permitted: true, name: "Strahd", img: "s.png" } });
    expect(entry).toEqual({
      id: "l1", name: "Strahd", icon: LINK_ICONS.Actor, kind: "document",
      uuid: "Actor.abc", img: "s.png"
    });
  });

  it("hides an unpermitted document", () => {
    expect(displayLink(docLink, { isGM: false, doc: { permitted: false, name: "Strahd", img: null } }))
      .toBeNull();
  });

  it("marks a dangling document GM-only broken, hidden from players", () => {
    const gm = displayLink(docLink, { isGM: true, doc: null });
    expect(gm.kind).toBe("broken");
    expect(gm.name).toBe("Cached");
    expect(displayLink(docLink, { isGM: false, doc: null })).toBeNull();
  });

  it("gates image links on showPlayers for players, never for GMs", () => {
    expect(displayLink(imgLink, { isGM: false })).toBeNull();
    expect(displayLink({ ...imgLink, showPlayers: true }, { isGM: false })).not.toBeNull();
    const gm = displayLink(imgLink, { isGM: true });
    expect(gm).toEqual({
      id: "l2", name: "map.png", icon: LINK_ICONS.image, kind: "image",
      src: "assets/map.png", img: "assets/map.png", showPlayers: false
    });
  });
});
