import { describe, it, expect } from "vitest";
import { buildDoctypeFilter } from "../scripts/logic/doctype-filter.mjs";

const label = (t) => `L:${t}`;
const ALL = "All types";

describe("buildDoctypeFilter", () => {
  it("lists every record type plus journal, all unchecked, when nothing is selected", () => {
    const vm = buildDoctypeFilter(new Set(), label, ALL);
    expect(vm.items.some((i) => i.type === "npc")).toBe(true);
    expect(vm.items.some((i) => i.type === "journal")).toBe(true);
    expect(vm.items.every((i) => i.checked === false)).toBe(true);
    expect(vm.summary).toBe(ALL);
  });

  it("marks selected types checked and carries icon + label", () => {
    const vm = buildDoctypeFilter(new Set(["npc"]), label, ALL);
    const npc = vm.items.find((i) => i.type === "npc");
    expect(npc.checked).toBe(true);
    expect(npc.icon).toBe("fa-solid fa-user");
    expect(npc.label).toBe("L:npc");
  });

  it("summarizes a single selection as that type's label", () => {
    const vm = buildDoctypeFilter(new Set(["quest"]), label, ALL);
    expect(vm.summary).toBe("L:quest");
  });

  it("summarizes multiple selections as first label + remaining count, in list order", () => {
    // list order is npc, place, quest, ...; npc is the earliest selected here.
    const vm = buildDoctypeFilter(new Set(["quest", "npc", "place"]), label, ALL);
    expect(vm.summary).toBe("L:npc +2");
  });

  it("treats an all-selected set the same as none: the all-types label", () => {
    const all = new Set([...
      "npc place quest pc item encounter checklist shop loot media journal".split(" ")]);
    const vm = buildDoctypeFilter(all, label, ALL);
    expect(vm.summary).toBe(ALL);
  });
});
