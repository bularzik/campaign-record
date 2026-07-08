/**
 * Socket payload shapes for the media presenter. Unknown or malformed
 * messages return null so handlers no-op (version-mismatched clients).
 */
export function validatePresenterPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  switch (raw.action) {
    case "show": {
      const { images, index, presenterId, interval } = raw;
      if (!Array.isArray(images) || !images.length) return null;
      if (!images.every((i) => i && typeof i.src === "string" && i.src)) return null;
      if (!Number.isInteger(index) || index < 0 || index >= images.length) return null;
      if (typeof presenterId !== "string" || !presenterId) return null;
      return {
        action: "show",
        images: images.map((i) => ({
          src: i.src,
          caption: typeof i.caption === "string" ? i.caption : ""
        })),
        index,
        presenterId,
        interval: Number.isInteger(interval) && interval > 0 ? interval : 0
      };
    }
    case "goto":
      return Number.isInteger(raw.index) && raw.index >= 0
        ? { action: "goto", index: raw.index }
        : null;
    case "end":
      return { action: "end" };
    default:
      return null;
  }
}
