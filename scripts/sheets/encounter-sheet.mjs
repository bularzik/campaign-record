import { BaseRecordSheet } from "./base-record-sheet.mjs";

const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

export class EncounterSheet extends BaseRecordSheet {
  static DEFAULT_OPTIONS = {
    actions: {
      addCombatant: EncounterSheet.#onAddCombatant,
      deleteCombatant: EncounterSheet.#onDeleteCombatant
    }
  };

  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/encounter/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/encounter/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.enriched.sceneLink = this.document.system.scene
      ? await TextEditorImpl.enrichHTML(`@UUID[${this.document.system.scene}]`)
      : "";
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.bindRowInputs("combatants");
  }

  static async #onAddCombatant() {
    await this.updateRows("combatants", (rows) =>
      rows.push({ id: foundry.utils.randomID(), name: "", count: 1, actor: null })
    );
  }

  static async #onDeleteCombatant(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("combatants", (rows) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    });
  }

  async _onDropDocument(data) {
    if (data.type === "Scene") return this.document.update({ "system.scene": data.uuid });
    if (data.type === "Actor") {
      const actor = await fromUuid(data.uuid);
      return this.updateRows("combatants", (rows) =>
        rows.push({ id: foundry.utils.randomID(), name: actor?.name ?? "", count: 1, actor: data.uuid })
      );
    }
  }
}
