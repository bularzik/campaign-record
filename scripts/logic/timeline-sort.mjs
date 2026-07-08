/** Gap between appended sort keys (Foundry SORT_INTEGER_DENSITY convention). */
export const SORT_GAP = 100000;

// Repeated midpoint inserts at the same spot halve the gap each time; float
// precision exhausts after ~50 such inserts. Accepted for hand-edited
// timelines — no rebalancing pass.
/** A sort key strictly between two neighbors; null means open-ended. */
export function sortKeyBetween(before, after) {
  if (before == null && after == null) return 0;
  if (before == null) return after - SORT_GAP;
  if (after == null) return before + SORT_GAP;
  return (before + after) / 2;
}

/** Timepoints ordered by sort key, ties broken by label. Non-mutating. */
export function sortTimepoints(timepoints) {
  return [...timepoints].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
}
