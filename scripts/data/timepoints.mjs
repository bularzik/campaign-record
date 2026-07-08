import { MODULE_ID, GROUP_FLAG } from "../constants.mjs";
import { sortKeyBetween, sortTimepoints } from "../logic/timeline-sort.mjs";
import { isRecordVisible } from "../logic/visibility.mjs";

/** Sorted timepoints of a group. */
export function getTimepoints(group) {
  const flag = group.getFlag(MODULE_ID, GROUP_FLAG);
  return sortTimepoints(flag?.timepoints ?? []);
}

async function setTimepoints(group, timepoints) {
  await group.setFlag(MODULE_ID, GROUP_FLAG, { timepoints });
}

export async function addTimepoint(group, label, position = null) {
  const tps = getTimepoints(group);
  const i = position == null ? tps.length : Math.max(0, Math.min(position, tps.length));
  const tp = {
    id: foundry.utils.randomID(),
    label,
    sort: sortKeyBetween(tps[i - 1]?.sort ?? null, tps[i]?.sort ?? null)
  };
  await setTimepoints(group, [...tps, tp]);
  return tp;
}

export async function renameTimepoint(group, id, label) {
  const tps = getTimepoints(group).map((t) => (t.id === id ? { ...t, label } : t));
  await setTimepoints(group, tps);
}

export async function moveTimepoint(group, id, position) {
  const tps = getTimepoints(group);
  const moving = tps.find((t) => t.id === id);
  if (!moving) return;
  const rest = tps.filter((t) => t.id !== id);
  const i = Math.max(0, Math.min(position, rest.length));
  const sort = sortKeyBetween(rest[i - 1]?.sort ?? null, rest[i]?.sort ?? null);
  await setTimepoints(group, [...rest, { ...moving, sort }]);
}

export async function deleteTimepoint(group, id) {
  await setTimepoints(group, getTimepoints(group).filter((t) => t.id !== id));
  for (const page of group.pages) {
    const tps = page.system?.timepoints;
    if (!tps?.has?.(id)) continue;
    const next = [...tps].filter((t) => t !== id);
    await page.update({ "system.timepoints": next });
  }
}

export async function attachRecord(page, timepointId) {
  const next = new Set(page.system.timepoints ?? []);
  next.add(timepointId);
  await page.update({ "system.timepoints": [...next] });
}

export async function detachRecord(page, timepointId) {
  const next = new Set(page.system.timepoints ?? []);
  next.delete(timepointId);
  await page.update({ "system.timepoints": [...next] });
}

/** Records of a group attached to a timepoint, filtered by user visibility. */
export function recordsAtTimepoint(group, timepointId, user) {
  return group.pages.filter(
    (p) => p.system?.timepoints?.has?.(timepointId) && isRecordVisible(user, p)
  );
}
