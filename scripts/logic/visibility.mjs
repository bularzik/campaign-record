import { MODULE_ID, GROUP_FLAG } from "../constants.mjs";

/** Whether a record page should be shown to this user. GMs see everything. */
export function isRecordVisible(user, page) {
  if (user?.isGM) return true;
  return page?.system?.hidden !== true;
}

/** Only GMs may hide or reveal records. */
export function canSetHidden(user) {
  return user?.isGM === true;
}

/** Whether a plain flags object carries the campaign group flag. */
export function hasGroupFlag(flags) {
  return !!flags?.[MODULE_ID]?.[GROUP_FLAG];
}
