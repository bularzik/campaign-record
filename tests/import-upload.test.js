import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JSDOM } from "jsdom";

const PNG_URI = `data:image/png;base64,${btoa("fakepng")}`;
const group = { id: "g1" };

// Mock with an inline class definition
vi.mock("../scripts/apps/hub/media-upload.mjs", () => {
  return {
    NoActiveGMError: class NoActiveGMError extends Error {},
    uploadHubMediaAsUser: vi.fn(),
    uploadHubMedia: vi.fn()
  };
});

import { uploadInlineImages } from "../scripts/apps/import-upload.mjs";
import { uploadHubMediaAsUser, NoActiveGMError } from "../scripts/apps/hub/media-upload.mjs";

beforeEach(() => {
  const dom = new JSDOM("");
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.game = { i18n: { format: (k) => k, localize: (k) => k } };
});
afterEach(() => {
  delete globalThis.DOMParser;
  delete globalThis.game;
  vi.clearAllMocks();
});

describe("uploadInlineImages", () => {
  it("rewrites srcs to the stored path and collects refs", async () => {
    uploadHubMediaAsUser.mockResolvedValue("campaign-record-media/g1/1-i.png");
    const html = `<p><img src="${PNG_URI}" alt="A map"></p>`;
    const warnings = [];
    const out = await uploadInlineImages(html, group, warnings, new Map());
    expect(out.html).toContain('src="campaign-record-media/g1/1-i.png"');
    expect(out.images).toEqual([{ src: "campaign-record-media/g1/1-i.png", caption: "A map" }]);
    expect(warnings).toEqual([]);
  });
  it("uploads identical data-URIs once", async () => {
    uploadHubMediaAsUser.mockResolvedValue("campaign-record-media/g1/1-i.png");
    const html = `<img src="${PNG_URI}"><img src="${PNG_URI}">`;
    await uploadInlineImages(html, group, [], new Map());
    expect(uploadHubMediaAsUser).toHaveBeenCalledTimes(1);
  });
  it("pushes ImagesNeedGM once when no GM can relay", async () => {
    uploadHubMediaAsUser.mockRejectedValue(new NoActiveGMError("no gm"));
    const html = `<img src="${PNG_URI}"><img src="data:image/png;base64,${btoa("other")}">`;
    const warnings = [];
    const out = await uploadInlineImages(html, group, warnings, new Map());
    expect(out.html).not.toContain("<img");
    expect(warnings).toEqual(["CAMPAIGNRECORD.Import.ImagesNeedGM"]);
  });
  it("pushes ImagesDropped for other upload failures", async () => {
    uploadHubMediaAsUser.mockRejectedValue(new Error("boom"));
    const warnings = [];
    await uploadInlineImages(`<img src="${PNG_URI}">`, group, warnings, new Map());
    expect(warnings).toEqual(["CAMPAIGNRECORD.Import.ImagesDropped"]);
  });
});
