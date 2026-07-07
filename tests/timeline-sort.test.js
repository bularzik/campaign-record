import { describe, it, expect } from "vitest";
import { SORT_GAP, sortKeyBetween, sortTimepoints } from "../scripts/logic/timeline-sort.mjs";

describe("sortKeyBetween", () => {
  it("returns 0 for an empty timeline", () => {
    expect(sortKeyBetween(null, null)).toBe(0);
  });

  it("appends after the last key with a full gap", () => {
    expect(sortKeyBetween(300000, null)).toBe(300000 + SORT_GAP);
  });

  it("prepends before the first key with a full gap", () => {
    expect(sortKeyBetween(null, 0)).toBe(-SORT_GAP);
  });

  it("bisects two neighbors", () => {
    expect(sortKeyBetween(0, 100000)).toBe(50000);
    expect(sortKeyBetween(50000, 100000)).toBe(75000);
  });

  it("repeated insertion between the same neighbors keeps strict ordering", () => {
    let low = 0;
    const high = SORT_GAP;
    for (let i = 0; i < 20; i++) {
      const mid = sortKeyBetween(low, high);
      expect(mid).toBeGreaterThan(low);
      expect(mid).toBeLessThan(high);
      low = mid;
    }
  });
});

describe("sortTimepoints", () => {
  it("sorts by sort key, then label, without mutating the input", () => {
    const input = [
      { id: "c", label: "Gamma", sort: 200000 },
      { id: "a", label: "Alpha", sort: 100000 },
      { id: "b", label: "Beta", sort: 100000 }
    ];
    const copy = [...input];
    const sorted = sortTimepoints(input);
    expect(sorted.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(input).toEqual(copy);
  });
});
