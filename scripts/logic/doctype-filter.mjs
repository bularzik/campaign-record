import { RECORD_TYPES, recordIcon } from "../constants.mjs";

/**
 * View model for the Index doctype filter. Selected types become removable
 * chips; the rest are offered in the "add" dropdown. Pure — the caller passes
 * a label resolver so this stays testable without Foundry's i18n.
 *
 * @param {Set<string>} selected  active short types
 * @param {(type: string) => string} labelOf  localized label for a short type
 * @returns {{chips: object[], available: object[], hasSelection: boolean}}
 */
export function buildDoctypeFilter(selected, labelOf) {
  const types = [...RECORD_TYPES, "journal"];
  const chips = types
    .filter((t) => selected.has(t))
    .map((t) => ({ type: t, label: labelOf(t), icon: recordIcon(t) }));
  const available = types
    .filter((t) => !selected.has(t))
    .map((t) => ({ type: t, label: labelOf(t), icon: recordIcon(t) }));
  return { chips, available, hasSelection: chips.length > 0 };
}
