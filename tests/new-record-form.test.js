import { describe, it, expect } from "vitest";
import { buildNewRecordGroupField, buildNewRecordTypeOptions } from "../scripts/logic/new-record-form.mjs";

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

const TYPE_LABELS = {
  "TYPES.JournalEntryPage.campaign-record.npc": "NPC",
  "TYPES.JournalEntryPage.campaign-record.place": "Place",
  "TYPES.JournalEntryPage.campaign-record.quest": "Quest",
  "TYPES.JournalEntryPage.campaign-record.pc": "PC",
  "TYPES.JournalEntryPage.campaign-record.item": "Item",
  "TYPES.JournalEntryPage.campaign-record.encounter": "Encounter",
  "TYPES.JournalEntryPage.campaign-record.checklist": "Checklist",
  "TYPES.JournalEntryPage.campaign-record.shop": "Shop",
  "TYPES.JournalEntryPage.campaign-record.loot": "Loot",
  "TYPES.JournalEntryPage.campaign-record.media": "Media",
  "CAMPAIGNRECORD.Hub.JournalPage": "Journal"
};
const localize = (k) => TYPE_LABELS[k] ?? k;

describe("buildNewRecordTypeOptions", () => {
  it("lists all record types plus the core text page, alphabetized by label", () => {
    const options = buildNewRecordTypeOptions(localize);
    expect(options.map((o) => o.label)).toEqual([
      "Checklist", "Encounter", "Item", "Journal", "Loot",
      "Media", "NPC", "PC", "Place", "Quest", "Shop"
    ]);
    expect(options.find((o) => o.label === "NPC").value).toBe("campaign-record.npc");
  });

  it("marks only the Journal (text) option selected", () => {
    const options = buildNewRecordTypeOptions(localize);
    expect(options.filter((o) => o.selected).map((o) => o.value)).toEqual(["text"]);
  });
});
