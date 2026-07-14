// scripts/hooks/auto-link.mjs
import { autoLinkAdded } from "../logic/auto-link.mjs";
import { selectCandidates } from "../logic/auto-link-candidates.mjs";
import { getBaseline } from "../logic/auto-link-baseline.mjs";
import { isGroup } from "../data/groups.mjs";
import { isIndexablePage } from "../apps/hub/hub-data.mjs";
import { isRecordVisible } from "../logic/visibility.mjs";

// Rich prose fields that can carry entry-name mentions.
const FIELDS = [
  "system.description",
  "system.gmNotes",
  "system.rewards",
  "system.distribution",
  "text.content"
];

/** Linkable siblings in the page's own campaign record (group). */
function buildCandidates(page) {
  const group = page.parent;
  if (!isGroup(group)) return [];
  const candidates = selectCandidates({
    selfId: page.id,
    pages: group.pages.map((p) => ({
      id: p.id,
      uuid: p.uuid,
      name: p.name,
      indexable: isIndexablePage(p),
      visible: isRecordVisible(game.user, p)
    }))
  });
  const seen = new Set();
  for (const c of candidates) {
    const low = c.name.toLowerCase();
    if (seen.has(low)) {
      console.warn(`campaign-record | duplicate entry name "${c.name}"; auto-link uses the first match`);
    }
    seen.add(low);
  }
  return candidates;
}

/**
 * On a committed save, wrap newly-added entry-name mentions as content links.
 * Quiet inline autosaves pass { render: false } and are skipped so the stored
 * content never drifts from the open editor.
 */
export function registerAutoLink() {
  Hooks.on("preUpdateJournalEntryPage", (page, changes, options) => {
    if (options?.render === false) return;
    if (!FIELDS.some((f) => foundry.utils.hasProperty(changes, f))) return;
    const candidates = buildCandidates(page);
    if (!candidates.length) return;
    for (const field of FIELDS) {
      if (!foundry.utils.hasProperty(changes, field)) continue;
      const next = foundry.utils.getProperty(changes, field);
      if (typeof next !== "string" || !next) continue;
      const baseline = getBaseline(page.uuid, field) ?? foundry.utils.getProperty(page, field) ?? "";
      const linked = autoLinkAdded(baseline, next, candidates);
      if (linked !== next) foundry.utils.setProperty(changes, field, linked);
    }
  });
}
