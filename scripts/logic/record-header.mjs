/** Pure decisions for the hub record-pane header's image/tag controls. */

/**
 * Which header controls render, and what the image button does on click.
 * Non-record (core text) pages have no system.image/tags → nothing renders.
 * Editors always get the image button (pick mode); viewers get it only when
 * an image exists (popout mode). The tag button mirrors that: editors always,
 * viewers only when there are tags to read.
 */
export function buildHeaderActions({ isRecord, canEdit, hasImage, tagCount }) {
  const showImageButton = Boolean(isRecord && (canEdit || hasImage));
  return {
    showImageButton,
    imageClickMode: showImageButton ? (canEdit ? "pick" : "popout") : null,
    showTagButton: Boolean(isRecord && (canEdit || tagCount > 0))
  };
}

/**
 * Tags to save after adding `raw`, or null when nothing should change
 * (blank input, or a case-insensitive duplicate — first-seen casing wins).
 */
export function normalizeTagAdd(tags, raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) return null;
  return [...tags, value];
}

/** Tags to save after removing `tag` (exact match). */
export function removeTag(tags, tag) {
  return tags.filter((t) => t !== tag);
}
