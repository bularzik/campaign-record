import { describe, it, expect } from "vitest";
import { renderPartsForChange } from "../scripts/logic/hub-render.mjs";

describe("renderPartsForChange", () => {
  it("skips the record part when a valid record is open", () => {
    expect(renderPartsForChange({ hasView: true, viewInvalidated: false }))
      .toEqual(["header", "index", "timeline"]);
  });

  it("renders all parts when no record is open", () => {
    expect(renderPartsForChange({ hasView: false, viewInvalidated: false })).toBeNull();
  });

  it("renders all parts when the open view was invalidated (e.g. deleted)", () => {
    expect(renderPartsForChange({ hasView: true, viewInvalidated: true })).toBeNull();
  });
});
