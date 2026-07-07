import { BaseRecordSheet } from "./base-record-sheet.mjs";

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
    return context;
  }

  /** Read, mutate, and write the objectives array as one targeted update. */
  async #updateObjectives(mutate) {
    const objectives = this.document.system.toObject().objectives;
    mutate(objectives);
    await this.document.update({ "system.objectives": objectives });
  }

  static async #onAddObjective() {
    await this.#updateObjectives((objectives) =>
      objectives.push({ id: foundry.utils.randomID(), text: "", done: false, gmOnly: false })
    );
  }

  static async #onDeleteObjective(event, target) {
    const id = target.closest("[data-objective-id]").dataset.objectiveId;
    await this.#updateObjectives((objectives) => {
      const i = objectives.findIndex((o) => o.id === id);
      if (i >= 0) objectives.splice(i, 1);
    });
  }

  static async #onToggleObjective(event, target) {
    const id = target.closest("[data-objective-id]").dataset.objectiveId;
    await this.#updateObjectives((objectives) => {
      const o = objectives.find((x) => x.id === id);
      if (o) o.done = !o.done;
    });
  }

  static async #onToggleObjectiveGmOnly(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-objective-id]").dataset.objectiveId;
    await this.#updateObjectives((objectives) => {
      const o = objectives.find((x) => x.id === id);
      if (o) o.gmOnly = !o.gmOnly;
    });
  }
}
