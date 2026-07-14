import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { sceneUuidFromContentLink, resolveSceneClickAction } from "../scripts/logic/scene-link.mjs";

const bodyFrom = (html) => new JSDOM(`<body>${html}</body>`).window.document.body;

describe("sceneUuidFromContentLink", () => {
  it("returns the uuid for a world scene content link", () => {
    const body = bodyFrom(`<a class="content-link" data-uuid="Scene.abc"><i></i>Keep</a>`);
    const inner = body.querySelector("i"); // click often lands on the icon
    expect(sceneUuidFromContentLink(inner)).toBe("Scene.abc");
  });

  it("returns the uuid for a compendium scene content link", () => {
    const body = bodyFrom(`<a class="content-link" data-uuid="Compendium.world.maps.Scene.xyz">Map</a>`);
    expect(sceneUuidFromContentLink(body.querySelector("a"))).toBe("Compendium.world.maps.Scene.xyz");
  });

  it("returns null for a non-scene content link", () => {
    const body = bodyFrom(`<a class="content-link" data-uuid="JournalEntry.j1.JournalEntryPage.p1">Page</a>`);
    expect(sceneUuidFromContentLink(body.querySelector("a"))).toBeNull();
  });

  it("returns null when there is no content link ancestor", () => {
    const body = bodyFrom(`<span>plain text</span>`);
    expect(sceneUuidFromContentLink(body.querySelector("span"))).toBeNull();
  });

  it("returns null for a null target", () => {
    expect(sceneUuidFromContentLink(null)).toBeNull();
  });
});

describe("resolveSceneClickAction", () => {
  it("views the scene when the user can view it", () => {
    expect(resolveSceneClickAction({ canView: true, backgroundSrc: "bg.webp", thumb: "t.webp", name: "Keep" }))
      .toEqual({ kind: "view" });
  });

  it("shows the background image when the user cannot view it", () => {
    expect(resolveSceneClickAction({ canView: false, backgroundSrc: "bg.webp", thumb: "t.webp", name: "Keep" }))
      .toEqual({ kind: "image", src: "bg.webp", title: "Keep" });
  });

  it("falls back to the thumbnail when there is no background", () => {
    expect(resolveSceneClickAction({ canView: false, backgroundSrc: "", thumb: "t.webp", name: "Keep" }))
      .toEqual({ kind: "image", src: "t.webp", title: "Keep" });
  });

  it("notifies when the user cannot view it and there is no image at all", () => {
    expect(resolveSceneClickAction({ canView: false, backgroundSrc: "", thumb: "", name: "Keep" }))
      .toEqual({ kind: "notify" });
  });

  it("treats undefined image fields as absent", () => {
    expect(resolveSceneClickAction({ canView: false, name: "Keep" })).toEqual({ kind: "notify" });
  });
});
