/** New Record dialog group field view model, mirroring the sort-menu pattern. */

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
