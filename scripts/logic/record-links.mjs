/**
 * Decide how the hub should handle activating a link to a document.
 * - "in-pane": any journal page — every page opens in the current hub's pane
 * - "external": anything else (defer to Foundry's default handling)
 */
export function classifyLinkTarget(doc) {
  if (doc?.documentName !== "JournalEntryPage") return { kind: "external" };
  return { kind: "in-pane", uuid: doc.uuid };
}
