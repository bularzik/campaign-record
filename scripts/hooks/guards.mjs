import { canSetHidden } from "../logic/visibility.mjs";

/**
 * Client-side guard: prevent non-GM users from flipping the hidden flag.
 * Render-time secrecy is the accepted norm (see spec); this guard is advisory
 * and runs on the initiating client.
 */
export function registerUpdateGuards() {
  Hooks.on("preUpdateJournalEntryPage", (page, changes) => {
    if (canSetHidden(game.user)) return;
    if (foundry.utils.hasProperty(changes, "system.hidden")) {
      delete changes.system.hidden;
      ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Warning.HiddenGMOnly"));
    }
    if (foundry.utils.hasProperty(changes, "ownership")) {
      delete changes.ownership;
    }
  });
}
