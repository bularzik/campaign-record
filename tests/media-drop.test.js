import { describe, it, expect } from "vitest";
import { isMediaFilename, uploadFilename, resolveDropTarget } from "../scripts/logic/media-drop.mjs";

describe("isMediaFilename", () => {
  it("accepts images and videos by extension, case-insensitively", () => {
    expect(isMediaFilename("map.png")).toBe(true);
    expect(isMediaFilename("Handout.JPG")).toBe(true);
    expect(isMediaFilename("intro.webm")).toBe(true);
    expect(isMediaFilename("cutscene.MP4")).toBe(true);
  });
  it("rejects non-media and extensionless names", () => {
    expect(isMediaFilename("notes.pdf")).toBe(false);
    expect(isMediaFilename("track.mp3")).toBe(false);
    expect(isMediaFilename("README")).toBe(false);
    expect(isMediaFilename("")).toBe(false);
  });
});

describe("uploadFilename", () => {
  it("prefixes the timestamp and keeps a clean name", () => {
    expect(uploadFilename("map.png", 1700000000000)).toBe("1700000000000-map.png");
  });
  it("sanitizes spaces and special characters to dashes", () => {
    expect(uploadFilename("my cool map (v2).png", 5)).toBe("5-my-cool-map-v2-.png");
  });
  it("never returns an empty basename", () => {
    expect(uploadFilename("---", 5)).toBe("5-media");
  });
});

describe("resolveDropTarget", () => {
  const media = { type: "campaign-record.media", uuid: "U.media" };
  const npc = { type: "campaign-record.npc", uuid: "U.npc" };

  it("an explicit timepoint row wins over everything", () => {
    expect(resolveDropTarget({ timepointId: "tp1", viewedPage: media, canModifyPage: true }))
      .toEqual({ kind: "timepoint", id: "tp1" });
  });
  it("an open modifiable media entry wins over the gallery", () => {
    expect(resolveDropTarget({ timepointId: null, viewedPage: media, canModifyPage: true }))
      .toEqual({ kind: "media-entry", uuid: "U.media" });
  });
  it("falls back to the auto-gallery for non-media pages, unmodifiable pages, and no page", () => {
    expect(resolveDropTarget({ timepointId: null, viewedPage: npc, canModifyPage: true }))
      .toEqual({ kind: "auto-gallery" });
    expect(resolveDropTarget({ timepointId: null, viewedPage: media, canModifyPage: false }))
      .toEqual({ kind: "auto-gallery" });
    expect(resolveDropTarget({ timepointId: null, viewedPage: null, canModifyPage: false }))
      .toEqual({ kind: "auto-gallery" });
  });
});
