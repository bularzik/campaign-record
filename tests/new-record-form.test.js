import { describe, it, expect } from "vitest";
import { buildNewRecordGroupField } from "../scripts/logic/new-record-form.mjs";

const GROUPS = [
  { id: "g1", name: "Group One" },
  { id: "g2", name: "Group Two" }
];

describe("buildNewRecordGroupField", () => {
  it("hides the picker when scoped to a concrete group", () => {
    const vm = buildNewRecordGroupField(GROUPS, "g2");
    expect(vm.showGroupPicker).toBe(false);
  });

  it("shows the picker for the 'all' sentinel", () => {
    const vm = buildNewRecordGroupField(GROUPS, "all");
    expect(vm.showGroupPicker).toBe(true);
  });

  it("shows the picker for an unknown/stale scope id", () => {
    const vm = buildNewRecordGroupField(GROUPS, "deleted-id");
    expect(vm.showGroupPicker).toBe(true);
  });

  it("lists every group and marks the scoped one selected", () => {
    const vm = buildNewRecordGroupField(GROUPS, "g2");
    expect(vm.options.map((o) => o.value)).toEqual(["g1", "g2"]);
    expect(vm.options.filter((o) => o.selected).map((o) => o.value)).toEqual(["g2"]);
  });

  it("marks nothing selected when scope is 'all'", () => {
    const vm = buildNewRecordGroupField(GROUPS, "all");
    expect(vm.options.some((o) => o.selected)).toBe(false);
  });
});
