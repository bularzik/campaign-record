import { setRecordHidden } from "../data/groups.mjs";
import { promptSelectActor } from "../apps/actor-picker.mjs";
import { MODULE_ID, INLINE_EDIT_SETTING, GROUP_SHEET_CLASS } from "../constants.mjs";
import { computeInlineEdit, createDebouncedSaver, hasInlineFocus } from "../logic/inline-edit.mjs";

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

  #deferredRender = null;

  #proseSavers = [];

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.document.system;
    context.page = this.document;
    context.system = system;
    context.systemFields = system.schema.fields;
    context.isGM = game.user.isGM;
    context.inlineEdit = computeInlineEdit({
      enabled: game.settings.get(MODULE_ID, INLINE_EDIT_SETTING),
      canUpdate: this.document.canUserModify(game.user, "update"),
      isView: this.isView,
      inGroup: this.document.parent?.getFlag("core", "sheetClass") === GROUP_SHEET_CLASS
    });
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

  /**
   * While the user is focused in an inline-editable section, defer re-renders
   * (triggered by our own auto-saves or by remote updates) so the active
   * control isn't destroyed under the cursor. Flushed on focusout.
   */
  async render(options = {}, _options = {}) {
    if (typeof options === "boolean") options = { force: options, ..._options };
    if (this.isView && this.rendered && hasInlineFocus(this.element)) {
      this.#deferredRender = foundry.utils.mergeObject(this.#deferredRender ?? {}, options, {
        inplace: false
      });
      return this;
    }
    return super.render(options, _options);
  }

  #flushDeferredRender() {
    if (!this.#deferredRender || hasInlineFocus(this.element)) return;
    const options = this.#deferredRender;
    this.#deferredRender = null;
    this.render(options);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".campaign-record-drop",
      callbacks: { drop: this.#onDrop.bind(this) }
    }).bind(this.element);
    this.#bindInlineProse(context);
    if (this.isView && !this.element.dataset.crFlushBound) {
      this.element.dataset.crFlushBound = "1";
      this.element.addEventListener("focusout", () => {
        setTimeout(() => this.#flushDeferredRender(), 0);
      });
      this.element.addEventListener("change", (event) => this.#onInlineChange(event));
    }
  }

  /**
   * Auto-save plain named fields in the inline-editable view. Core builds
   * embedded view-mode page sheets with tag "div" (JournalEntrySheet
   * #getPageSheet), so the root is not a <form> and the submitOnChange
   * machinery never runs here. Without this handler the change would bubble
   * to the group journal's own <form> and be misapplied to the JournalEntry.
   */
  #onInlineChange(event) {
    const target = event.target;
    if (!target?.closest?.(".campaign-record-content.inline-edit")) return;
    // Nothing inside the inline view may reach the group journal's form.
    event.stopPropagation();
    if (target.tagName === "PROSE-MIRROR") return; // debounced saver owns prose
    const name = target.name;
    if (!name?.startsWith("system.")) return; // row inputs save via bindRowInputs
    let value;
    if (target.type === "checkbox") {
      value = target.checked;
    } else if (target.type === "number") {
      // Mirror bindRowInputs: never persist a coerced 0 from a cleared or
      // non-numeric input; re-render so the field snaps back.
      if (target.value === "") return this.render();
      const num = Number(target.value);
      if (!Number.isFinite(num)) return this.render();
      value = num;
    } else {
      value = target.value;
    }
    this.document.update({ [name]: value }).catch((error) => {
      console.warn("campaign-record | inline field save rejected; resyncing sheet", error);
      ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Warning.InlineSaveFailed"));
      this.render();
    });
  }

  /**
   * Debounced as-you-type persistence for always-open inline prose editors.
   * Mid-typing saves suppress re-renders everywhere ({render: false}) — other
   * active editors stay in sync through collaborative editing; the final
   * focusout save renders normally so passive viewers catch up.
   */
  #bindInlineProse(context) {
    for (const { saver } of this.#proseSavers) saver.cancel();
    this.#proseSavers = [];
    if (!context.inlineEdit) return;
    for (const el of this.element.querySelectorAll("prose-mirror[data-inline-prose]")) {
      const fieldName = el.name;
      const saver = createDebouncedSaver({
        save: (html, { quiet }) => {
          this.document.update({ [fieldName]: html }, { render: !quiet }).catch((error) => {
            console.warn("campaign-record | inline prose save rejected", error);
            ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Warning.InlineSaveFailed"));
          });
        }
      });
      saver.prime(foundry.utils.getProperty(this.document, fieldName) ?? "");
      this.#proseSavers.push({ saver, el });
      el.addEventListener("input", () => saver.schedule(() => el.value));
      el.addEventListener("focusout", () => saver.flush(() => el.value));
    }
  }

  /**
   * The sheet can be torn down without a focusout (e.g. Escape-close while
   * the caret is in a prose editor); flush any pending debounced save so
   * those last keystrokes aren't lost. flush() is the non-quiet path used on
   * focusout — right here too, since the sheet is going away and the final
   * save should render passive viewers. The identical-value skip makes
   * flushing an untouched editor a no-op.
   */
  async _preClose(options) {
    await super._preClose(options);
    for (const { saver, el } of this.#proseSavers) saver.flush(() => el.value);
    this.#proseSavers = [];
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

  /**
   * Drag-free actor linking: players can't drag Actors from the sidebar
   * (core requires TOKEN_CREATE), so a picker feeds the same drop handler.
   */
  static async #onLinkActor() {
    const uuid = await promptSelectActor();
    if (uuid) await this._onDropDocument({ type: "Actor", uuid });
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
