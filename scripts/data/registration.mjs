import { typeId } from "../constants.mjs";
import { NpcModel } from "./npc.mjs";
import { PlaceModel } from "./place.mjs";
import { QuestModel } from "./quest.mjs";
import { PcModel } from "./pc.mjs";
import { ItemRecordModel } from "./item.mjs";
import { EncounterModel } from "./encounter.mjs";
import { ChecklistModel } from "./checklist.mjs";
import { ShopModel } from "./shop.mjs";

export function registerDataModels() {
  Object.assign(CONFIG.JournalEntryPage.dataModels, {
    [typeId("npc")]: NpcModel,
    [typeId("place")]: PlaceModel,
    [typeId("quest")]: QuestModel,
    [typeId("pc")]: PcModel,
    [typeId("item")]: ItemRecordModel,
    [typeId("encounter")]: EncounterModel,
    [typeId("checklist")]: ChecklistModel,
    [typeId("shop")]: ShopModel
  });
}
