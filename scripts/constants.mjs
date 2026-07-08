export const MODULE_ID = "campaign-record";
export const GROUP_FLAG = "group";
export const FOLDER_FLAG = "recordsFolder";

/** Build the namespaced JournalEntryPage sub-type id for a record kind. */
export function typeId(type) {
  return `${MODULE_ID}.${type}`;
}

/** Record kinds shipped so far; Phase 3 extends this list. */
export const RECORD_TYPES = ["npc", "place", "quest"];
