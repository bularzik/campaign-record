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

/**
 * Schema 5 assignee value: user IDs become that user's character ID (or ""
 * when the user has no character). Anything else — empty, already an actor
 * ID, unknown — passes through, so re-running is a no-op.
 */
export function migratedAssignee(assignee, userCharacters) {
  if (!assignee || !userCharacters.has(assignee)) return assignee;
  return userCharacters.get(assignee) ?? "";
}

/** Embedded-page updates rewriting user-ID assignees; empty when nothing changes. */
export function checklistAssigneeUpdates(pages, userCharacters) {
  const updates = [];
  for (const page of pages) {
    const items = page.items.map((item) => ({
      ...item,
      assignee: migratedAssignee(item.assignee, userCharacters)
    }));
    const changed = items.some((item, i) => item.assignee !== page.items[i].assignee);
    if (changed) updates.push({ _id: page.id, "system.items": items });
  }
  return updates;
}
