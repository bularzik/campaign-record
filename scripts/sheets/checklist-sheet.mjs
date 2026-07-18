import { BaseRecordSheet } from "./base-record-sheet.mjs";

export class ChecklistSheet extends BaseRecordSheet {
  static DEFAULT_OPTIONS = {
    actions: {
      addItem: ChecklistSheet.#onAddItem,
      deleteItem: ChecklistSheet.#onDeleteItem,
      toggleItem: ChecklistSheet.#onToggleItem,
      openAssignee: ChecklistSheet.#onOpenAssignee
    }
  };

  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/checklist/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/checklist/view.hbs" }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const characters = game.actors
      .filter((a) => a.type === "character")
      .sort((a, b) => a.name.localeCompare(b.name));
    context.actorOptions = Object.fromEntries(characters.map((a) => [a.id, a.name]));
    context.items = this.document.system.items.map((item) => {
      const actor = item.assignee ? game.actors.get(item.assignee) : null;
      return {
        ...item,
        assigneeName: actor?.name ?? "",
        assigneeVisible: actor?.testUserPermission(game.user, "LIMITED") ?? false
      };
    });
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.bindRowInputs("items");
  }

  static async #onAddItem() {
    await this.updateRows("items", (rows) =>
      rows.push({ id: foundry.utils.randomID(), text: "", done: false, assignee: "" })
    );
  }

  static async #onDeleteItem(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("items", (rows) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    });
  }

  static async #onToggleItem(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("items", (rows) => {
      const r = rows.find((x) => x.id === id);
      if (r) r.done = !r.done;
    });
  }

  /** Open the assigned character's sheet. Missing actor: silent no-op. */
  static async #onOpenAssignee(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    const item = this.document.system.items.find((i) => i.id === id);
    const actor = item?.assignee ? game.actors.get(item.assignee) : null;
    actor?.sheet.render(true);
  }
}
