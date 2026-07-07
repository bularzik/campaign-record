import { promptCreateGroup } from "../apps/create-group-dialog.mjs";

/**
 * Add a "Create Campaign Group" button to the journal sidebar footer.
 * Available to any user with the Create Journal Entries permission.
 * In v13 the render hook receives an HTMLElement (ApplicationV2).
 */
export function registerDirectoryUI() {
  Hooks.on("renderJournalDirectory", (app, html) => {
    if (!game.user.can("JOURNAL_CREATE")) return;
    if (html.querySelector(".campaign-record-create-group")) return;
    const footer = html.querySelector(".directory-footer") ?? html;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "campaign-record-create-group";
    btn.innerHTML = `<i class="fa-solid fa-book-atlas"></i> ${game.i18n.localize("CAMPAIGNRECORD.CreateGroup")}`;
    btn.addEventListener("click", () => promptCreateGroup());
    footer.append(btn);
  });
}
