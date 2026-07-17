import { BaseRecordSheet } from "./base-record-sheet.mjs";

const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

/**
 * Inline-editable sheet for plain text/journal pages inside a hub group.
 * Reuses BaseRecordSheet's inline-prose saver + deferred-render machinery,
 * bound to `text.content` instead of a system field.
 */
export class TextPageSheet extends BaseRecordSheet {
  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/text/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/text/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.enriched.content = await TextEditorImpl.enrichHTML(this.document.text?.content ?? "", {
      relativeTo: this.document
    });
    return context;
  }
}
