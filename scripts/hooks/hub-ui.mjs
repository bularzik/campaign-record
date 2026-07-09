import { MODULE_ID, THUMBNAILS_SETTING } from "../constants.mjs";
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
