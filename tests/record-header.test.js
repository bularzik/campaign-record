import { describe, it, expect } from "vitest";
import { buildHeaderActions, normalizeTagAdd, removeTag } from "../scripts/logic/record-header.mjs";

describe("buildHeaderActions", () => {
  it("gives editors a pick-mode image button even with no image", () => {
    expect(buildHeaderActions({ isRecord: true, canEdit: true, hasImage: false, tagCount: 0 }))
      .toEqual({ showImageButton: true, imageClickMode: "pick", showTagButton: true });
  });
  it("gives non-editors a popout-mode button only when an image exists", () => {
    expect(buildHeaderActions({ isRecord: true, canEdit: false, hasImage: true, tagCount: 0 }).imageClickMode)
      .toBe("popout");
    expect(buildHeaderActions({ isRecord: true, canEdit: false, hasImage: false, tagCount: 0 }))
      .toEqual({ showImageButton: false, imageClickMode: null, showTagButton: false });
  });
  it("shows non-editors the tag button only when tags exist", () => {
    expect(buildHeaderActions({ isRecord: true, canEdit: false, hasImage: false, tagCount: 2 }).showTagButton)
      .toBe(true);
  });
  it("renders nothing for non-record (text) pages regardless of permissions", () => {
    expect(buildHeaderActions({ isRecord: false, canEdit: true, hasImage: true, tagCount: 3 }))
      .toEqual({ showImageButton: false, imageClickMode: null, showTagButton: false });
  });
});

describe("normalizeTagAdd", () => {
  it("trims and appends a new tag", () => {
    expect(normalizeTagAdd(["ally"], "  city ")).toEqual(["ally", "city"]);
  });
  it("returns null for blank input", () => {
    expect(normalizeTagAdd(["ally"], "   ")).toBeNull();
    expect(normalizeTagAdd([], null)).toBeNull();
  });
  it("returns null for a case-insensitive duplicate, preserving existing casing", () => {
    expect(normalizeTagAdd(["Ally"], "ally")).toBeNull();
  });
});

describe("removeTag", () => {
  it("removes exactly the named tag", () => {
    expect(removeTag(["ally", "city"], "ally")).toEqual(["city"]);
  });
  it("is a no-op for an unknown tag", () => {
    expect(removeTag(["ally"], "ghost")).toEqual(["ally"]);
  });
});
