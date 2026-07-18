import { MODULE_ID, UPLOAD_MEDIA_ACTION, UPLOAD_MEDIA_RESULT_ACTION } from "../constants.mjs";
import { isGroup } from "../data/groups.mjs";
import {
  chunkBase64, createRelayAssembler, base64ByteLength, isRelayableImageType, MAX_RELAY_FILE_BYTES
} from "../logic/media-relay.mjs";
import { uploadHubMedia } from "../apps/hub/media-upload.mjs";

const SOCKET_NAME = `module.${MODULE_ID}`;
const RELAY_TIMEOUT_MS = 30_000;

const pending = new Map(); // requestId -> {resolve, reject, timer} on the requesting client
const assembler = createRelayAssembler();

export class RelayUploadError extends Error {}

/** Encode a File's bytes as base64 without exceeding the call stack. */
async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const STRIDE = 0x8000;
  for (let i = 0; i < bytes.length; i += STRIDE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STRIDE));
  }
  return btoa(binary);
}

/**
 * Ask the active GM to upload this image on our behalf; resolves with the
 * stored path. Images only, capped at MAX_RELAY_FILE_BYTES. The caller
 * ensures an active GM exists (uploadHubMediaAsUser).
 */
export async function relayUploadMedia(group, file) {
  if (!isRelayableImageType(file.type)) {
    throw new RelayUploadError(`campaign-record | not a relayable image: ${file.name}`);
  }
  const base64 = await fileToBase64(file);
  if (base64ByteLength(base64) > MAX_RELAY_FILE_BYTES) {
    throw new RelayUploadError(`campaign-record | too large to relay: ${file.name}`);
  }
  const requestId = foundry.utils.randomID();
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new RelayUploadError(`campaign-record | relay upload timed out for ${file.name}`));
    }, RELAY_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });
  });
  chunkBase64(base64).forEach((data, seq, chunks) => {
    game.socket.emit(SOCKET_NAME, {
      action: UPLOAD_MEDIA_ACTION,
      requestId, groupId: group.id, name: file.name, type: file.type,
      seq, total: chunks.length, data
    });
  });
  return result;
}

/**
 * GM side: reassemble, validate, upload, reply. Requests are untrusted
 * (module sockets carry no authenticated sender): the target directory is
 * derived from a validated group id inside uploadHubMedia, never from the
 * payload, and only renderable image types under the size cap are accepted.
 */
async function handleUploadRequest(payload) {
  const outcome = assembler.accept(payload, Date.now());
  if (outcome.status === "pending") return;
  const requestId = outcome.status === "complete" ? outcome.request.requestId : payload?.requestId;
  const reply = (message) => {
    if (typeof requestId === "string" && requestId) {
      game.socket.emit(SOCKET_NAME, { action: UPLOAD_MEDIA_RESULT_ACTION, requestId, ...message });
    }
  };
  if (outcome.status === "invalid") return reply({ error: outcome.reason });
  const group = game.journal.get(outcome.request.groupId);
  if (!group || !isGroup(group)) return reply({ error: "unknown-group" });
  try {
    const bytes = Uint8Array.from(atob(outcome.request.base64), (c) => c.charCodeAt(0));
    const file = new File([bytes], outcome.request.name, { type: outcome.request.type });
    const path = await uploadHubMedia(group, file);
    reply({ path });
  } catch (error) {
    console.error("campaign-record | relayed media upload failed", error);
    reply({ error: "upload-failed" });
  }
}

/** Requester side: settle the pending promise for this requestId, if ours. */
function handleUploadResult(payload) {
  const entry = typeof payload?.requestId === "string" ? pending.get(payload.requestId) : null;
  if (!entry) return;
  pending.delete(payload.requestId);
  clearTimeout(entry.timer);
  if (typeof payload.path === "string" && payload.path) entry.resolve(payload.path);
  else entry.reject(new RelayUploadError(`campaign-record | relay upload refused: ${payload.error ?? "unknown"}`));
}

/** Listen for relayed upload chunks (active GM) and replies (requester). Call in ready. */
export function registerMediaRelaySocket() {
  game.socket.on(SOCKET_NAME, (payload) => {
    if (payload?.action === UPLOAD_MEDIA_ACTION) {
      if (game.user !== game.users.activeGM) return;
      handleUploadRequest(payload);
    } else if (payload?.action === UPLOAD_MEDIA_RESULT_ACTION) {
      handleUploadResult(payload);
    }
  });
}
