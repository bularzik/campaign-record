import { describe, it, expect } from "vitest";
import { buildDoctypeFilter } from "../scripts/logic/doctype-filter.mjs";

const label = (t) => `L:${t}`;

describe("buildDoctypeFilter", () => {
  it("returns no chips and hasSelection=false when nothing is selected", () => {
    const vm = buildDoctypeFilter(new Set(), label);
    expect(vm.chips).toEqual([]);
    expect(vm.hasSelection).toBe(false);
    // Every type is available to add.
    expect(vm.available.some((a) => a.type === "npc")).toBe(true);
    expect(vm.available.some((a) => a.type === "journal")).toBe(true);
  });

  it("emits a chip per selected type with icon + label, and omits it from available", () => {
    const vm = buildDoctypeFilter(new Set(["npc", "quest"]), label);
    expect(vm.chips.map((c) => c.type)).toEqual(["npc", "quest"]);
    expect(vm.hasSelection).toBe(true);
    const npc = vm.chips.find((c) => c.type === "npc");
    expect(npc.icon).toBe("fa-solid fa-user");
    expect(npc.label).toBe("L:npc");
    expect(vm.available.some((a) => a.type === "npc")).toBe(false);
  });
});
