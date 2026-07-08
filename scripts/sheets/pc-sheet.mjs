import { BaseRecordSheet } from "./base-record-sheet.mjs";

const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

export class PcSheet extends BaseRecordSheet {
  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/pc/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/pc/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.enriched.actorLink = this.document.system.actor
      ? await TextEditorImpl.enrichHTML(`@UUID[${this.document.system.actor}]`)
      : "";
    return context;
  }

  async _onDropDocument(data) {
    if (data.type !== "Actor") return;
    await this.document.update({ "system.actor": data.uuid });
  }
}
