/**
 * Pure drag-drop media routing logic. No Foundry globals — unit-tested with vitest.
 */
import { isImagePath } from "./timeline-links.mjs";
import { isVideoSrc } from "./auto-capture.mjs";
import { typeId } from "../constants.mjs";

const MEDIA_TYPE = typeId("media");

/** True when a filename/path is a supported image or video, by extension. */
export function isMediaFilename(name) {
  return isImagePath(name) || isVideoSrc(name);
}

/** Server-safe upload filename: timestamp prefix + sanitized original name. */
export function uploadFilename(name, now) {
  const safe = (name ?? "")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "");
  return `${now}-${safe || "media"}`;
}

/**
 * Decide where dropped media files land.
 * Precedence: explicit timepoint row > open modifiable media entry > shared auto-gallery.
 * `viewedPage` needs only `.type` and `.uuid`.
 */
export function resolveDropTarget({ timepointId = null, viewedPage = null, canModifyPage = false }) {
  if (timepointId) return { kind: "timepoint", id: timepointId };
  if (viewedPage?.type === MEDIA_TYPE && canModifyPage) {
    return { kind: "media-entry", uuid: viewedPage.uuid };
  }
  return { kind: "auto-gallery" };
}
