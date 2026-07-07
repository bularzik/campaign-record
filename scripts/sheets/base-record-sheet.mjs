import { setRecordHidden } from "../data/groups.mjs";

const { JournalEntryPageHandlebarsSheet } = foundry.applications.sheets.journal;
const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

/** Shared behavior for all Campaign Record page sheets. */
export class BaseRecordSheet extends JournalEntryPageHandlebarsSheet {
  static DEFAULT_OPTIONS = {
    classes: ["campaign-record", "record-sheet"],
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      toggleHidden: BaseRecordSheet.#onToggleHidden
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    context.page = this.document;
    context.system = system;
    context.systemFields = system.schema.fields;
    context.isGM = game.user.isGM;
    context.enriched = {
      description: await TextEditorImpl.enrichHTML(system.description, {
        relativeTo: this.document
      }),
      gmNotes: game.user.isGM
        ? await TextEditorImpl.enrichHTML(system.gmNotes, { relativeTo: this.document })
        : ""
    };
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".campaign-record-drop",
      callbacks: { drop: this.#onDrop.bind(this) }
    }).bind(this.element);
  }

  async #onDrop(event) {
    const data = TextEditorImpl.getDragEventData(event);
    return this._onDropDocument(data);
  }

  /** Subclasses override to accept dropped documents ({type, uuid}). */
  async _onDropDocument(data) {}

  static async #onToggleHidden() {
    if (!game.user.isGM) return;
    await setRecordHidden(this.document, !this.document.system.hidden);
  }
}
