import { MODULE_ID, typeId } from "../constants.mjs";
import { NpcSheet } from "./npc-sheet.mjs";
import { PlaceSheet } from "./place-sheet.mjs";
import { QuestSheet } from "./quest-sheet.mjs";
import { PcSheet } from "./pc-sheet.mjs";
import { ItemRecordSheet } from "./item-record-sheet.mjs";
import { EncounterSheet } from "./encounter-sheet.mjs";
import { ChecklistSheet } from "./checklist-sheet.mjs";

const { DocumentSheetConfig } = foundry.applications.apps;

export function registerSheets() {
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, NpcSheet, {
    types: [typeId("npc")],
    makeDefault: true,
    label: "CAMPAIGNRECORD.Sheets.Npc"
  });
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, PlaceSheet, {
    types: [typeId("place")],
    makeDefault: true,
    label: "CAMPAIGNRECORD.Sheets.Place"
  });
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, QuestSheet, {
    types: [typeId("quest")],
    makeDefault: true,
    label: "CAMPAIGNRECORD.Sheets.Quest"
  });
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, PcSheet, {
    types: [typeId("pc")], makeDefault: true, label: "CAMPAIGNRECORD.Sheets.Pc"
  });
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, ItemRecordSheet, {
    types: [typeId("item")], makeDefault: true, label: "CAMPAIGNRECORD.Sheets.Item"
  });
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, EncounterSheet, {
    types: [typeId("encounter")], makeDefault: true, label: "CAMPAIGNRECORD.Sheets.Encounter"
  });
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, ChecklistSheet, {
    types: [typeId("checklist")], makeDefault: true, label: "CAMPAIGNRECORD.Sheets.Checklist"
  });
}

export function registerPartials() {
  return foundry.applications.handlebars.loadTemplates({
    "campaign-record.common-edit": "modules/campaign-record/templates/partials/common-edit.hbs",
    "campaign-record.common-view": "modules/campaign-record/templates/partials/common-view.hbs"
  });
}
