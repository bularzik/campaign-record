import { describe, it, expect } from "vitest";
import { validatePresenterPayload } from "../scripts/logic/presenter-payload.mjs";

const show = {
  action: "show",
  images: [{ src: "a.webp", caption: "A" }, { src: "b.webp" }],
  index: 1,
  presenterId: "user1",
  interval: 0,
  nonce: "n1"
};

describe("validatePresenterPayload", () => {
  it("accepts and normalizes a valid show payload", () => {
    const p = validatePresenterPayload(show);
    expect(p).toMatchObject({ action: "show", index: 1, presenterId: "user1", interval: 0, nonce: "n1" });
    expect(p.images).toEqual([{ src: "a.webp", caption: "A" }, { src: "b.webp", caption: "" }]);
  });

  it("rejects show payloads with bad images or out-of-range index", () => {
    expect(validatePresenterPayload({ ...show, images: [] })).toBeNull();
    expect(validatePresenterPayload({ ...show, images: [{ src: "" }] })).toBeNull();
    expect(validatePresenterPayload({ ...show, index: 2 })).toBeNull();
    expect(validatePresenterPayload({ ...show, index: -1 })).toBeNull();
    expect(validatePresenterPayload({ ...show, presenterId: "" })).toBeNull();
  });

  it("rejects a show payload without a nonce", () => {
    const { nonce, ...withoutNonce } = show;
    expect(validatePresenterPayload(withoutNonce)).toBeNull();
    expect(validatePresenterPayload({ ...show, nonce: "" })).toBeNull();
  });

  it("coerces invalid intervals to 0", () => {
    expect(validatePresenterPayload({ ...show, interval: -5 }).interval).toBe(0);
    expect(validatePresenterPayload({ ...show, interval: "7" }).interval).toBe(0);
    expect(validatePresenterPayload({ ...show, interval: 7 }).interval).toBe(7);
  });

  it("goto and end require a presenterId; sync-request has no payload", () => {
    expect(validatePresenterPayload({ action: "goto", index: 3, presenterId: "u1" }))
      .toEqual({ action: "goto", index: 3, presenterId: "u1" });
    expect(validatePresenterPayload({ action: "goto", index: 3 })).toBeNull();
    expect(validatePresenterPayload({ action: "goto", index: -1, presenterId: "u1" })).toBeNull();
    expect(validatePresenterPayload({ action: "end", presenterId: "u1" }))
      .toEqual({ action: "end", presenterId: "u1" });
    expect(validatePresenterPayload({ action: "end" })).toBeNull();
    expect(validatePresenterPayload({ action: "sync-request" })).toEqual({ action: "sync-request" });
    expect(validatePresenterPayload({ action: "self-destruct" })).toBeNull();
    expect(validatePresenterPayload(null)).toBeNull();
    expect(validatePresenterPayload("show")).toBeNull();
  });
});
