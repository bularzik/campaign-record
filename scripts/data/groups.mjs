import { MODULE_ID, GROUP_FLAG, FOLDER_FLAG, GROUP_SHEET_CLASS } from "../constants.mjs";

/** Whether a JournalEntry is a Campaign Record group. */
export function isGroup(entry) {
  return !!entry?.getFlag(MODULE_ID, GROUP_FLAG);
}

/** All Campaign Record groups in this world. */
export function getGroups() {
  return game.journal.filter(isGroup);
}

/** The module's journal folder, if it exists. Does not create it. */
export function getRecordsFolder() {
  return game.folders.find(
    (f) => f.type === "JournalEntry" && f.getFlag(MODULE_ID, FOLDER_FLAG)
  );
}

/** Find or create the module's journal folder. Creation requires GM privileges. */
export async function ensureRecordsFolder() {
  let folder = getRecordsFolder();
  folder ??= await Folder.create({
    name: game.i18n.localize("CAMPAIGNRECORD.RecordsFolder"),
    type: "JournalEntry",
    flags: { [MODULE_ID]: { [FOLDER_FLAG]: true } }
  });
  return folder;
}

/**
 * Create a new campaign group: a JournalEntry flagged as a group, owned by
 * everyone (default OWNER) so all players can add and edit records.
 */
export async function createGroup(name) {
  let folderId = getRecordsFolder()?.id ?? null;
  if (!folderId && game.user.isGM) folderId = (await ensureRecordsFolder()).id;
  return JournalEntry.create({
    name,
    folder: folderId,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
    flags: {
      [MODULE_ID]: { [GROUP_FLAG]: { timepoints: [] } },
      core: { sheetClass: GROUP_SHEET_CLASS }
    }
  });
}

/**
 * Hide or reveal a record. Hiding also drops the page's default ownership to
 * NONE so core Foundry filters it from players everywhere (TOC, links, search);
 * revealing restores inheritance from the group entry.
 */
export async function setRecordHidden(page, hidden) {
  // v13.351 rejects writing the inherit marker (-1) through updates (it only
  // survives document construction), so revealing writes the group's current
  // effective default explicitly instead of restoring inheritance.
  const ownershipDefault = hidden
    ? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE
    : page.parent.ownership.default;
  return page.update({ "system.hidden": hidden, "ownership.default": ownershipDefault });
}
