import { BaseRecordSheet } from "./base-record-sheet.mjs";

const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

export class ItemRecordSheet extends BaseRecordSheet {
  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/item/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/item/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.enriched.itemLink = this.document.system.item
      ? await TextEditorImpl.enrichHTML(`@UUID[${this.document.system.item}]`)
      : "";
    return context;
  }

  async _onDropDocument(data) {
    if (data.type !== "Item") return;
    await this.document.update({ "system.item": data.uuid });
  }
}
