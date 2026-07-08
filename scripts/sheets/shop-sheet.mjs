import { BaseRecordSheet } from "./base-record-sheet.mjs";

export class ShopSheet extends BaseRecordSheet {
  static DEFAULT_OPTIONS = {
    actions: {
      addInventoryRow: ShopSheet.#onAddInventoryRow,
      deleteInventoryRow: ShopSheet.#onDeleteInventoryRow
    }
  };

  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/shop/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/shop/view.hbs" }
  };

  _onRender(context, options) {
    super._onRender(context, options);
    this.bindRowInputs("inventory");
  }

  static async #onAddInventoryRow() {
    await this.updateRows("inventory", (rows) =>
      rows.push({ id: foundry.utils.randomID(), name: "", price: "", quantity: 1, item: null })
    );
  }

  static async #onDeleteInventoryRow(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("inventory", (rows) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    });
  }

  async _onDropDocument(data) {
    if (data.type !== "Item") return;
    const item = await fromUuid(data.uuid);
    await this.updateRows("inventory", (rows) =>
      rows.push({ id: foundry.utils.randomID(), name: item?.name ?? "", price: "", quantity: 1, item: data.uuid })
    );
  }
}
