import { getGroups } from "../../data/groups.mjs";
import { RECORD_TYPES, typeId } from "../../constants.mjs";
import { collectRecords, isIndexablePage, getScopedGroups, toSearchRecord } from "./hub-data.mjs";
import { createIndex, indexRecord, removeRecord, search } from "../../logic/search-index.mjs";
import * as Timepoints from "../../data/timepoints.mjs";

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
      toggleHiddenOnly: CampaignHub.#onToggleHiddenOnly,
      addTimepoint: CampaignHub.#onAddTimepoint,
      renameTimepoint: CampaignHub.#onRenameTimepoint,
      deleteTimepoint: CampaignHub.#onDeleteTimepoint,
      detachRecord: CampaignHub.#onDetachRecord
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

  #searchIndex = null;

  #ensureSearchIndex() {
    if (this.#searchIndex) return this.#searchIndex;
    this.#searchIndex = createIndex();
    for (const group of getScopedGroups("all")) {
      for (const page of group.pages) {
        if (isIndexablePage(page)) indexRecord(this.#searchIndex, toSearchRecord(page));
      }
    }
    return this.#searchIndex;
  }

  #searchResults() {
    if (!this.state.query || this.state.query.length < 2) return [];
    const index = this.#ensureSearchIndex();
    const visible = new Map(
      collectRecords({ groupId: this.state.groupId, user: game.user }).map((r) => [r.uuid, r])
    );
    const hits = search(index, this.state.query, { gm: game.user.isGM })
      .filter((h) => visible.has(h.uuid))
      .map((h) => ({ ...h, entry: visible.get(h.uuid) }));
    const byType = new Map();
    for (const hit of hits) {
      const key = hit.entry.shortType;
      if (!byType.has(key)) {
        const label = key === "journal"
          ? game.i18n.localize("CAMPAIGNRECORD.Hub.JournalPage")
          : game.i18n.localize(`TYPES.JournalEntryPage.${typeId(key)}`);
        byType.set(key, { type: key, label, hits: [] });
      }
      byType.get(key).hits.push(hit);
    }
    return [...byType.values()];
  }

  _onDocumentChanged(hook, doc) {
    if (this.#searchIndex && doc.documentName === "JournalEntryPage" && isIndexablePage(doc)) {
      if (hook === "deleteJournalEntryPage") removeRecord(this.#searchIndex, doc.uuid);
      else indexRecord(this.#searchIndex, toSearchRecord(doc));
    }
    // groups carry many pages; rebuild lazily rather than patching membership incrementally
    if (hook === "deleteJournalEntry" || hook === "createJournalEntry") this.#searchIndex = null;
    this.#debouncedRender();
  }

  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.#registerDocHooks();
  }

  _onClose(options) {
    this.#searchIndex = null;
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
    if (!group) return;
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

  #timelineGroups() {
    return getScopedGroups(this.state.groupId).map((group) => {
      const canEdit = group.canUserModify(game.user, "update");
      return {
        id: group.id,
        name: group.name,
        canEdit,
        timepoints: Timepoints.getTimepoints(group).map((tp, i) => ({
          ...tp,
          position: i,
          canEdit,
          records: Timepoints.recordsAtTimepoint(group, tp.id, game.user).map((p) => ({
            uuid: p.uuid, name: p.name
          }))
        }))
      };
    });
  }

  static async #promptLabel(titleKey, initial = "") {
    return foundry.applications.api.DialogV2.prompt({
      window: { title: titleKey },
      content: `<div class="form-group">
        <label>${game.i18n.localize("CAMPAIGNRECORD.Hub.TimepointLabel")}</label>
        <input type="text" name="label" value="${foundry.utils.escapeHTML(initial)}" required autofocus>
      </div>`,
      ok: {
        label: "CAMPAIGNRECORD.Create",
        callback: (event, button) => button.form.elements.label.value.trim()
      },
      rejectClose: false
    });
  }

  static async #onAddTimepoint(event, target) {
    const group = game.journal.get(target.closest("[data-group-id]").dataset.groupId);
    if (!group) return;
    const position = target.dataset.position ? Number(target.dataset.position) : null;
    const label = await CampaignHub.#promptLabel("CAMPAIGNRECORD.Hub.AddTimepoint");
    if (!label) return;
    await Timepoints.addTimepoint(group, label, position);
  }

  static async #onRenameTimepoint(event, target) {
    const group = game.journal.get(target.closest("[data-group-id]").dataset.groupId);
    if (!group) return;
    const id = target.closest("[data-timepoint-id]").dataset.timepointId;
    const current = Timepoints.getTimepoints(group).find((t) => t.id === id)?.label ?? "";
    const label = await CampaignHub.#promptLabel("CAMPAIGNRECORD.Hub.RenameTimepoint", current);
    if (!label) return;
    await Timepoints.renameTimepoint(group, id, label);
  }

  static async #onDeleteTimepoint(event, target) {
    const group = game.journal.get(target.closest("[data-group-id]").dataset.groupId);
    if (!group) return;
    const id = target.closest("[data-timepoint-id]").dataset.timepointId;
    const label = Timepoints.getTimepoints(group).find((t) => t.id === id)?.label ?? "";
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "CAMPAIGNRECORD.Hub.DeleteTimepoint" },
      content: `<p>${game.i18n.format("CAMPAIGNRECORD.Hub.DeleteTimepointConfirmNamed", {
        label: foundry.utils.escapeHTML(label)
      })}</p>`
    });
    if (confirmed) await Timepoints.deleteTimepoint(group, id);
  }

  static async #onDetachRecord(event, target) {
    event.stopPropagation();
    const id = target.closest("[data-timepoint-id]").dataset.timepointId;
    const page = await fromUuid(target.closest("[data-record-uuid]").dataset.recordUuid);
    if (page) await Timepoints.detachRecord(page, id);
  }

  #onTimelineDragStart(event) {
    const tpRow = event.target.closest("[data-drag-timepoint]");
    const recordRow = event.target.closest("[data-drag-record]");
    if (tpRow) {
      event.dataTransfer.setData("text/plain", JSON.stringify({
        kind: "campaign-record.timepoint",
        id: tpRow.dataset.timepointId,
        groupId: tpRow.closest("[data-group-id]").dataset.groupId
      }));
    } else if (recordRow) {
      event.dataTransfer.setData("text/plain", JSON.stringify({
        kind: "campaign-record.record",
        uuid: recordRow.dataset.uuid
      }));
    }
  }

  async #onTimelineDrop(event) {
    const target = event.target.closest("[data-drop-timepoint]");
    if (!target) return;
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    const groupId = target.closest("[data-group-id]").dataset.groupId;
    const group = game.journal.get(groupId);
    if (data.kind === "campaign-record.timepoint") {
      if (data.groupId !== groupId) return; // no cross-group reordering
      await Timepoints.moveTimepoint(group, data.id, Number(target.dataset.position));
    } else if (data.kind === "campaign-record.record") {
      const page = await fromUuid(data.uuid);
      if (!page || page.parent.id !== groupId) {
        return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.WrongGroup"));
      }
      if (!page.system?.schema?.fields?.timepoints) {
        return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.CannotAttach"));
      }
      await Timepoints.attachRecord(page, target.dataset.timepointId);
    }
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
    context.searchGroups = this.#searchResults();
    context.timelineGroups = this.#timelineGroups();
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const groupSelect = this.element.querySelector('select[name="group-select"]');
    if (groupSelect && !groupSelect.dataset.crBound) {
      groupSelect.dataset.crBound = "1";
      groupSelect.addEventListener("change", (event) => {
        this.state.groupId = event.target.value;
        this.render();
      });
    }
    const tagFilter = this.element.querySelector('input[name="tag-filter"]');
    if (tagFilter && !tagFilter.dataset.crBound) {
      tagFilter.dataset.crBound = "1";
      tagFilter.addEventListener("change", (event) => {
        this.state.tag = event.target.value.trim();
        this.render();
      });
    }
    const sortSelect = this.element.querySelector('select[name="sort-select"]');
    if (sortSelect && !sortSelect.dataset.crBound) {
      sortSelect.dataset.crBound = "1";
      sortSelect.addEventListener("change", (event) => {
        this.state.sort = event.target.value;
        this.render();
      });
    }
    const searchInput = this.element.querySelector('input[name="search-query"]');
    searchInput?.addEventListener("input", foundry.utils.debounce(async (event) => {
      this.state.query = event.target.value;
      await this.render({ parts: ["search"] });
      const restored = this.element.querySelector('input[name="search-query"]');
      restored?.focus();
      restored?.setSelectionRange(restored.value.length, restored.value.length);
    }, 250));

    // Dragging a record from the Index tab needs a way to reach a Timeline
    // drop target while the tabs are mutually exclusive: hovering a tab's
    // nav link mid-drag switches to it.
    const tabNav = this.element.querySelector(".hub-header nav.tabs");
    if (tabNav && !tabNav.dataset.crBound) {
      tabNav.dataset.crBound = "1";
      for (const link of tabNav.querySelectorAll('a[data-action="tab"]')) {
        link.addEventListener("dragenter", () => {
          if (link.dataset.tab !== this.tabGroups.primary) this.changeTab(link.dataset.tab, "primary");
        });
      }
    }

    new foundry.applications.ux.DragDrop.implementation({
      dragSelector: "[data-drag-record], [data-drag-timepoint]",
      dropSelector: "[data-drop-timepoint]",
      callbacks: {
        dragstart: this.#onTimelineDragStart.bind(this),
        drop: this.#onTimelineDrop.bind(this)
      }
    }).bind(this.element);
  }
}
