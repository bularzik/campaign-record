import { getGroups } from "../../data/groups.mjs";
import { RECORD_TYPES, typeId } from "../../constants.mjs";
import { collectRecords, isIndexablePage } from "./hub-data.mjs";

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
    position: { width: 760, height: 640 },
    actions: {
      openRecord: CampaignHub.#onOpenRecord,
      newRecord: CampaignHub.#onNewRecord,
      filterType: CampaignHub.#onFilterType,
      toggleHiddenOnly: CampaignHub.#onToggleHiddenOnly
    }
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

  #hookHandlers = [];

  #registerDocHooks() {
    if (this.#hookHandlers.length) return;
    const hooks = [
      "createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage",
      "createJournalEntry", "updateJournalEntry", "deleteJournalEntry"
    ];
    for (const hook of hooks) {
      const id = Hooks.on(hook, (doc) => this._onDocumentChanged(hook, doc));
      this.#hookHandlers.push([hook, id]);
    }
  }

  #teardownHooks() {
    for (const [hook, id] of this.#hookHandlers) Hooks.off(hook, id);
    this.#hookHandlers = [];
  }

  #debouncedRender = foundry.utils.debounce(() => {
    if (this.rendered) this.render();
  }, 100);

  /** Task 7 extends this to patch the search index. */
  _onDocumentChanged(hook, doc) {
    this.#debouncedRender();
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.#registerDocHooks();
  }

  _onClose(options) {
    this.#teardownHooks();
    super._onClose(options);
  }

  #indexEntries() {
    let records = collectRecords({ groupId: this.state.groupId, user: game.user });
    if (this.state.types.size) records = records.filter((r) => this.state.types.has(r.shortType));
    if (this.state.tag) {
      const tag = this.state.tag.toLowerCase();
      records = records.filter((r) => r.tags.some((t) => t.toLowerCase().includes(tag)));
    }
    if (this.state.hiddenOnly) records = records.filter((r) => r.hidden);
    const sorters = {
      name: (a, b) => a.name.localeCompare(b.name),
      type: (a, b) => a.shortType.localeCompare(b.shortType) || a.name.localeCompare(b.name),
      updated: (a, b) => b.sortTime - a.sortTime
    };
    return records.sort(sorters[this.state.sort] ?? sorters.name);
  }

  static async #onOpenRecord(event, target) {
    const page = await fromUuid(target.closest("[data-uuid]").dataset.uuid);
    if (!page) return;
    const sheet = page.parent.sheet;
    await sheet.render(true);
    sheet.goToPage(page.id);
  }

  static async #onNewRecord() {
    const groups = getGroups();
    if (!groups.length) return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.NoGroups"));
    const current = this.state.groupId;
    const typeOptions = RECORD_TYPES.map((t) =>
      `<option value="${typeId(t)}">${game.i18n.localize(`TYPES.JournalEntryPage.${typeId(t)}`)}</option>`
    ).join("") + `<option value="text">${game.i18n.localize("CAMPAIGNRECORD.Hub.JournalPage")}</option>`;
    const groupOptions = groups.map((g) =>
      `<option value="${g.id}" ${g.id === current ? "selected" : ""}>${foundry.utils.escapeHTML(g.name)}</option>`
    ).join("");
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "CAMPAIGNRECORD.Hub.NewRecord" },
      content: `
        <div class="form-group"><label>${game.i18n.localize("CAMPAIGNRECORD.Hub.RecordName")}</label>
          <input type="text" name="name" required autofocus></div>
        <div class="form-group"><label>${game.i18n.localize("CAMPAIGNRECORD.Hub.RecordType")}</label>
          <select name="type">${typeOptions}</select></div>
        <div class="form-group"><label>${game.i18n.localize("CAMPAIGNRECORD.Hub.GroupPicker")}</label>
          <select name="group">${groupOptions}</select></div>`,
      ok: {
        label: "CAMPAIGNRECORD.Create",
        callback: (event, button) => ({
          name: button.form.elements.name.value.trim(),
          type: button.form.elements.type.value,
          groupId: button.form.elements.group.value
        })
      },
      rejectClose: false
    });
    if (!result?.name) return;
    const group = game.journal.get(result.groupId);
    const [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
      { name: result.name, type: result.type }
    ]);
    page.sheet.render(true);
  }

  static #onFilterType(event, target) {
    const type = target.dataset.type;
    if (this.state.types.has(type)) this.state.types.delete(type);
    else this.state.types.add(type);
    this.render();
  }

  static #onToggleHiddenOnly() {
    this.state.hiddenOnly = !this.state.hiddenOnly;
    this.render();
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.state = this.state;
    context.isGM = game.user.isGM;
    context.groups = getGroups().map((g) => ({
      id: g.id, name: g.name, selected: g.id === this.state.groupId
    }));
    context.allSelected = this.state.groupId === "all";
    context.records = this.#indexEntries();
    context.typeChips = [...RECORD_TYPES, "journal"].map((t) => ({
      type: t,
      label: t === "journal"
        ? game.i18n.localize("CAMPAIGNRECORD.Hub.JournalPage")
        : game.i18n.localize(`TYPES.JournalEntryPage.${typeId(t)}`),
      active: this.state.types.has(t)
    }));
    context.sortOptions = ["name", "type", "updated"].map((s) => ({
      value: s,
      label: game.i18n.localize(`CAMPAIGNRECORD.Hub.Sort.${s}`),
      selected: this.state.sort === s
    }));
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector('select[name="group-select"]')
      ?.addEventListener("change", (event) => {
        this.state.groupId = event.target.value;
        this.render();
      });
    this.element.querySelector('input[name="tag-filter"]')
      ?.addEventListener("change", (event) => {
        this.state.tag = event.target.value.trim();
        this.render();
      });
    this.element.querySelector('select[name="sort-select"]')
      ?.addEventListener("change", (event) => {
        this.state.sort = event.target.value;
        this.render();
      });
  }
}
