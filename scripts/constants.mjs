export const MODULE_ID = "campaign-record";
export const GROUP_FLAG = "group";
export const FOLDER_FLAG = "recordsFolder";

/** Build the namespaced JournalEntryPage sub-type id for a record kind. */
export function typeId(type) {
  return `${MODULE_ID}.${type}`;
}

/** Record kinds shipped so far; Phase 3 extends this list. */
export const RECORD_TYPES = [
  "npc",
  "place",
  "quest",
  "pc",
  "item",
  "encounter",
  "checklist",
  "shop",
  "loot",
  "media"
];

/** Structural schema version of world data written by this module. */
export const SCHEMA_VERSION = 1;
export const SCHEMA_SETTING = "schemaVersion";

/** Client setting: render timeline links as thumbnails instead of icon chips. */
export const THUMBNAILS_SETTING = "timelineThumbnails";

/** Client setting: record-pane navigation rail collapsed. */
export const RAIL_SETTING = "recordRailCollapsed";

/** Registered sheet id (scope.ClassName) that opens groups in the Campaign Hub. */
export const GROUP_SHEET_CLASS = `${MODULE_ID}.GroupHubSheet`;
