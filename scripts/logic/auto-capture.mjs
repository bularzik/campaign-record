/**
 * Pure auto-capture logic. No Foundry globals — unit-tested with vitest.
 */

/** The group whose id matches the setting, or null when unset/stale. */
export function resolveTargetGroup(settingId, groups) {
  if (!settingId) return null;
  return groups.find((g) => g.id === settingId) ?? null;
}
