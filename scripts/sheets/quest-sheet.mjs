import { BaseRecordSheet } from "./base-record-sheet.mjs";
import { QUEST_STATUSES } from "../data/quest.mjs";

const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

export class QuestSheet extends BaseRecordSheet {
  static DEFAULT_OPTIONS = {
    actions: {
      addObjective: QuestSheet.#onAddObjective,
      deleteObjective: QuestSheet.#onDeleteObjective,
      toggleObjective: QuestSheet.#onToggleObjective,
      toggleObjectiveGmOnly: QuestSheet.#onToggleObjectiveGmOnly
    }
  };

  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/quest/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/quest/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    context.enriched.rewards = await TextEditorImpl.enrichHTML(system.rewards, {
      relativeTo: this.document
    });
    context.objectives = system.objectives.filter((o) => game.user.isGM || !o.gmOnly);
    context.statusChoices = QUEST_STATUSES;
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.bindRowInputs("objectives");
  }

  static async #onAddObjective() {
    await this.updateRows("objectives", (rows) =>
      rows.push({ id: foundry.utils.randomID(), text: "", done: false, gmOnly: false })
    );
  }

  static async #onDeleteObjective(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("objectives", (rows) => {
      const i = rows.findIndex((o) => o.id === id);
      if (i >= 0) rows.splice(i, 1);
    });
  }

  static async #onToggleObjective(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("objectives", (rows) => {
      const o = rows.find((x) => x.id === id);
      if (o) o.done = !o.done;
    });
  }

  static async #onToggleObjectiveGmOnly(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("objectives", (rows) => {
      const o = rows.find((x) => x.id === id);
      if (o) o.gmOnly = !o.gmOnly;
    });
  }
}
