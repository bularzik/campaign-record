/** Pure hub render-scope decisions. No Foundry globals — unit-tested with vitest. */

/**
 * Which parts to render after a document-change hook. Returning null means
 * "render all parts". When a still-valid record is open, we omit the `record`
 * part so its `.record-pane-mount` DOM node keeps its identity and the embedded
 * editor is never re-parented/torn down.
 * @param {{hasView: boolean, viewInvalidated: boolean}} state
 * @returns {string[]|null}
 */
export function renderPartsForChange({ hasView, viewInvalidated }) {
  if (hasView && !viewInvalidated) return ["header", "index", "timeline"];
  return null;
}
