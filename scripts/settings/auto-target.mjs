import { MODULE_ID, AUTO_TARGET_SETTING, AUTO_TARGET_ACTION } from "../constants.mjs";
import { SOCKET_NAME } from "../presenter/socket.mjs";
import { getGroups } from "../data/groups.mjs";
import { resolveTargetGroup } from "../logic/auto-capture.mjs";

/** Register the target-group world setting. Call during init. */
export function registerAutoTargetSetting() {
  game.settings.register(MODULE_ID, AUTO_TARGET_SETTING, {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
}

/** The current target group, or null when unset/stale. */
export function getTargetGroup() {
  return resolveTargetGroup(game.settings.get(MODULE_ID, AUTO_TARGET_SETTING), getGroups());
}

/**
 * Set the target group. GMs write the world setting directly; players relay
 * to the active GM over the module socket. groupId "" clears the target.
 */
export async function setTargetGroup(groupId) {
  if (game.user.isGM) {
    await game.settings.set(MODULE_ID, AUTO_TARGET_SETTING, groupId ?? "");
    return;
  }
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.AutoCapture.NoGMForTarget"));
    return;
  }
  game.socket.emit(SOCKET_NAME, { action: AUTO_TARGET_ACTION, groupId: groupId ?? "" });
}

/** Listen for relayed target changes; only the active GM applies them. Call in ready. */
export function registerAutoTargetSocket() {
  game.socket.on(SOCKET_NAME, async (payload) => {
    if (payload?.action !== AUTO_TARGET_ACTION) return;
    if (game.user !== game.users.activeGM) return;
    await game.settings.set(MODULE_ID, AUTO_TARGET_SETTING, payload.groupId ?? "");
  });
}
