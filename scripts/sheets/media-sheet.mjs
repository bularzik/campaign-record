import { BaseRecordSheet } from "./base-record-sheet.mjs";

export class MediaSheet extends BaseRecordSheet {
  static DEFAULT_OPTIONS = {
    actions: {
      addImage: MediaSheet.#onAddImage,
      deleteImage: MediaSheet.#onDeleteImage,
      moveImage: MediaSheet.#onMoveImage
    }
  };

  static EDIT_PARTS = {
    ...super.EDIT_PARTS,
    content: { template: "modules/campaign-record/templates/media/edit.hbs" }
  };

  static VIEW_PARTS = {
    ...super.VIEW_PARTS,
    content: { template: "modules/campaign-record/templates/media/view.hbs" }
  };

  _onRender(context, options) {
    super._onRender(context, options);
    this.bindRowInputs("images");
  }

  static async #onAddImage() {
    const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
    const picker = new FilePickerImpl({
      type: "image",
      callback: (path) =>
        this.updateRows("images", (rows) =>
          rows.push({ id: foundry.utils.randomID(), src: path, caption: "" })
        )
    });
    picker.render(true);
  }

  static async #onDeleteImage(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    await this.updateRows("images", (rows) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    });
  }

  static async #onMoveImage(event, target) {
    const id = target.closest("[data-row-id]").dataset.rowId;
    const dir = Number(target.dataset.dir);
    await this.updateRows("images", (rows) => {
      const i = rows.findIndex((r) => r.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= rows.length) return;
      [rows[i], rows[j]] = [rows[j], rows[i]];
    });
  }
}
