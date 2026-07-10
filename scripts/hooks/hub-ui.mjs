import { MODULE_ID, THUMBNAILS_SETTING, INLINE_EDIT_SETTING } from "../constants.mjs";
import { CampaignHub } from "../apps/hub/campaign-hub.mjs";

/** Journal sidebar footer button — visible to every user. */
export function registerHubUI() {
  Hooks.on("renderJournalDirectory", (app, html) => {
    if (html.querySelector(".campaign-record-open-hub")) return;
    const footer = html.querySelector(".directory-footer") ?? html;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "campaign-record-open-hub";
    btn.innerHTML = `<i class="fa-solid fa-book-atlas"></i> ${game.i18n.localize("CAMPAIGNRECORD.Hub.Open")}`;
    btn.addEventListener("click", () => CampaignHub.open());
    footer.append(btn);
  });

  Hooks.on("getSceneControlButtons", (controls) => {
    const notes = controls.notes ?? controls.journal;
    if (!notes?.tools) return;
    notes.tools.campaignHub = {
      name: "campaignHub",
      title: "CAMPAIGNRECORD.Hub.Open",
      icon: "fa-solid fa-book-atlas",
      button: true,
      order: 99,
      onChange: () => CampaignHub.open()
    };
  });
}

/** Hub client preferences. Call during init. */
export function registerHubSettings() {
  game.settings.register(MODULE_ID, THUMBNAILS_SETTING, {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, INLINE_EDIT_SETTING, {
    name: "CAMPAIGNRECORD.Settings.InlineEditing.Name",
    hint: "CAMPAIGNRECORD.Settings.InlineEditing.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      // Open journal sheets swap record views between read-only and editable.
      const { JournalEntrySheet } = foundry.applications.sheets.journal;
      for (const app of foundry.applications.instances.values()) {
        if (app instanceof JournalEntrySheet && app.rendered) app.render();
      }
    }
  });
}

/** Ctrl+Shift+H (editable) toggles the Hub. Call during init. */
export function registerHubKeybinding() {
  game.keybindings.register(MODULE_ID, "openHub", {
    name: "CAMPAIGNRECORD.Hub.Open",
    editable: [{ key: "KeyH", modifiers: ["Control", "Shift"] }],
    onDown: () => {
      CampaignHub.toggle();
      return true;
    }
  });
}
