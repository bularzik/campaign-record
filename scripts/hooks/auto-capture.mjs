import { isGroup } from "../data/groups.mjs";
import { setTargetGroup } from "../settings/auto-target.mjs";

/** Register every auto-capture Foundry hook. Call during ready. */
export function registerAutoCapture() {
  // A newly created Campaign Record becomes the auto-capture target. Only the
  // creating user reacts, so the relay fires once.
  Hooks.on("createJournalEntry", (entry, options, userId) => {
    if (userId !== game.user.id) return;
    if (!isGroup(entry)) return;
    setTargetGroup(entry.id);
  });
}
