import { describe, it, expect } from "vitest";
import { pendingMigrations, isDowngrade, migratedAssignee, checklistAssigneeUpdates, needsSheetClassRewrite, LEGACY_GROUP_SHEET_CLASS } from "../scripts/logic/migrations.mjs";

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

describe("assignee migration mapping", () => {
  const users = new Map([
    ["userA", "actor1"], // user with an assigned character
    ["userB", null] // user without a character
  ]);

  it("maps a user ID to that user's character ID", () => {
    expect(migratedAssignee("userA", users)).toBe("actor1");
  });

  it("clears a user ID when the user has no character", () => {
    expect(migratedAssignee("userB", users)).toBe("");
  });

  it("leaves empty and non-user values untouched", () => {
    expect(migratedAssignee("", users)).toBe("");
    expect(migratedAssignee("actor9", users)).toBe("actor9"); // already migrated
  });

  it("builds page updates only for pages that change", () => {
    const pages = [
      {
        id: "p1",
        items: [
          { id: "i1", text: "a", done: false, assignee: "userA" },
          { id: "i2", text: "b", done: true, assignee: "" }
        ]
      },
      { id: "p2", items: [{ id: "i3", text: "c", done: false, assignee: "actor9" }] }
    ];
    const updates = checklistAssigneeUpdates(pages, users);
    expect(updates).toEqual([
      {
        _id: "p1",
        "system.items": [
          { id: "i1", text: "a", done: false, assignee: "actor1" },
          { id: "i2", text: "b", done: true, assignee: "" }
        ]
      }
    ]);
  });

  it("is idempotent: re-running the updates produces no further updates", () => {
    const pages = [
      { id: "p1", items: [{ id: "i1", text: "a", done: false, assignee: "userA" }] }
    ];
    const first = checklistAssigneeUpdates(pages, users);
    const migrated = [{ id: "p1", items: first[0]["system.items"] }];
    expect(checklistAssigneeUpdates(migrated, users)).toEqual([]);
  });
});

describe("group sheet-class rewrite (schema 6)", () => {
  it("rewrites exactly the legacy pre-v1.1.0 class", () => {
    expect(LEGACY_GROUP_SHEET_CLASS).toBe("campaign-record.CampaignGroupSheet");
    expect(needsSheetClassRewrite(LEGACY_GROUP_SHEET_CLASS)).toBe(true);
  });

  it("leaves current, foreign, and missing values untouched", () => {
    expect(needsSheetClassRewrite("campaign-record.GroupHubSheet")).toBe(false);
    expect(needsSheetClassRewrite("monks-enhanced-journal.MEJSheet")).toBe(false);
    expect(needsSheetClassRewrite(undefined)).toBe(false);
    expect(needsSheetClassRewrite("")).toBe(false);
  });
});
