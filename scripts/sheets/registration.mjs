import { MODULE_ID, typeId } from "../constants.mjs";
import { NpcSheet } from "./npc-sheet.mjs";
import { PlaceSheet } from "./place-sheet.mjs";
import { QuestSheet } from "./quest-sheet.mjs";

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
}

export function registerPartials() {
  return foundry.applications.handlebars.loadTemplates({
    "campaign-record.common-edit": "modules/campaign-record/templates/partials/common-edit.hbs",
    "campaign-record.common-view": "modules/campaign-record/templates/partials/common-view.hbs"
  });
}
