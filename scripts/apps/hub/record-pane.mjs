import { TextPageSheet } from "../../sheets/text-page-sheet.mjs";
import { GROUP_SHEET_CLASS } from "../../constants.mjs";

/**
 * Owns the frameless page-sheet instances embedded in a hub's record pane.
 * Mirrors core JournalEntrySheet.getPageSheet(): real registered sheets,
 * rendered with no window frame, appended into a container we control.
 */
export class RecordPane {
  #sheets = new Map(); // "pageUuid:mode" -> sheet instance

  async mount(container, page, mode) {
    const key = `${page.uuid}:${mode}`;
    // One live embedded sheet at a time: close all others (mode flips included).
    for (const [k, sheet] of [...this.#sheets]) {
      if (k === key) continue;
      await sheet.close({ animate: false });
      this.#sheets.delete(k);
    }
    let sheet = this.#sheets.get(key);
    if (!sheet) {
      const inHubGroup = page.parent?.getFlag("core", "sheetClass") === GROUP_SHEET_CLASS;
      const cls = (page.type === "text" && inHubGroup) ? TextPageSheet : page._getSheetClass();
      sheet = new cls({
        id: `campaign-record-pane-${page.id}-${mode}`,
        document: page,
        mode,
        ...(mode === "view" ? { tag: "div" } : {}),
        window: { frame: false, positioned: false }
      });
      this.#sheets.set(key, sheet);
    }
    let fresh = false;
    if (!sheet.rendered) {
      await sheet.render({ force: true });
      fresh = true;
    }
    sheet.element.classList.add("record-pane-sheet");
    // Re-appending an element that is already this container's child would
    // still disconnect + reconnect it (killing active editors) — skip.
    if (sheet.element.parentElement === container) return;
    container.replaceChildren(sheet.element);
    // Re-parenting a live sheet disconnects any active always-open
    // <prose-mirror>: core's disconnectedCallback saves + destroys the editor
    // and its #active flag stays true, so it can never reactivate on
    // reconnect. Rebuild the sheet's DOM so editors come back alive.
    if (!fresh) await sheet.render({ force: true });
  }

  async close() {
    for (const sheet of this.#sheets.values()) await sheet.close({ animate: false });
    this.#sheets.clear();
  }
}
