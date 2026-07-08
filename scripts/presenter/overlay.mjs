// The socket↔overlay import cycle is safe: both modules only reference each
// other's bindings inside function bodies, never at module-evaluation time.
import { broadcastPresenterMessage } from "./socket.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Fullscreen borderless image overlay, one singleton per client. */
export class MediaOverlay extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance = null;

  #state = null;
  #timer = null;

  static DEFAULT_OPTIONS = {
    id: "campaign-record-overlay",
    classes: ["campaign-record", "media-overlay"],
    window: { frame: false, positioned: false },
    actions: {
      dismissOverlay: MediaOverlay.#onDismiss,
      stepImage: MediaOverlay.#onStepImage,
      endPresentation: MediaOverlay.#onEndPresentation
    }
  };

  static PARTS = {
    overlay: { template: "modules/campaign-record/templates/presenter/overlay.hbs" }
  };

  static show(state) {
    this.#instance ??= new MediaOverlay();
    const app = this.#instance;
    app.#state = state;
    app.render({ force: true });
    app.#restartTimer();
  }

  /** Update the current index; renders only if this client still shows the overlay. */
  static goTo(index) {
    const app = this.#instance;
    if (!app?.#state || index >= app.#state.images.length) return;
    app.#state.index = index;
    if (app.rendered) app.render();
    // manual steps and resyncs restart the auto-advance countdown
    if (app.isPresenter && app.#state.interval) app.#restartTimer();
  }

  static endForAll() {
    const app = this.#instance;
    if (!app) return;
    app.#stopTimer();
    app.#state = null;
    if (app.rendered) app.close();
  }

  static activePresenterId() {
    return this.#instance?.#state?.presenterId ?? null;
  }

  /** A late joiner asked for state: the active presenter re-broadcasts it. */
  static answerSyncRequest() {
    const app = this.#instance;
    if (!app?.#state || !app.isPresenter) return;
    broadcastPresenterMessage({ ...app.#state, action: "show" });
  }

  get isPresenter() {
    return this.#state?.presenterId === game.user.id;
  }

  #restartTimer() {
    this.#stopTimer();
    if (!this.#state?.interval || !this.isPresenter) return;
    this.#timer = setInterval(() => {
      const next = (this.#state.index + 1) % this.#state.images.length;
      broadcastPresenterMessage({ action: "goto", index: next, presenterId: this.#state.presenterId });
    }, this.#state.interval * 1000);
  }

  #stopTimer() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = this.#state ?? { images: [], index: 0 };
    context.image = state.images[state.index] ?? null;
    context.isPresenter = this.isPresenter;
    context.position = `${state.index + 1} / ${state.images.length}`;
    return context;
  }

  /** The presenter dismissing their own overlay ends for everyone (they are
   *  the driver); a viewer's dismiss closes only their own overlay. */
  static async #onDismiss() {
    if (this.isPresenter && this.#state) {
      return void broadcastPresenterMessage({ action: "end", presenterId: this.#state.presenterId });
    }
    this.#stopTimer();
    await this.close();
  }

  static #onStepImage(event, target) {
    if (!this.isPresenter || !this.#state) return;
    const count = this.#state.images.length;
    const next = (this.#state.index + Number(target.dataset.dir) + count) % count;
    broadcastPresenterMessage({ action: "goto", index: next, presenterId: this.#state.presenterId });
  }

  static #onEndPresentation() {
    if (!this.isPresenter) return;
    broadcastPresenterMessage({ action: "end", presenterId: this.#state.presenterId });
  }

  _onClose(options) {
    this.#stopTimer();
    super._onClose(options);
  }
}
