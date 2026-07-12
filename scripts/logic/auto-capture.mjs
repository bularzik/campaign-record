/**
 * Pure auto-capture logic. No Foundry globals — unit-tested with vitest.
 */

/** The group whose id matches the setting, or null when unset/stale. */
export function resolveTargetGroup(settingId, groups) {
  if (!settingId) return null;
  return groups.find((g) => g.id === settingId) ?? null;
}

/** Key a combatant row by its actor uuid, or by name when it has no actor. */
function participantKey(actorUuid, name) {
  return actorUuid ?? `name:${name}`;
}

/** Collapse raw combatant entries into counted rows grouped by actor/name. */
export function collapseParticipants(entries) {
  const byKey = new Map();
  for (const { actorUuid, name } of entries) {
    const id = participantKey(actorUuid, name);
    const row = byKey.get(id);
    if (row) row.count += 1;
    else byKey.set(id, { id, name, count: 1, actor: actorUuid ?? null });
  }
  return [...byKey.values()];
}

/** Union two counted-row lists, keeping the larger count per id (additive). */
export function mergeParticipants(existing, incoming) {
  const byKey = new Map(existing.map((r) => [r.id, { ...r }]));
  for (const row of incoming) {
    const prev = byKey.get(row.id);
    if (prev) byKey.set(row.id, { ...prev, name: row.name, actor: row.actor, count: Math.max(prev.count, row.count) });
    else byKey.set(row.id, { ...row });
  }
  return [...byKey.values()];
}
