import { getGroups } from "../../data/groups.mjs";
import {
  MODULE_ID, THUMBNAILS_SETTING, RAIL_SETTING, INLINE_EDIT_SETTING, SNIPPETS_SETTING, RECORD_TYPES, typeId
} from "../../constants.mjs";
import { hasInlineFocus } from "../../logic/inline-edit.mjs";
import { buildDoctypeFilter } from "../../logic/doctype-filter.mjs";
import { collectRecords, isIndexablePage, getScopedGroups, toSearchRecord } from "./hub-data.mjs";
import { createIndex, indexRecord, removeRecord, search } from "../../logic/search-index.mjs";
import { hasGroupFlag, isRecordVisible } from "../../logic/visibility.mjs";
import { classifyDropData, filenameFromSrc } from "../../logic/timeline-links.mjs";
import { classifyLinkTarget } from "../../logic/record-links.mjs";
import * as Timepoints from "../../data/timepoints.mjs";
import { ImportWizard } from "../import-wizard.mjs";
import { exportGroupDialog } from "../export-dialog.mjs";
import { RecordPane } from "./record-pane.mjs";
import {
  createHistory, pushEntry, canGoBack, canGoForward, goBack, goForward, pruneUuid
} from "./pane-history.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;

/** Shared Campaign Hub behavior for the standalone hub and the per-group sheet. */
export function HubMixin(Base) {
  class HubBase extends HandlebarsApplicationMixin(Base) {
    /** The group scope this hub renders: "all", or one group id. */
    get groupScopeId() {
      return this.state.groupId;
    }

    /** Whether the header shows the group dropdown. */
    get showsGroupPicker() {
      return true;
    }

    static DEFAULT_OPTIONS = {
      classes: ["campaign-record", "campaign-hub"],
      window: { title: "CAMPAIGNRECORD.Hub.Title", resizable: true, icon: "fa-solid fa-book-atlas" },
      position: { width: 960, height: 640 },
      actions: {
        openRecord: HubBase.#onOpenRecord,
        newRecord: HubBase.#onNewRecord,
        importDocument: HubBase.#onImportDocument,
        exportGroup: HubBase.#onExportGroup,
        toggleHiddenOnly: HubBase.#onToggleHiddenOnly,
        clearFilters: HubBase.#onClearFilters,
        removeType: HubBase.#onRemoveType,
        clearTypes: HubBase.#onClearTypes,
        toggleSnippets: HubBase.#onToggleSnippets,
        addTimepoint: HubBase.#onAddTimepoint,
        renameTimepoint: HubBase.#onRenameTimepoint,
        deleteTimepoint: HubBase.#onDeleteTimepoint,
        detachRecord: HubBase.#onDetachRecord,
        openLink: HubBase.#onOpenLink,
        removeLink: HubBase.#onRemoveLink,
        toggleLinkShowPlayers: HubBase.#onToggleLinkShowPlayers,
        toggleThumbnails: HubBase.#onToggleThumbnails,
        toggleInlineEdit: HubBase.#onToggleInlineEdit,
        paneBack: HubBase.#onPaneBack,
        paneForward: HubBase.#onPaneForward,
        toggleRail: HubBase.#onToggleRail,
        toggleEditMode: HubBase.#onToggleEditMode
      }
    };

    static PARTS = {
      header: { template: "modules/campaign-record/templates/hub/header.hbs" },
      index: { template: "modules/campaign-record/templates/hub/index.hbs" },
      timeline: { template: "modules/campaign-record/templates/hub/timeline.hbs" },
      record: { template: "modules/campaign-record/templates/hub/record.hbs" }
    };

    state = { groupId: "all", types: new Set(), hiddenOnly: false, sort: "name", query: "" };

    #history = createHistory();
    #pane = new RecordPane();

    /** The viewed page resolved from its uuid, or null. */
    #resolveViewedPage() {
      if (!this.state.view) return null;
      let doc = null;
      try {
        doc = fromUuidSync(this.state.view.uuid);
      } catch {
        // Not synchronously resolvable (e.g. compendium): treat as gone.
      }
      return doc?.documentName === "JournalEntryPage" ? doc : null;
    }

    async navigateToRecord(uuid, { mode = "view", pushHistory = true } = {}) {
      this.state.view = { uuid, mode };
      if (pushHistory) pushEntry(this.#history, { kind: "record", uuid });
      await this.render();
    }

    async navigateToIndex({ pushHistory = true } = {}) {
      this.state.view = null;
      if (pushHistory) pushEntry(this.#history, { kind: "index" });
      await this.render();
    }

    async #applyHistoryEntry(entry) {
      if (!entry) return;
      if (entry.kind === "index") return this.navigateToIndex({ pushHistory: false });
      return this.navigateToRecord(entry.uuid, { pushHistory: false });
    }

    static async #onPaneBack() {
      await this.#applyHistoryEntry(goBack(this.#history));
    }

    static async #onPaneForward() {
      await this.#applyHistoryEntry(goForward(this.#history));
    }

    static async #onToggleRail() {
      const current = game.settings.get(MODULE_ID, RAIL_SETTING);
      await game.settings.set(MODULE_ID, RAIL_SETTING, !current);
      this.render();
    }

    static async #onToggleEditMode() {
      if (!this.state.view) return;
      this.state.view.mode = this.state.view.mode === "edit" ? "view" : "edit";
      await this.render();
    }

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

    #deferredRender = null;

    /**
     * A hub re-render replaces the whole DOM and re-mounts the record pane,
     * which detaches any active always-open <prose-mirror> (its
     * disconnectedCallback saves + destroys the editor) and steals focus
     * mid-typing. Defer re-renders while the user is typing in an
     * inline-editable control INSIDE the pane mount; flushed on focusout.
     * The hub's own index-search input manages its own partial
     * re-render + refocus, so it must not defer.
     */
    async render(options = {}, _options = {}) {
      if (typeof options === "boolean") options = { force: options, ..._options };
      const mount = this.rendered ? this.element?.querySelector(".record-pane-mount") : null;
      if (mount && hasInlineFocus(mount)) {
        this.#deferredRender = foundry.utils.mergeObject(this.#deferredRender ?? {}, options, {
          inplace: false
        });
        return this;
      }
      return super.render(options, _options);
    }

    #flushDeferredRender() {
      if (!this.#deferredRender) return;
      const mount = this.element?.querySelector(".record-pane-mount");
      if (mount && hasInlineFocus(mount)) return;
      const options = this.#deferredRender;
      this.#deferredRender = null;
      this.render(options);
    }

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

    _onDocumentChanged(hook, doc) {
      if (
        this.#searchIndex &&
        doc.documentName === "JournalEntryPage" &&
        isIndexablePage(doc) &&
        hasGroupFlag(doc.parent?.flags)
      ) {
        if (hook === "deleteJournalEntryPage") removeRecord(this.#searchIndex, doc.uuid);
        else indexRecord(this.#searchIndex, toSearchRecord(doc));
      }
      // groups carry many pages; rebuild lazily rather than patching membership incrementally
      if (hook === "deleteJournalEntry" || hook === "createJournalEntry") this.#searchIndex = null;
      if (hook === "deleteJournalEntryPage" && this.state.view?.uuid === doc.uuid) {
        pruneUuid(this.#history, doc.uuid);
        this.state.view = null;
      }
      this.#debouncedRender();
    }

    _onFirstRender(context, options) {
      super._onFirstRender(context, options);
      this.#registerDocHooks();
    }

    /**
     * Core routes page content-links as `page.parent.sheet.render(true, {pageId, anchor})`
     * (`JournalEntryPage#_onClickDocumentLink`). Land that navigation in-pane instead of
     * letting the default sheet-open behavior run.
     *
     * This must happen in `_configureRenderOptions`, not `_preRender`: core's render()
     * builds the `_prepareContext` output *before* invoking `_preRender` (see
     * `ApplicationV2#render`), so mutating `state.view` inside `_preRender` would arrive
     * one render late — the very first paint (e.g. a not-yet-open group sheet opened via
     * a cross-group link) would show the index with no record-pane markup to mount into.
     * `_configureRenderOptions` runs before `_prepareContext`, so setting state there is
     * picked up by the context this same render pass builds.
     */
    _configureRenderOptions(options) {
      super._configureRenderOptions(options);
      if (options.pageId) {
        const page = this.document?.pages?.get(options.pageId);
        if (page) {
          this.state.view = { uuid: page.uuid, mode: "view" };
          pushEntry(this.#history, { kind: "record", uuid: page.uuid });
        }
        delete options.pageId; // consumed; must not re-trigger on later renders
      }
    }

    _onClose(options) {
      this.#searchIndex = null;
      this.#teardownHooks();
      this.#pane.close();
      // A closed hub reopens at the index — the previously viewed record and
      // its navigation history are session-scoped state, not something to
      // resume like the window position or the collapsed-rail client setting.
      this.state.view = null;
      this.#history = createHistory();
      super._onClose(options);
    }

    /** Re-render just the index part — never disturbs a mounted record pane. */
    #renderList() {
      return this.render({ parts: ["index"] });
    }

    #indexEntries() {
      const all = collectRecords({ groupId: this.groupScopeId, user: game.user });
      let records = all;
      let matchesByUuid = null;
      const query = (this.state.query ?? "").trim();
      if (query.length >= 2) {
        const hits = search(this.#ensureSearchIndex(), query, { gm: game.user.isGM });
        matchesByUuid = new Map(hits.map((h) => [h.uuid, h.matches]));
        records = records.filter((r) => matchesByUuid.has(r.uuid));
      }
      if (this.state.types.size) records = records.filter((r) => this.state.types.has(r.shortType));
      if (this.state.hiddenOnly) records = records.filter((r) => r.hidden);
      const sorters = {
        name: (a, b) => a.name.localeCompare(b.name),
        type: (a, b) => a.shortType.localeCompare(b.shortType) || a.name.localeCompare(b.name),
        updated: (a, b) => b.sortTime - a.sortTime
      };
      const sorted = records.sort(sorters[this.state.sort] ?? sorters.name);
      const withMatches = matchesByUuid
        ? sorted.map((r) => ({ ...r, matches: matchesByUuid.get(r.uuid) ?? [] }))
        : sorted;
      return { records: withMatches, total: all.length };
    }

    /** Human-readable label for a shortType, used for both filter chips and group headers. */
    #typeLabel(shortType) {
      return shortType === "journal"
        ? game.i18n.localize("CAMPAIGNRECORD.Hub.JournalPage")
        : game.i18n.localize(`TYPES.JournalEntryPage.${typeId(shortType)}`);
    }

    /** Count query matches hidden by the current clearable filters, 0 when none. */
    #otherGroupMatches(shownRecords) {
      const query = (this.state.query ?? "").trim();
      if (query.length < 2) return 0;
      const scopingClearable = this.showsGroupPicker && this.state.groupId !== "all";
      const filtersActive = this.state.types.size > 0 || this.state.hiddenOnly || scopingClearable;
      if (!filtersActive) return 0;
      // Records visible once clearable filters are reset: unscoped for the
      // standalone hub, still this group for a locked single-group sheet.
      const clearedScope = this.showsGroupPicker ? "all" : this.groupScopeId;
      const visibleCleared = new Set(
        collectRecords({ groupId: clearedScope, user: game.user }).map((r) => r.uuid)
      );
      const shown = new Set(shownRecords.map((r) => r.uuid));
      const hits = search(this.#ensureSearchIndex(), query, { gm: game.user.isGM });
      let count = 0;
      for (const h of hits) if (visibleCleared.has(h.uuid) && !shown.has(h.uuid)) count++;
      return count;
    }

    static async #onOpenRecord(event, target) {
      const page = await fromUuid(target.closest("[data-uuid]").dataset.uuid);
      if (!page) return;
      await this.navigateToRecord(page.uuid);
    }

    static async #onNewRecord() {
      const groups = getGroups();
      if (!groups.length) return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.NoGroups"));
      const current = this.groupScopeId;
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
      await this.navigateToRecord(page.uuid, { mode: "edit" });
    }

    static #onImportDocument() {
      ImportWizard.open();
    }

    static async #onExportGroup() {
      const group = game.journal.get(this.groupScopeId);
      if (!group) return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Export.SelectGroup"));
      await exportGroupDialog(group);
    }

    static #onToggleHiddenOnly() {
      this.state.hiddenOnly = !this.state.hiddenOnly;
      this.render();
    }

    static #onClearFilters() {
      this.state.types.clear();
      this.state.hiddenOnly = false;
      if (this.showsGroupPicker) this.state.groupId = "all";
      this.render();
    }

    static #onRemoveType(event, target) {
      this.state.types.delete(target.dataset.type);
      this.#renderList();
    }

    static #onClearTypes() {
      this.state.types.clear();
      this.#renderList();
    }

    #timelineGroups() {
      const thumbnails = game.settings.get(MODULE_ID, THUMBNAILS_SETTING);
      return getScopedGroups(this.groupScopeId).map((group) => {
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
            })),
            links: Timepoints.resolveLinks(tp, game.user).map((entry) => ({
              ...entry,
              broken: entry.kind === "broken",
              thumb: thumbnails && entry.img ? entry.img : null,
              canToggleVisibility: canEdit && game.user.isGM && entry.kind === "image"
            }))
          }))
        };
      });
    }

    static async #promptLabel(titleKey, initial = "", okKey = "CAMPAIGNRECORD.Create") {
      return foundry.applications.api.DialogV2.prompt({
        window: { title: titleKey },
        content: `<div class="form-group">
          <label>${game.i18n.localize("CAMPAIGNRECORD.Hub.TimepointLabel")}</label>
          <input type="text" name="label" value="${foundry.utils.escapeHTML(initial)}" required autofocus>
        </div>`,
        ok: {
          label: okKey,
          callback: (event, button) => button.form.elements.label.value.trim()
        },
        rejectClose: false
      });
    }

    static async #onAddTimepoint(event, target) {
      const group = game.journal.get(target.closest("[data-group-id]").dataset.groupId);
      if (!group) return;
      const raw = Number(target.dataset.position);
      const position = target.dataset.position != null && Number.isInteger(raw) ? raw : null;
      const label = await HubBase.#promptLabel("CAMPAIGNRECORD.Hub.AddTimepoint");
      if (!label) return;
      await Timepoints.addTimepoint(group, label, position);
    }

    static async #onRenameTimepoint(event, target) {
      const group = game.journal.get(target.closest("[data-group-id]").dataset.groupId);
      if (!group) return;
      const id = target.closest("[data-timepoint-id]").dataset.timepointId;
      const current = Timepoints.getTimepoints(group).find((t) => t.id === id)?.label ?? "";
      const label = await HubBase.#promptLabel(
        "CAMPAIGNRECORD.Hub.RenameTimepoint", current, "CAMPAIGNRECORD.Hub.Rename"
      );
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
      const id = target.closest("[data-timepoint-id]").dataset.timepointId;
      const page = await fromUuid(target.closest("[data-uuid]").dataset.uuid);
      if (page) await Timepoints.detachRecord(page, id);
    }

    static async #onOpenLink(event, target) {
      const chip = target.closest("[data-link-id]");
      const { uuid, src, name } = chip.dataset;
      if (src) {
        return new foundry.applications.apps.ImagePopout({ src, window: { title: name } }).render(true);
      }
      const doc = await fromUuid(uuid);
      if (!doc) return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.BrokenLink"));
      if (doc.documentName === "JournalEntryPage") {
        return this.navigateToRecord(doc.uuid);
      }
      doc.sheet.render(true);
    }

    static async #onRemoveLink(event, target) {
      const group = game.journal.get(target.closest("[data-group-id]").dataset.groupId);
      const timepointId = target.closest("[data-timepoint-id]").dataset.timepointId;
      const linkId = target.closest("[data-link-id]").dataset.linkId;
      if (group) await Timepoints.removeLink(group, timepointId, linkId);
    }

    static async #onToggleLinkShowPlayers(event, target) {
      const group = game.journal.get(target.closest("[data-group-id]").dataset.groupId);
      const timepointId = target.closest("[data-timepoint-id]").dataset.timepointId;
      const linkId = target.closest("[data-link-id]").dataset.linkId;
      if (group) await Timepoints.toggleLinkShowPlayers(group, timepointId, linkId);
    }

    static async #onToggleThumbnails() {
      const current = game.settings.get(MODULE_ID, THUMBNAILS_SETTING);
      await game.settings.set(MODULE_ID, THUMBNAILS_SETTING, !current);
      this.render();
    }

    static async #onToggleInlineEdit() {
      const current = game.settings.get(MODULE_ID, INLINE_EDIT_SETTING);
      // The setting's onChange re-renders every hub and record sheet.
      await game.settings.set(MODULE_ID, INLINE_EDIT_SETTING, !current);
    }

    static async #onToggleSnippets() {
      const current = game.settings.get(MODULE_ID, SNIPPETS_SETTING);
      await game.settings.set(MODULE_ID, SNIPPETS_SETTING, !current);
      await this.render({ parts: ["index"] });
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
        data = JSON.parse(event.dataTransfer.getData("text/plain")) ?? {};
      } catch {
        data = {};
      }
      const groupId = target.closest("[data-group-id]").dataset.groupId;
      const group = game.journal.get(groupId);
      const timepointId = target.dataset.timepointId;
      if (data.kind === "campaign-record.timepoint") {
        if (data.groupId !== groupId) return; // no cross-group reordering
        return Timepoints.moveTimepoint(group, data.id, Number(target.dataset.position));
      }
      if (data.kind === "campaign-record.record") {
        const page = await fromUuid(data.uuid);
        if (!page) return;
        if (page.parent.id !== groupId) {
          // Cross-group records attach as document links instead of warning.
          return this.#dropLink(group, timepointId, {
            uuid: page.uuid, name: page.name, type: "JournalEntryPage"
          });
        }
        if (!page.system?.schema?.fields?.timepoints) {
          return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.CannotAttach"));
        }
        return Timepoints.attachRecord(page, timepointId);
      }
      const drop = classifyDropData(data, event.dataTransfer.getData("text/uri-list"));
      if (!drop) {
        return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.CannotAttach"));
      }
      if (drop.kind === "document") {
        const doc = await fromUuid(drop.uuid);
        if (!doc) {
          return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.CannotAttach"));
        }
        // A same-group record page dropped via Foundry drag data uses the
        // record-attachment path so it stays a first-class record chip.
        if (doc.documentName === "JournalEntryPage" && doc.parent?.id === groupId
            && doc.system?.schema?.fields?.timepoints) {
          return Timepoints.attachRecord(doc, timepointId);
        }
        return this.#dropLink(group, timepointId, { uuid: drop.uuid, name: doc.name, type: drop.type });
      }
      const showPlayers = await foundry.applications.api.DialogV2.confirm({
        window: { title: "CAMPAIGNRECORD.Hub.ShowImageToPlayers" },
        content: `<p>${game.i18n.format("CAMPAIGNRECORD.Hub.ShowImageToPlayersPrompt", {
          name: foundry.utils.escapeHTML(filenameFromSrc(drop.src))
        })}</p>`,
        rejectClose: false
      });
      if (showPlayers === null) return; // dialog dismissed: cancel the drop
      return this.#dropLink(group, timepointId, {
        src: drop.src, name: filenameFromSrc(drop.src), showPlayers: showPlayers === true
      });
    }

    /** Permission-checked link attach shared by the drop paths. */
    async #dropLink(group, timepointId, link) {
      if (!group.canUserModify(game.user, "update")) {
        return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.CannotEditTimeline"));
      }
      await Timepoints.addLink(group, timepointId, link);
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      context.state = this.state;
      context.isGM = game.user.isGM;
      context.canImport = game.user.can("JOURNAL_CREATE");
      context.showGroupPicker = this.showsGroupPicker;
      context.groups = getGroups().map((g) => ({
        id: g.id, name: g.name, selected: g.id === this.state.groupId
      }));
      context.allSelected = this.state.groupId === "all";
      const { records, total } = this.#indexEntries();
      context.records = records.map((r) => ({
        ...r,
        current: this.state.view?.uuid === r.uuid
      }));
      context.grouped = this.state.sort === "type";
      if (context.grouped) {
        const groups = [];
        let last = null;
        for (const r of context.records) {
          if (!last || last.shortType !== r.shortType) {
            last = { shortType: r.shortType, label: this.#typeLabel(r.shortType), records: [] };
            groups.push(last);
          }
          last.records.push(r);
        }
        context.recordGroups = groups;
      }
      context.filteredCount = records.length;
      context.totalCount = total;
      context.otherGroupMatches = this.#otherGroupMatches(records);
      context.hasActiveFilters = this.state.types.size > 0 || this.state.hiddenOnly
        || (this.showsGroupPicker && this.state.groupId !== "all");
      context.doctypeFilter = buildDoctypeFilter(this.state.types, (t) => this.#typeLabel(t));
      context.sortOptions = ["name", "type", "updated"].map((s) => ({
        value: s,
        label: game.i18n.localize(`CAMPAIGNRECORD.Hub.Sort.${s}`),
        selected: this.state.sort === s
      }));
      context.timelineGroups = this.#timelineGroups();
      context.thumbnails = game.settings.get(MODULE_ID, THUMBNAILS_SETTING);
      context.inlineEditing = game.settings.get(MODULE_ID, INLINE_EDIT_SETTING);
      context.snippets = game.settings.get(MODULE_ID, SNIPPETS_SETTING);
      const viewedPage = this.#resolveViewedPage();
      const viewable = !!viewedPage
        && viewedPage.testUserPermission(game.user, "OBSERVER")
        && isRecordVisible(game.user, viewedPage);
      if (this.state.view && !viewable) {
        // Deleted, unresolvable, or not viewable by this user: fall back to the index.
        pruneUuid(this.#history, this.state.view.uuid);
        this.state.view = null;
      }
      context.canGoBack = canGoBack(this.#history);
      context.canGoForward = canGoForward(this.#history);
      context.view = this.state.view && viewedPage
        ? {
            name: viewedPage.name,
            editing: this.state.view.mode === "edit",
            canEdit: viewedPage.canUserModify(game.user, "update")
          }
        : null;
      return context;
    }

    _onRender(context, options) {
      super._onRender(context, options);
      if (!this.element.dataset.crFlushBound) {
        this.element.dataset.crFlushBound = "1";
        this.element.addEventListener("focusout", () => {
          // change handlers and the resulting update run after focusout — flush
          // on the next tick so a render deferred by this very blur isn't stranded.
          setTimeout(() => this.#flushDeferredRender(), 0);
        });
      }
      const groupSelect = this.element.querySelector('select[name="group-select"]');
      if (groupSelect && !groupSelect.dataset.crBound) {
        groupSelect.dataset.crBound = "1";
        groupSelect.addEventListener("change", (event) => {
          this.state.groupId = event.target.value;
          this.render();
        });
      }
      const indexSearch = this.element.querySelector('input[name="index-search"]');
      if (indexSearch && !indexSearch.dataset.crBound) {
        indexSearch.dataset.crBound = "1";
        indexSearch.addEventListener("input", foundry.utils.debounce(async (event) => {
          // A re-render (e.g. clear-filters) may have replaced this input while
          // the debounce was pending; its stale value must not win.
          if (!event.target.isConnected) return;
          this.state.query = event.target.value;
          await this.render({ parts: ["index"] });
          // render({parts}) replaces this part's DOM — restore focus to keep typing.
          const restored = this.element.querySelector('input[name="index-search"]');
          restored?.focus();
          restored?.setSelectionRange(restored.value.length, restored.value.length);
        }, 250));
      }
      const sortSelect = this.element.querySelector('select[name="sort-select"]');
      if (sortSelect && !sortSelect.dataset.crBound) {
        sortSelect.dataset.crBound = "1";
        sortSelect.addEventListener("change", (event) => {
          this.state.sort = event.target.value;
          this.#renderList();
        });
      }
      const typeAdd = this.element.querySelector("select.doctype-add");
      if (typeAdd && !typeAdd.dataset.crBound) {
        typeAdd.dataset.crBound = "1";
        typeAdd.addEventListener("change", (event) => {
          const type = event.target.value;
          if (!type) return;
          this.state.types.add(type);
          this.#renderList();
        });
      }
      if (!this.element.dataset.crLinkBound) {
        this.element.dataset.crLinkBound = "1";
        this.element.addEventListener(
          "click",
          (event) => {
            const link = event.target.closest("a.content-link[data-uuid]");
            if (!link) return;
            let doc;
            try {
              doc = fromUuidSync(link.dataset.uuid);
            } catch {
              return; // unresolvable synchronously: leave the click to Foundry's default handling
            }
            const target = classifyLinkTarget(doc);
            if (target.kind === "external") return; // Foundry's default handling
            event.preventDefault();
            event.stopPropagation();
            this.navigateToRecord(target.uuid);
          },
          true
        );
      }

      new foundry.applications.ux.DragDrop.implementation({
        dragSelector: "[data-drag-record], [data-drag-timepoint]",
        dropSelector: "[data-drop-timepoint]",
        callbacks: {
          dragstart: this.#onTimelineDragStart.bind(this),
          drop: this.#onTimelineDrop.bind(this)
        }
      }).bind(this.element);

      this.element.classList.toggle("rail-collapsed", game.settings.get(MODULE_ID, RAIL_SETTING));
      const mount = this.element.querySelector(".record-pane-mount");
      if (mount && this.state.view) {
        const page = this.#resolveViewedPage();
        if (page) {
          this.#pane.mount(mount, page, this.state.view.mode).catch((error) => {
            console.error("campaign-record | failed to render record pane", error);
            ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.RecordUnavailable"));
            this.navigateToIndex({ pushHistory: false });
          });
        }
      } else if (!this.state.view) {
        this.#pane.close().catch((error) => {
          console.error("campaign-record | failed to close record pane", error);
        });
      }
    }
  }
  return HubBase;
}
