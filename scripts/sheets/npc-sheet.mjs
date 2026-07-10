import { BaseRecordSheet } from "./base-record-sheet.mjs";
import { actorSummary } from "../integrations/dnd5e.mjs";
import { NPC_STATUSES } from "../data/npc.mjs";

const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

export class NpcSheet extends BaseRecordSheet {
  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/npc/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/npc/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.enriched.actorLink = this.document.system.actor
      ? await TextEditorImpl.enrichHTML(`@UUID[${this.document.system.actor}]`)
      : "";
    context.actorInfo = this.document.system.actor
      ? actorSummary(await fromUuid(this.document.system.actor))
      : null;
    context.statusChoices = NPC_STATUSES;
    return context;
  }

  async _onDropDocument(data) {
    if (data.type !== "Actor") return;
    await this.document.update({ "system.actor": data.uuid });
  }
}
