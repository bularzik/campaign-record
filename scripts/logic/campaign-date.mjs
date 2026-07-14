/**
 * Order-preserving numeric key for a campaign date's components, or null when
 * unset. month/day/hour/minute stay < 100 for every shipped calendar, so this
 * needs no calendar month-length math. Missing time sorts as midnight.
 */
export function campaignSortKey(campaignDate) {
  if (!campaignDate) return null;
  const { year, month, day, hour, minute } = campaignDate;
  return ((((year * 100) + month) * 100) + day) * 10000 + ((hour ?? 0) * 100 + (minute ?? 0));
}
