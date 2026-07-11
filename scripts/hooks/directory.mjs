import { promptCreateGroup } from "../apps/create-group-dialog.mjs";
import { isGroup } from "../data/groups.mjs";
import { GroupHubSheet } from "../apps/hub/group-hub-sheet.mjs";

// Hub sheets built for legacy groups whose flags.core.sheetClass is missing.
// Cached per entry so repeated activations reuse one window instead of
// stacking duplicates. GC'd with the document (WeakMap).
const legacyHubs = new WeakMap();

/** Open a Campaign Record in the hub, independent of its sheetClass flag. */
function openGroupHub(entry) {
  if (entry.sheet instanceof GroupHubSheet) {
    entry.sheet.render(true);
    return;
  }
  let hub = legacyHubs.get(entry);
  if (!hub) {
    hub = new GroupHubSheet({ document: entry });
    legacyHubs.set(entry, hub);
  }
  hub.render(true);
}

/**
 * Make Journal-sidebar activation of a Campaign Record open the hub rather
 * than the core journal editor. Foundry's activateEntry action calls
 * `entry.sheet.render(true)`, which only lands on GroupHubSheet when the
 * entry carries flags.core.sheetClass — legacy groups miss it and fall back
 * to the journal editor. A capture-phase listener intercepts the activation
 * click first and routes every group entry to the hub deterministically.
 */
function registerGroupActivation(html) {
  if (html.dataset.campaignRecordActivation) return;
  html.dataset.campaignRecordActivation = "1";
  html.addEventListener(
    "click",
    (event) => {
      const nameEl = event.target.closest('[data-action="activateEntry"]');
      if (!nameEl) return;
      const li = nameEl.closest("[data-entry-id]");
      const entry = li && game.journal.get(li.dataset.entryId);
      if (!entry || !isGroup(entry)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openGroupHub(entry);
    },
    { capture: true }
  );
}

/**
 * Add a "Create Campaign Record" button to the journal sidebar footer and
 * route Campaign Record activation to the hub.
 * Available to any user with the Create Journal Entries permission.
 * In v13 the render hook receives an HTMLElement (ApplicationV2).
 */
export function registerDirectoryUI() {
  Hooks.on("renderJournalDirectory", (app, html) => {
    registerGroupActivation(html);

    if (!game.user.can("JOURNAL_CREATE")) return;
    if (html.querySelector(".campaign-record-create-group")) return;
    const footer = html.querySelector(".directory-footer") ?? html;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "campaign-record-create-group";
    btn.innerHTML = `<i class="fa-solid fa-book-atlas"></i> ${game.i18n.localize("CAMPAIGNRECORD.CreateGroup")}`;
    btn.addEventListener("click", () =>
      promptCreateGroup().catch((error) => {
        console.error("campaign-record | Failed to create group", error);
        ui.notifications.error(game.i18n.localize("CAMPAIGNRECORD.Warning.CreateGroupFailed"));
      })
    );
    footer.append(btn);
  });
}
