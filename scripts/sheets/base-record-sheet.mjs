import { setRecordHidden } from "../data/groups.mjs";
import { promptSelectActor } from "../apps/actor-picker.mjs";

const { JournalEntryPageHandlebarsSheet } = foundry.applications.sheets.journal;
const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;

/** Shared behavior for all Campaign Record page sheets. */
export class BaseRecordSheet extends JournalEntryPageHandlebarsSheet {
  static DEFAULT_OPTIONS = {
    classes: ["campaign-record", "record-sheet"],
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      toggleHidden: BaseRecordSheet.#onToggleHidden,
      linkActor: BaseRecordSheet.#onLinkActor
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

  /**
   * Drag-free actor linking: players can't drag Actors from the sidebar
   * (core requires TOKEN_CREATE), so a picker feeds the same drop handler.
   */
  static async #onLinkActor() {
    const uuid = await promptSelectActor();
    if (uuid) await this._onDropDocument({ type: "Actor", uuid });
  }

  static async #onToggleHidden() {
    if (!game.user.isGM) return;
    await setRecordHidden(this.document, !this.document.system.hidden);
  }

  /** Read, mutate, and write an array field as one targeted update. */
  async updateRows(field, mutate) {
    const rows = this.document.system.toObject()[field];
    mutate(rows);
    await this.document.update({ [`system.${field}`]: rows });
  }

  /**
   * Persist edits from inputs marked data-row-field inside [data-row-id] rows.
   * Inputs carry no name= — form serialization would corrupt the ArrayField.
   */
  bindRowInputs(field) {
    for (const input of this.element.querySelectorAll(`[data-rows="${field}"] [data-row-field]`)) {
      input.addEventListener("change", (event) => {
        event.stopPropagation();
        const rowEl = event.currentTarget.closest("[data-row-id]");
        if (!rowEl) return;
        const id = rowEl.dataset.rowId;
        const key = event.currentTarget.dataset.rowField;
        let value;
        if (event.currentTarget.type === "number") {
          // A cleared or non-numeric input coerces to 0 via Number(""), which
          // can silently persist an unintended value or, where the schema
          // rejects it (e.g. min: 1), throw from document.update. Skip the
          // write and re-render so the input snaps back to the persisted value.
          if (event.currentTarget.value === "") return this.render();
          const num = Number(event.currentTarget.value);
          if (!Number.isFinite(num)) return this.render();
          value = num;
        } else {
          value = event.currentTarget.value;
        }
        this.updateRows(field, (rows) => {
          const row = rows.find((r) => r.id === id);
          if (row) row[key] = value;
        }).catch((error) => {
          console.warn("campaign-record | row update rejected; resyncing sheet", error);
          this.render();
        });
      });
    }
  }
}
