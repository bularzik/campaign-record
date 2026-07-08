import { getGroups } from "../../data/groups.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CampaignHub extends HandlebarsApplicationMixin(ApplicationV2) {
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
    id: "campaign-hub",
    classes: ["campaign-record", "campaign-hub"],
    window: { title: "CAMPAIGNRECORD.Hub.Title", resizable: true, icon: "fa-solid fa-book-atlas" },
    position: { width: 760, height: 640 }
  };

  static PARTS = {
    header: { template: "modules/campaign-record/templates/hub/header.hbs" },
    index: { template: "modules/campaign-record/templates/hub/index.hbs" },
    timeline: { template: "modules/campaign-record/templates/hub/timeline.hbs" },
    search: { template: "modules/campaign-record/templates/hub/search.hbs" }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "index", icon: "fa-solid fa-list" },
        { id: "timeline", icon: "fa-solid fa-timeline" },
        { id: "search", icon: "fa-solid fa-magnifying-glass" }
      ],
      initial: "index",
      labelPrefix: "CAMPAIGNRECORD.Hub.Tabs"
    }
  };

  state = { groupId: "all", types: new Set(), tag: "", hiddenOnly: false, sort: "name", query: "" };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.state = this.state;
    context.isGM = game.user.isGM;
    context.groups = getGroups().map((g) => ({
      id: g.id, name: g.name, selected: g.id === this.state.groupId
    }));
    context.allSelected = this.state.groupId === "all";
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector('select[name="group-select"]')
      ?.addEventListener("change", (event) => {
        this.state.groupId = event.target.value;
        this.render();
      });
  }
}
