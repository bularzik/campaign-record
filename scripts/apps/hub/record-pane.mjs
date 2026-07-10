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
      const cls = page._getSheetClass();
      sheet = new cls({
        id: `campaign-record-pane-${page.id}-${mode}`,
        document: page,
        mode,
        ...(mode === "view" ? { tag: "div" } : {}),
        window: { frame: false, positioned: false }
      });
      this.#sheets.set(key, sheet);
    }
    if (!sheet.rendered) await sheet.render({ force: true });
    sheet.element.classList.add("record-pane-sheet");
    container.replaceChildren(sheet.element);
  }

  async close() {
    for (const sheet of this.#sheets.values()) await sheet.close({ animate: false });
    this.#sheets.clear();
  }
}
