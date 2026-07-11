import { describe, it, expect } from "vitest";
import {
  createHistory, currentEntry, pushEntry, canGoBack, canGoForward,
  goBack, goForward, pruneUuid
} from "../scripts/apps/hub/pane-history.mjs";

describe("pane history", () => {
  it("starts at the index root with no back/forward", () => {
    const h = createHistory();
    expect(currentEntry(h)).toEqual({ kind: "index" });
    expect(canGoBack(h)).toBe(false);
    expect(canGoForward(h)).toBe(false);
  });

  it("push advances the cursor; back and forward walk entries", () => {
    const h = createHistory();
    pushEntry(h, { kind: "record", uuid: "a" });
    pushEntry(h, { kind: "record", uuid: "b" });
    expect(currentEntry(h)).toEqual({ kind: "record", uuid: "b" });
    expect(goBack(h)).toEqual({ kind: "record", uuid: "a" });
    expect(goBack(h)).toEqual({ kind: "index" });
    expect(goBack(h)).toBeNull();
    expect(goForward(h)).toEqual({ kind: "record", uuid: "a" });
    expect(canGoForward(h)).toBe(true);
  });

  it("pushing the current entry again is a no-op", () => {
    const h = createHistory();
    pushEntry(h, { kind: "record", uuid: "a" });
    pushEntry(h, { kind: "record", uuid: "a" });
    expect(h.entries).toHaveLength(2);
    pushEntry(h, { kind: "index" });
    pushEntry(h, { kind: "index" });
    expect(h.entries).toHaveLength(3);
  });

  it("pushing after going back truncates forward history", () => {
    const h = createHistory();
    pushEntry(h, { kind: "record", uuid: "a" });
    pushEntry(h, { kind: "record", uuid: "b" });
    goBack(h); // at a
    pushEntry(h, { kind: "record", uuid: "c" });
    expect(h.entries.map((e) => e.uuid ?? "index")).toEqual(["index", "a", "c"]);
    expect(canGoForward(h)).toBe(false);
  });

  it("supports loops without special handling", () => {
    const h = createHistory();
    for (const id of ["a", "b", "c", "a"]) pushEntry(h, { kind: "record", uuid: id });
    expect(h.entries).toHaveLength(5);
    expect(currentEntry(h)).toEqual({ kind: "record", uuid: "a" });
    expect(goBack(h)).toEqual({ kind: "record", uuid: "c" });
  });

  it("pruneUuid removes entries for a deleted page and repairs the cursor", () => {
    const h = createHistory();
    for (const id of ["a", "b", "a", "c"]) pushEntry(h, { kind: "record", uuid: id });
    // entries: index, a, b, a, c — cursor on c
    goBack(h); // cursor on second a
    pruneUuid(h, "a");
    // entries: index, b, c — cursor falls to nearest surviving earlier entry (b)
    expect(h.entries.map((e) => e.uuid ?? "index")).toEqual(["index", "b", "c"]);
    expect(currentEntry(h)).toEqual({ kind: "record", uuid: "b" });
  });

  it("pruneUuid collapses duplicates that become adjacent", () => {
    const h = createHistory();
    for (const id of ["a", "b", "a"]) pushEntry(h, { kind: "record", uuid: id });
    pruneUuid(h, "b"); // index, a, a -> index, a
    expect(h.entries.map((e) => e.uuid ?? "index")).toEqual(["index", "a"]);
    expect(currentEntry(h)).toEqual({ kind: "record", uuid: "a" });
  });
});
