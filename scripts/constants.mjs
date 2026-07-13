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

/** Font Awesome icon per record kind; "journal" covers core text pages. */
export const RECORD_ICONS = {
  npc: "fa-solid fa-user",
  place: "fa-solid fa-map-location-dot",
  quest: "fa-solid fa-scroll",
  pc: "fa-solid fa-shield-halved",
  item: "fa-solid fa-gem",
  encounter: "fa-solid fa-skull",
  checklist: "fa-solid fa-list-check",
  shop: "fa-solid fa-shop",
  loot: "fa-solid fa-sack-dollar",
  media: "fa-solid fa-image",
  journal: "fa-solid fa-file-lines"
};

/** Icon class for a short record type, falling back to the journal icon. */
export function recordIcon(shortType) {
  return RECORD_ICONS[shortType] ?? RECORD_ICONS.journal;
}

/** Structural schema version of world data written by this module. */
export const SCHEMA_VERSION = 3;
export const SCHEMA_SETTING = "schemaVersion";

/** Client setting: record views are editable in place with auto-save. */
export const INLINE_EDIT_SETTING = "inlineEditing";

/** Client setting: record-pane navigation rail collapsed. */
export const RAIL_SETTING = "recordRailCollapsed";

/** Client setting: expand Index rows with search-match snippets. */
export const SNIPPETS_SETTING = "hubSnippets";

/** Registered sheet id (scope.ClassName) that opens groups in the Campaign Hub. */
export const GROUP_SHEET_CLASS = `${MODULE_ID}.GroupHubSheet`;

/** World setting: id of the group that receives auto-captured records ("" = off). */
export const AUTO_TARGET_SETTING = "autoCaptureTargetGroup";

/** Socket action: relay a target-group change to the active GM. */
export const AUTO_TARGET_ACTION = "set-auto-target";

/** Combat flag: uuid of the Encounter page this combat is captured into. */
export const ENCOUNTER_FLAG = "encounterUuid";

/** Combat flag: combatants that left mid-fight, for the end summary. */
export const DEPARTED_FLAG = "departed";
