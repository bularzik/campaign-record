import { HubMixin } from "./hub-mixin.mjs";

const { ApplicationV2 } = foundry.applications.api;

/** The standalone, cross-group Campaign Hub window (group dropdown, singleton). */
export class CampaignHub extends HubMixin(ApplicationV2) {
  static #instance = null;

  static open() {
    this.#instance ??= new CampaignHub();
    this.#instance.render({ force: true });
    return this.#instance;
  }

  static toggle() {
    if (this.#instance?.rendered) this.#instance.close();
    else this.open();
  }

  static DEFAULT_OPTIONS = {
    id: "campaign-hub"
  };
}
