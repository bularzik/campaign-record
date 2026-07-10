import { hasInlineFocus } from "../logic/inline-edit.mjs";

const { JournalEntrySheet } = foundry.applications.sheets.journal;

/**
 * Journal sheet for campaign groups. Defers re-renders while the user is
 * typing in an inline-editable record view so auto-saves (local or remote)
 * don't destroy the active control; flushes the deferred render on blur.
 */
export class CampaignGroupSheet extends JournalEntrySheet {
  #deferredRender = null;

  async render(options = {}, _options = {}) {
    if (typeof options === "boolean") options = { force: options, ..._options };
    if (this.rendered && hasInlineFocus(this.element)) {
      this.#deferredRender = foundry.utils.mergeObject(this.#deferredRender ?? {}, options, {
        inplace: false
      });
      return this;
    }
    return super.render(options, _options);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    if (this.element.dataset.crFlushBound) return;
    this.element.dataset.crFlushBound = "1";
    this.element.addEventListener("focusout", () => {
      // change handlers and the resulting update run after focusout — flush on
      // the next tick so a render deferred by this very blur isn't stranded.
      setTimeout(() => this.#flushDeferredRender(), 0);
    });
  }

  #flushDeferredRender() {
    if (!this.#deferredRender || hasInlineFocus(this.element)) return;
    const options = this.#deferredRender;
    this.#deferredRender = null;
    this.render(options);
  }
}
