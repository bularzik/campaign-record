import { HubMixin } from "./hub-mixin.mjs";

const { ApplicationV2 } = foundry.applications.api;

/** The standalone, cross-group Campaign Hub window (group dropdown, singleton). */
export class CampaignHub extends HubMixin(ApplicationV2) {
  static #instance = null;
  // `ApplicationV2#rendered` only flips once the close animation finishes,
  // so back-to-back toggle() calls (no await between them, e.g. a rapid
  // keybinding repeat) would both see `rendered === true` and both call
  // close(). Track intent synchronously instead.
  static #isOpen = false;

  static open() {
    this.#instance ??= new CampaignHub();
    this.#isOpen = true;
    this.#instance.render({ force: true });
    return this.#instance;
  }

  static toggle() {
    if (this.#isOpen) {
      this.#isOpen = false;
      this.#instance?.close();
    } else {
      this.open();
    }
  }

  static DEFAULT_OPTIONS = {
    id: "campaign-hub"
  };

  _onClose(options) {
    // Keep #isOpen in sync for closes that bypass toggle() (e.g. the
    // window's own close button). Guarded by `rendered` so a close that
    // resolves after a subsequent reopen doesn't clobber the new session.
    if (!this.rendered) CampaignHub.#isOpen = false;
    super._onClose(options);
  }
}
