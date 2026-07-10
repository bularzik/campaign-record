import { MODULE_ID, typeId } from "../constants.mjs";
import { CampaignGroupSheet } from "./group-sheet.mjs";
import { NpcSheet } from "./npc-sheet.mjs";
import { PlaceSheet } from "./place-sheet.mjs";
import { QuestSheet } from "./quest-sheet.mjs";
import { PcSheet } from "./pc-sheet.mjs";
import { ItemRecordSheet } from "./item-record-sheet.mjs";
import { EncounterSheet } from "./encounter-sheet.mjs";
import { ChecklistSheet } from "./checklist-sheet.mjs";
import { ShopSheet } from "./shop-sheet.mjs";
import { LootSheet } from "./loot-sheet.mjs";
import { MediaSheet } from "./media-sheet.mjs";

const { DocumentSheetConfig } = foundry.applications.apps;

export function registerSheets() {
  DocumentSheetConfig.registerSheet(JournalEntry, MODULE_ID, CampaignGroupSheet, {
    label: "CAMPAIGNRECORD.Sheets.Group"
  });
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
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, ShopSheet, {
    types: [typeId("shop")], makeDefault: true, label: "CAMPAIGNRECORD.Sheets.Shop"
  });
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, LootSheet, {
    types: [typeId("loot")], makeDefault: true, label: "CAMPAIGNRECORD.Sheets.Loot"
  });
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, MediaSheet, {
    types: [typeId("media")], makeDefault: true, label: "CAMPAIGNRECORD.Sheets.Media"
  });
}

export function registerPartials() {
  return foundry.applications.handlebars.loadTemplates({
    "campaign-record.common-edit": "modules/campaign-record/templates/partials/common-edit.hbs",
    "campaign-record.common-view": "modules/campaign-record/templates/partials/common-view.hbs",
    "campaign-record.actor-info": "modules/campaign-record/templates/partials/actor-info.hbs",
    "campaign-record.quest-objectives": "modules/campaign-record/templates/partials/quest-objectives.hbs",
    "campaign-record.encounter-combatants": "modules/campaign-record/templates/partials/encounter-combatants.hbs",
    "campaign-record.checklist-items": "modules/campaign-record/templates/partials/checklist-items.hbs",
    "campaign-record.shop-inventory": "modules/campaign-record/templates/partials/shop-inventory.hbs",
    "campaign-record.loot-items": "modules/campaign-record/templates/partials/loot-items.hbs",
    "campaign-record.media-images": "modules/campaign-record/templates/partials/media-images.hbs"
  });
}
