import { BaseRecordSheet } from "./base-record-sheet.mjs";
import { typeId } from "../constants.mjs";

const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

export class LootSheet extends BaseRecordSheet {
  static DEFAULT_OPTIONS = {
    actions: {
      addLootItem: LootSheet.#onAddLootItem,
      deleteLootItem: LootSheet.#onDeleteLootItem
    }
  };

  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/loot/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/loot/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    context.enriched.distribution = await TextEditorImpl.enrichHTML(system.distribution, {
      relativeTo: this.document
    });
    context.enriched.sourceLink = system.source
      ? await TextEditorImpl.enrichHTML(`@UUID[${system.source}]`)
      : "";
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.bindRowInputs("items");
  }

  static async #onAddLootItem() {
    await this.updateRows("items", (rows) =>
      rows.push({ id: foundry.utils.randomID(), name: "", quantity: 1, item: null })
    );
  }

  static async #onDeleteLootItem(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("items", (rows) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    });
  }

  async _onDropDocument(data) {
    if (data.type === "Item") {
      const item = await fromUuid(data.uuid);
      return this.updateRows("items", (rows) =>
        rows.push({ id: foundry.utils.randomID(), name: item?.name ?? "", quantity: 1, item: data.uuid })
      );
    }
    if (data.type === "JournalEntryPage") {
      const pageDoc = await fromUuid(data.uuid);
      if (pageDoc?.type === typeId("encounter")) {
        return this.document.update({ "system.source": data.uuid });
      }
    }
  }
}
