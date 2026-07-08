/** Pure planning for the schema-version migration runner. */

/** Applicable migrations, ascending; empty when up to date or downgraded. */
export function pendingMigrations(registry, stored, current) {
  if (stored >= current) return [];
  return registry
    .filter((m) => m.version > stored && m.version <= current)
    .sort((a, b) => a.version - b.version);
}

/** The world was last saved by a NEWER module version than the one installed. */
export function isDowngrade(stored, current) {
  return stored > current;
}
