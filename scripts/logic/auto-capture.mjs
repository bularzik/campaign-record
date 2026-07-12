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

/** The place whose scene matches, or null. */
export function matchPlaceForScene(places, sceneUuid) {
  return places.find((p) => p.scene === sceneUuid) ?? null;
}

/** The attached timepoint id with the greatest sort, or null. */
export function pickLatestTimepoint(attachedIds, timepoints) {
  const attached = new Set(attachedIds);
  let best = null;
  for (const tp of timepoints) {
    if (attached.has(tp.id) && (best === null || tp.sort > best.sort)) best = tp;
  }
  return best?.id ?? null;
}

/** Collapse a list of names into "Name ×N" fragments (N omitted when 1). */
function countedNames(names) {
  const counts = new Map();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(", ");
}

/** Build the combat outcome summary string from resolved end-state. */
export function summarizeOutcome(state, labels) {
  const died = [
    ...state.present.filter((c) => c.defeated).map((c) => c.name),
    ...state.departed.filter((c) => c.defeated).map((c) => c.name)
  ];
  const fled = state.departed.filter((c) => !c.defeated).map((c) => c.name);
  const injured = state.present
    .filter((c) => !c.defeated && c.hp && c.hp.value < c.hp.max && c.hp.value > 0)
    .map((c) => c.name);
  const parts = [];
  if (died.length) parts.push(`${labels.died}: ${countedNames(died)}`);
  if (injured.length) parts.push(`${labels.injured}: ${countedNames(injured)}`);
  if (fled.length) parts.push(`${labels.fled}: ${countedNames(fled)}`);
  return parts.length ? parts.join(" · ") : labels.none;
}
