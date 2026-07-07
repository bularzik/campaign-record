import { MODULE_ID, typeId } from "../constants.mjs";
import { NpcSheet } from "./npc-sheet.mjs";

const { DocumentSheetConfig } = foundry.applications.apps;

export function registerSheets() {
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, NpcSheet, {
    types: [typeId("npc")],
    makeDefault: true,
    label: "CAMPAIGNRECORD.Sheets.Npc"
  });
}

export function registerPartials() {
  return foundry.applications.handlebars.loadTemplates({
    "campaign-record.common-edit": "modules/campaign-record/templates/partials/common-edit.hbs",
    "campaign-record.common-view": "modules/campaign-record/templates/partials/common-view.hbs"
  });
}
