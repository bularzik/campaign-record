import { MODULE_ID } from "../constants.mjs";
import { validatePresenterPayload } from "../logic/presenter-payload.mjs";
import { MediaOverlay } from "./overlay.mjs";

export const SOCKET_NAME = `module.${MODULE_ID}`;

export function registerPresenterSocket() {
  game.socket.on(SOCKET_NAME, (payload) => applyPresenterMessage(payload));
}

/**
 * Validate and apply a presenter message on this client; invalid → no-op.
 *
 * Presenting is GM-only, so "show" additionally requires the claimed
 * presenter to be a GM. Residual risk, stated honestly: raw module sockets
 * carry no authenticated sender id, so a hostile logged-in user could still
 * spoof a GM's presenterId in a hand-crafted emit — client-side guards
 * cannot fully close that. This matches the trust model of Foundry module
 * sockets generally.
 */
export function applyPresenterMessage(raw) {
  const p = validatePresenterPayload(raw);
  if (!p) return;
  if (p.action === "show") {
    if (!game.users.get(p.presenterId)?.isGM) return;
    MediaOverlay.show(p);
  } else if (p.action === "goto") MediaOverlay.goTo(p.index);
  else MediaOverlay.endForAll();
}

/** Sockets never echo back to the sender: emit to others AND apply locally. */
export function broadcastPresenterMessage(payload) {
  if (!game.user.isGM) return; // presenting is GM-only; viewers dismiss locally
  game.socket.emit(SOCKET_NAME, payload);
  applyPresenterMessage(payload);
}
