import { BaseRecordSheet } from "./base-record-sheet.mjs";
import { itemDropDetails } from "../integrations/dnd5e.mjs";

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
    const update = { "system.item": data.uuid };
    const details = itemDropDetails(await fromUuid(data.uuid));
    if (details?.rarity && !this.document.system.rarity) update["system.rarity"] = details.rarity;
    if (details?.itemTypeLabel && !this.document.system.itemType) {
      update["system.itemType"] = details.itemTypeLabel;
    }
    await this.document.update(update);
  }
}
