import { RECORD_TYPES, recordIcon } from "../constants.mjs";

/**
 * View model for the Index doctype filter. Every type becomes a checkbox item;
 * a compact summary describes the active selection for the collapsed trigger.
 * Pure — the caller injects label resolvers so this stays testable without
 * Foundry's i18n.
 *
 * @param {Set<string>} selected  active short types
 * @param {(type: string) => string} labelOf  localized label for a short type
 * @param {string} allLabel  localized "all types" summary (no/every selection)
 * @returns {{items: object[], summary: string}}
 */
export function buildDoctypeFilter(selected, labelOf, allLabel) {
  const types = [...RECORD_TYPES, "journal"];
  const items = types.map((t) => ({
    type: t,
    label: labelOf(t),
    icon: recordIcon(t),
    checked: selected.has(t)
  }));
  const checked = items.filter((i) => i.checked);
  let summary;
  if (checked.length === 0 || checked.length === items.length) {
    summary = allLabel;
  } else if (checked.length === 1) {
    summary = checked[0].label;
  } else {
    summary = `${checked[0].label} +${checked.length - 1}`;
  }
  return { items, summary };
}
