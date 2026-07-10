import { hasGroupFlag } from "./visibility.mjs";

/**
 * Decide how the hub should handle activating a link to a document.
 * - "in-pane": a page of a campaign group within the hub's scope
 * - "other-group": a page of a campaign group outside the scope
 * - "external": anything else (defer to Foundry's default handling)
 */
export function classifyLinkTarget(doc, scopedGroupIds) {
  if (doc?.documentName !== "JournalEntryPage") return { kind: "external" };
  if (!hasGroupFlag(doc.parent?.flags)) return { kind: "external" };
  const groupId = doc.parent.id;
  const kind = scopedGroupIds.has(groupId) ? "in-pane" : "other-group";
  return { kind, groupId, pageId: doc.id };
}
