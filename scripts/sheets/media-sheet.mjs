import { BaseRecordSheet } from "./base-record-sheet.mjs";
import { broadcastPresenterMessage } from "../presenter/socket.mjs";

export class MediaSheet extends BaseRecordSheet {
  static DEFAULT_OPTIONS = {
    actions: {
      addImage: MediaSheet.#onAddImage,
      deleteImage: MediaSheet.#onDeleteImage,
      moveImage: MediaSheet.#onMoveImage,
      showImage: MediaSheet.#onShowImage,
      startSlideshow: MediaSheet.#onStartSlideshow,
      endPresentation: MediaSheet.#onEndPresentation
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

  /** Gallery rows that can actually present (blank-src rows would invalidate the payload). */
  #presentableImages() {
    return this.document.system.toObject().images.filter((i) => i.src);
  }

  /** Build a show payload from the given rows, or null (guards + warnings). */
  #presentPayload(images, index, interval) {
    if (!game.user.isGM) return null;
    if (this.document.system.hidden) {
      ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Media.CannotPresentHidden"));
      return null;
    }
    if (!images.length) {
      ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Presenter.NoImages"));
      return null;
    }
    return {
      action: "show",
      images: images.map((i) => ({ src: i.src, caption: i.caption })),
      index: Math.max(0, Math.min(index, images.length - 1)),
      presenterId: game.user.id,
      interval
    };
  }

  static #onShowImage(event, target) {
    const images = this.#presentableImages();
    const rowId = target.closest("[data-row-id]")?.dataset.rowId;
    const index = Math.max(0, images.findIndex((r) => r.id === rowId));
    const payload = this.#presentPayload(images, index, 0);
    if (payload) broadcastPresenterMessage(payload);
  }

  static #onStartSlideshow() {
    const payload = this.#presentPayload(this.#presentableImages(), 0, this.document.system.slideshowInterval);
    if (payload) broadcastPresenterMessage(payload);
  }

  static #onEndPresentation() {
    if (!game.user.isGM) return;
    broadcastPresenterMessage({ action: "end", presenterId: game.user.id });
  }
}
