import { describe, it, expect } from "vitest";
import { pendingMigrations, isDowngrade } from "../scripts/logic/migrations.mjs";

const reg = [
  { version: 2, run: () => {} },
  { version: 1, run: () => {} },
  { version: 3, run: () => {} }
];

describe("migration planning", () => {
  it("returns applicable migrations in ascending order", () => {
    expect(pendingMigrations(reg, 0, 3).map((m) => m.version)).toEqual([1, 2, 3]);
    expect(pendingMigrations(reg, 1, 3).map((m) => m.version)).toEqual([2, 3]);
    expect(pendingMigrations(reg, 1, 2).map((m) => m.version)).toEqual([2]);
  });

  it("returns nothing when current or downgraded", () => {
    expect(pendingMigrations(reg, 3, 3)).toEqual([]);
    expect(pendingMigrations(reg, 5, 3)).toEqual([]);
  });

  it("detects downgrades", () => {
    expect(isDowngrade(2, 1)).toBe(true);
    expect(isDowngrade(1, 1)).toBe(false);
    expect(isDowngrade(0, 1)).toBe(false);
  });
});
