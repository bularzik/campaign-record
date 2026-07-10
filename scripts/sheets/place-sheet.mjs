import { BaseRecordSheet } from "./base-record-sheet.mjs";
import { PLACE_TYPES } from "../data/place.mjs";

const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

export class PlaceSheet extends BaseRecordSheet {
  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/place/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/place/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.enriched.sceneLink = this.document.system.scene
      ? await TextEditorImpl.enrichHTML(`@UUID[${this.document.system.scene}]`)
      : "";
    context.placeTypeChoices = PLACE_TYPES;
    return context;
  }

  async _onDropDocument(data) {
    if (data.type !== "Scene") return;
    await this.document.update({ "system.scene": data.uuid });
  }
}
