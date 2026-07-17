/** New Record dialog group field view model, mirroring the sort-menu pattern. */

import { RECORD_TYPES, typeId } from "../constants.mjs";

/**
 * Decide whether the New Record dialog should show the group picker, and build
 * its options. The picker is hidden when the hub is scoped to a concrete group
 * (its scope id matches a group in the list); it is shown for the "all" sentinel
 * or any unknown/stale scope id.
 * @param {{id: string, name: string}[]} groups  campaign record groups
 * @param {string} current  the hub's current group scope id (`groupScopeId`)
 * @returns {{showGroupPicker: boolean, options: {value: string, label: string, selected: boolean}[]}}
 */
export function buildNewRecordGroupField(groups, current) {
  const scoped = groups.some((g) => g.id === current);
  return {
    showGroupPicker: !scoped,
    options: groups.map((g) => ({ value: g.id, label: g.name, selected: g.id === current }))
  };
}

/**
 * Option list for the New Record dialog's type select: every record kind plus
 * the core text page, alphabetized by localized label. The text page ("text",
 * shown as "Journal") is the default selection.
 * @param {(key: string) => string} localize  i18n resolver
 * @returns {{value: string, label: string, selected: boolean}[]}
 */
export function buildNewRecordTypeOptions(localize) {
  const options = RECORD_TYPES.map((t) => ({
    value: typeId(t),
    label: localize(`TYPES.JournalEntryPage.${typeId(t)}`),
    selected: false
  }));
  options.push({ value: "text", label: localize("CAMPAIGNRECORD.Hub.JournalPage"), selected: true });
  return options.sort((a, b) => a.label.localeCompare(b.label));
}
