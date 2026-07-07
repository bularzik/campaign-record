import { typeId } from "../constants.mjs";
import { NpcModel } from "./npc.mjs";
import { PlaceModel } from "./place.mjs";
import { QuestModel } from "./quest.mjs";

export function registerDataModels() {
  Object.assign(CONFIG.JournalEntryPage.dataModels, {
    [typeId("npc")]: NpcModel,
    [typeId("place")]: PlaceModel,
    [typeId("quest")]: QuestModel
  });
}
