import { describe, it, expect } from "vitest";
import { campaignSortKey } from "../scripts/logic/campaign-date.mjs";

describe("campaignSortKey", () => {
  it("returns null when the campaign date is unset", () => {
    expect(campaignSortKey(null)).toBe(null);
    expect(campaignSortKey(undefined)).toBe(null);
  });

  it("orders by year, then month, then day, then time", () => {
    const k = (d) => campaignSortKey(d);
    const base = { year: 1492, month: 6, day: 15, hour: null, minute: null };
    expect(k({ ...base, year: 1491 })).toBeLessThan(k(base));
    expect(k({ ...base, month: 5 })).toBeLessThan(k(base));
    expect(k({ ...base, day: 14 })).toBeLessThan(k(base));
    expect(k({ ...base, hour: 9, minute: 0 })).toBeGreaterThan(k(base));
    expect(k({ ...base, hour: 9, minute: 5 })).toBeGreaterThan(k({ ...base, hour: 9, minute: 0 }));
  });

  it("treats missing time as midnight for ordering", () => {
    const noTime = { year: 1492, month: 6, day: 15, hour: null, minute: null };
    const midnight = { year: 1492, month: 6, day: 15, hour: 0, minute: 0 };
    expect(campaignSortKey(noTime)).toBe(campaignSortKey(midnight));
  });

  it("handles negative (pre-epoch) years monotonically", () => {
    const a = { year: -5, month: 0, day: 1, hour: null, minute: null };
    const b = { year: -4, month: 0, day: 1, hour: null, minute: null };
    expect(campaignSortKey(a)).toBeLessThan(campaignSortKey(b));
  });
});
