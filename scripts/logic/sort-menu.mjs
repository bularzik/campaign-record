/** Index sort options, mirroring the doctype-filter view-model pattern. */
export const SORT_KEYS = ["name", "type", "updated"];

/**
 * Build the sort popup view model.
 * @param {string} current  active sort key
 * @param {(key: string) => string} labelOf  localized label for a sort key
 * @returns {{items: {value: string, label: string, selected: boolean}[]}}
 */
export function buildSortMenu(current, labelOf) {
  return {
    items: SORT_KEYS.map((value) => ({ value, label: labelOf(value), selected: value === current }))
  };
}
