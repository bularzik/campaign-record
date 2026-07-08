import { describe, it, expect } from "vitest";
import { validatePresenterPayload } from "../scripts/logic/presenter-payload.mjs";

const show = {
  action: "show",
  images: [{ src: "a.webp", caption: "A" }, { src: "b.webp" }],
  index: 1,
  presenterId: "user1",
  interval: 0
};

describe("validatePresenterPayload", () => {
  it("accepts and normalizes a valid show payload", () => {
    const p = validatePresenterPayload(show);
    expect(p).toMatchObject({ action: "show", index: 1, presenterId: "user1", interval: 0 });
    expect(p.images).toEqual([{ src: "a.webp", caption: "A" }, { src: "b.webp", caption: "" }]);
  });

  it("rejects show payloads with bad images or out-of-range index", () => {
    expect(validatePresenterPayload({ ...show, images: [] })).toBeNull();
    expect(validatePresenterPayload({ ...show, images: [{ src: "" }] })).toBeNull();
    expect(validatePresenterPayload({ ...show, index: 2 })).toBeNull();
    expect(validatePresenterPayload({ ...show, index: -1 })).toBeNull();
    expect(validatePresenterPayload({ ...show, presenterId: "" })).toBeNull();
  });

  it("coerces invalid intervals to 0", () => {
    expect(validatePresenterPayload({ ...show, interval: -5 }).interval).toBe(0);
    expect(validatePresenterPayload({ ...show, interval: "7" }).interval).toBe(0);
    expect(validatePresenterPayload({ ...show, interval: 7 }).interval).toBe(7);
  });

  it("validates goto and end; unknown actions and junk are null", () => {
    expect(validatePresenterPayload({ action: "goto", index: 3 })).toEqual({ action: "goto", index: 3 });
    expect(validatePresenterPayload({ action: "goto", index: -1 })).toBeNull();
    expect(validatePresenterPayload({ action: "end" })).toEqual({ action: "end" });
    expect(validatePresenterPayload({ action: "self-destruct" })).toBeNull();
    expect(validatePresenterPayload(null)).toBeNull();
    expect(validatePresenterPayload("show")).toBeNull();
  });
});
