import { getGroups } from "../../data/groups.mjs";
import { getTargetGroup, setTargetGroup } from "../../settings/auto-target.mjs";
import {
  MODULE_ID, RAIL_SETTING, INLINE_EDIT_SETTING, SNIPPETS_SETTING, RECORD_TYPES, typeId, GROUP_SHEET_CLASS,
  TIMELINE_ORDER_SETTING
} from "../../constants.mjs";
import { hasInlineFocus, shouldShowEditToggle } from "../../logic/inline-edit.mjs";
import { buildDoctypeFilter } from "../../logic/doctype-filter.mjs";
import { buildSortMenu } from "../../logic/sort-menu.mjs";
import { buildNewRecordGroupField } from "../../logic/new-record-form.mjs";
import { collectRecords, isIndexablePage, getScopedGroups, toSearchRecord } from "./hub-data.mjs";
import { createIndex, indexRecord, removeRecord, search } from "../../logic/search-index.mjs";
import { hasGroupFlag, isRecordVisible } from "../../logic/visibility.mjs";
import { classifyDropData, filenameFromSrc, recordDragPayload } from "../../logic/timeline-links.mjs";
import { classifyLinkTarget } from "../../logic/record-links.mjs";
import * as Timepoints from "../../data/timepoints.mjs";
import { getCalendarMonths, calendarBounds, hasCalendar, formatCampaignDate } from "../../logic/campaign-calendar.mjs";
import { parseCampaignDateInput, formatCreateDate } from "../../logic/campaign-date.mjs";
import { orderTimepoints } from "../../logic/timeline-sort.mjs";
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

    /** Name shown at the left of the header; null on the standalone hub (the group picker names it instead). */
    get headerTitle() {
      return null;
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
        clearFilters: HubBase.#onClearFilters,
        toggleSnippets: HubBase.#onToggleSnippets,
        setTimelineOrder: HubBase.#onSetTimelineOrder,
        addTimepoint: HubBase.#onAddTimepoint,
        editTimepoint: HubBase.#onEditTimepoint,
        deleteTimepoint: HubBase.#onDeleteTimepoint,
        openLink: HubBase.#onOpenLink,
        removeLink: HubBase.#onRemoveLink,
        toggleLinkShowPlayers: HubBase.#onToggleLinkShowPlayers,
        toggleInlineEdit: HubBase.#onToggleInlineEdit,
        paneBack: HubBase.#onPaneBack,
        paneForward: HubBase.#onPaneForward,
        toggleRail: HubBase.#onToggleRail,
        toggleEditMode: HubBase.#onToggleEditMode,
        toggleSettingsMenu: HubBase.#onToggleSettingsMenu,
        closeRecord: HubBase.#onCloseRecord
      }
    };

    static PARTS = {
      header: { template: "modules/campaign-record/templates/hub/header.hbs" },
      index: { template: "modules/campaign-record/templates/hub/index.hbs" },
      timeline: { template: "modules/campaign-record/templates/hub/timeline.hbs" },
      record: { template: "modules/campaign-record/templates/hub/record.hbs" }
    };

    state = {
      groupId: "all", types: new Set(), sort: "name", query: "",
      typeMenuOpen: false, settingsMenuOpen: false, sortMenuOpen: false
    };

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

    static async #onToggleSettingsMenu() {
      this.state.settingsMenuOpen = !this.state.settingsMenuOpen;
      await this.render({ parts: ["header"] });
    }

    /** Dismiss the record overlay and return to the index/timeline. */
    static async #onCloseRecord() {
      if (!this.state.view) return;
      this.state.view = null;
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
      this.state.typeMenuOpen = false;
      this.state.settingsMenuOpen = false;
      this.state.sortMenuOpen = false;
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
      const filtersActive = this.state.types.size > 0 || scopingClearable;
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
      const groupField = buildNewRecordGroupField(groups, current);
      const groupOptions = groupField.options.map((o) =>
        `<option value="${o.value}" ${o.selected ? "selected" : ""}>${foundry.utils.escapeHTML(o.label)}</option>`
      ).join("");
      const groupFormGroup = groupField.showGroupPicker
        ? `<div class="form-group"><label>${game.i18n.localize("CAMPAIGNRECORD.Hub.GroupPicker")}</label>
            <select name="group">${groupOptions}</select></div>`
        : "";
      const result = await foundry.applications.api.DialogV2.prompt({
        window: { title: "CAMPAIGNRECORD.Hub.NewRecord" },
        content: `
          <div class="form-group"><label>${game.i18n.localize("CAMPAIGNRECORD.Hub.RecordName")}</label>
            <input type="text" name="name" required autofocus></div>
          <div class="form-group"><label>${game.i18n.localize("CAMPAIGNRECORD.Hub.RecordType")}</label>
            <select name="type">${typeOptions}</select></div>
          ${groupFormGroup}`,
        ok: {
          label: "CAMPAIGNRECORD.Create",
          callback: (event, button) => ({
            name: button.form.elements.name.value.trim(),
            type: button.form.elements.type.value,
            groupId: button.form.elements.group?.value ?? this.groupScopeId
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
      await this.navigateToRecord(page.uuid);
    }

    static #onImportDocument() {
      ImportWizard.open();
    }

    static async #onExportGroup() {
      const group = game.journal.get(this.groupScopeId);
      if (!group) return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Export.SelectGroup"));
      await exportGroupDialog(group);
    }

    static #onClearFilters() {
      this.state.types.clear();
      if (this.showsGroupPicker) this.state.groupId = "all";
      this.render();
    }

    #timelineGroups() {
      const mode = game.settings.get(MODULE_ID, TIMELINE_ORDER_SETTING);
      return getScopedGroups(this.groupScopeId).map((group) => {
        const canEdit = group.canUserModify(game.user, "update");
        const ordered = orderTimepoints(Timepoints.getTimepoints(group), mode);
        return {
          id: group.id,
          name: group.name,
          canEdit,
          manualMode: mode === "manual",
          timepoints: ordered.map((tp, i) => ({
            ...tp,
            position: i,
            canEdit,
            dateLabel: mode === "campaign"
              ? formatCampaignDate(tp.campaignDate)
              : formatCreateDate(tp.createdAt),
            links: Timepoints.resolveLinks(tp, game.user).map((entry) => ({
              ...entry,
              broken: entry.kind === "broken",
              thumb: entry.img || null,
              canToggleVisibility: canEdit && game.user.isGM && entry.kind === "image"
            }))
          }))
        };
      });
    }

    /**
     * Prompt for a timepoint's label and optional campaign date. `initial` may
     * carry `{ label, campaignDate }`. Returns `{ label, campaignDate }` or null
     * when cancelled / on an invalid date (a warning is shown for the latter).
     */
    static async #promptTimepoint(initial = {}, { titleKey, okKey = "CAMPAIGNRECORD.Create" } = {}) {
      const label = initial.label ?? "";
      const cd = initial.campaignDate ?? null;
      const months = getCalendarMonths();
      const bounds = calendarBounds();
      const esc = foundry.utils.escapeHTML;

      const monthOptions = months.map((m) =>
        `<option value="${m.index}"${cd && cd.month === m.index ? " selected" : ""}>${esc(m.name)}</option>`
      ).join("");
      const timeValue = cd && cd.hour != null
        ? `${String(cd.hour).padStart(2, "0")}:${String(cd.minute ?? 0).padStart(2, "0")}` : "";

      const dateFields = hasCalendar() ? `
        <fieldset class="cr-campaign-date">
          <legend>${game.i18n.localize("CAMPAIGNRECORD.Hub.CampaignDate")}</legend>
          <div class="form-group">
            <label>${game.i18n.localize("CAMPAIGNRECORD.Hub.CampaignYear")}</label>
            <input type="number" name="year" value="${cd ? cd.year : ""}" step="1">
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("CAMPAIGNRECORD.Hub.CampaignMonth")}</label>
            <select name="month"><option value="">—</option>${monthOptions}</select>
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("CAMPAIGNRECORD.Hub.CampaignDay")}</label>
            <input type="number" name="day" value="${cd ? cd.day : ""}" min="1" step="1">
          </div>
          <div class="form-group">
            <label>${game.i18n.localize("CAMPAIGNRECORD.Hub.CampaignTime")}</label>
            <input type="text" name="time" value="${esc(timeValue)}" placeholder="HH:MM">
          </div>
        </fieldset>` : `<p class="notes">${game.i18n.localize("CAMPAIGNRECORD.Hub.CampaignDateUnavailable")}</p>`;

      return foundry.applications.api.DialogV2.prompt({
        window: { title: titleKey },
        content: `<div class="form-group">
            <label>${game.i18n.localize("CAMPAIGNRECORD.Hub.TimepointLabel")}</label>
            <input type="text" name="label" value="${esc(label)}" required autofocus>
          </div>${dateFields}`,
        ok: {
          label: okKey,
          callback: (event, button) => {
            const form = button.form.elements;
            const newLabel = form.label.value.trim();
            if (!newLabel) return null;
            if (!hasCalendar()) return { label: newLabel, campaignDate: undefined };
            const { components, error } = parseCampaignDateInput({
              year: form.year.value, month: form.month.value,
              day: form.day.value, time: form.time.value
            }, bounds);
            if (error) {
              ui.notifications.warn(game.i18n.localize(error));
              return null;
            }
            return { label: newLabel, campaignDate: components };
          }
        },
        rejectClose: false
      });
    }

    static async #onAddTimepoint(event, target) {
      const group = game.journal.get(target.closest("[data-group-id]").dataset.groupId);
      if (!group) return;
      const raw = Number(target.dataset.position);
      const position = target.dataset.position != null && Number.isInteger(raw) ? raw : null;
      const result = await HubBase.#promptTimepoint({}, { titleKey: "CAMPAIGNRECORD.Hub.AddTimepoint" });
      if (!result) return;
      await Timepoints.addTimepoint(group, result.label, position, result.campaignDate ?? null);
    }

    static async #onEditTimepoint(event, target) {
      const group = game.journal.get(target.closest("[data-group-id]").dataset.groupId);
      if (!group) return;
      const id = target.closest("[data-timepoint-id]").dataset.timepointId;
      const current = Timepoints.getTimepoints(group).find((t) => t.id === id);
      if (!current) return;
      const result = await HubBase.#promptTimepoint(
        { label: current.label, campaignDate: current.campaignDate ?? null },
        { titleKey: "CAMPAIGNRECORD.Hub.EditTimepoint", okKey: "CAMPAIGNRECORD.Hub.Save" }
      );
      if (!result) return;
      await Timepoints.editTimepoint(group, id, { label: result.label, campaignDate: result.campaignDate });
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

    static async #onToggleInlineEdit() {
      const current = game.settings.get(MODULE_ID, INLINE_EDIT_SETTING);
      // The setting's onChange re-renders every hub and record sheet.
      await game.settings.set(MODULE_ID, INLINE_EDIT_SETTING, !current);
    }

    static async #onToggleSnippets() {
      const current = game.settings.get(MODULE_ID, SNIPPETS_SETTING);
      await game.settings.set(MODULE_ID, SNIPPETS_SETTING, !current);
      await this.render({ parts: ["header", "index"] });
    }

    static async #onSetTimelineOrder(event, target) {
      const order = target.dataset.order;
      if (!["manual", "created", "campaign"].includes(order)) return;
      // The setting's onChange re-renders header + timeline for every open hub.
      await game.settings.set(MODULE_ID, TIMELINE_ORDER_SETTING, order);
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
        event.dataTransfer.setData("text/plain", JSON.stringify(recordDragPayload(recordRow.dataset.uuid)));
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
      const drop = classifyDropData(data, event.dataTransfer.getData("text/uri-list"));
      if (!drop) {
        return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.CannotAttach"));
      }
      if (drop.kind === "document") {
        const doc = await fromUuid(drop.uuid);
        if (!doc) {
          return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.CannotAttach"));
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
      context.headerTitle = this.headerTitle;
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
      context.hasActiveFilters = this.state.types.size > 0
        || (this.showsGroupPicker && this.state.groupId !== "all");
      context.doctypeFilter = buildDoctypeFilter(
        this.state.types,
        (t) => this.#typeLabel(t),
        game.i18n.localize("CAMPAIGNRECORD.Hub.AllTypesSummary")
      );
      context.typeMenuOpen = this.state.typeMenuOpen;
      context.sortMenu = buildSortMenu(
        this.state.sort,
        (s) => game.i18n.localize(`CAMPAIGNRECORD.Hub.Sort.${s}`)
      );
      context.sortMenuOpen = this.state.sortMenuOpen;
      context.timelineGroups = this.#timelineGroups();
      context.showDateColumn = game.settings.get(MODULE_ID, TIMELINE_ORDER_SETTING) !== "manual";
      context.inlineEditing = game.settings.get(MODULE_ID, INLINE_EDIT_SETTING);
      context.settingsMenuOpen = this.state.settingsMenuOpen;
      const orderMode = game.settings.get(MODULE_ID, TIMELINE_ORDER_SETTING);
      context.orderOptions = ["manual", "created", "campaign"].map((value) => ({
        value,
        label: game.i18n.localize(`CAMPAIGNRECORD.Hub.Order.${value}`),
        selected: orderMode === value
      }));
      const target = getTargetGroup();
      context.autoTargetNoneSelected = !target;
      context.autoTargetOptions = getGroups().map((g) => ({
        id: g.id, name: g.name, selected: g.id === target?.id
      }));
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
      if (this.state.view && viewedPage) {
        const canEdit = viewedPage.canUserModify(game.user, "update");
        const inlineEditableView =
          game.settings.get(MODULE_ID, INLINE_EDIT_SETTING) &&
          canEdit &&
          viewedPage.type.startsWith(`${MODULE_ID}.`) &&
          viewedPage.parent?.getFlag("core", "sheetClass") === GROUP_SHEET_CLASS;
        context.view = {
          name: viewedPage.name,
          editing: this.state.view.mode === "edit",
          canEdit,
          showEditToggle: shouldShowEditToggle({
            canEdit,
            inViewMode: this.state.view.mode !== "edit",
            inlineEditableView
          })
        };
      } else {
        context.view = null;
      }
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
      if (!this.element.dataset.crSortBound) {
        this.element.dataset.crSortBound = "1";
        this.element.addEventListener("click", (event) => {
          if (event.target.closest(".sort-summary")) {
            this.state.sortMenuOpen = !this.state.sortMenuOpen;
            return this.#renderList();
          }
          if (this.state.sortMenuOpen && !event.target.closest(".sort-filter")) {
            this.state.sortMenuOpen = false;
            this.#renderList();
          }
        });
        this.element.addEventListener("change", (event) => {
          const radio = event.target.closest('input[name="sort-select"]');
          if (!radio) return;
          this.state.sort = radio.value;
          this.state.sortMenuOpen = false;
          this.#renderList();
        });
      }
      const targetSelect = this.element.querySelector('select[name="auto-target-select"]');
      if (targetSelect && !targetSelect.dataset.crBound) {
        targetSelect.dataset.crBound = "1";
        targetSelect.addEventListener("change", async (event) => {
          await setTargetGroup(event.target.value);
        });
      }
      if (!this.element.dataset.crSettingsBound) {
        this.element.dataset.crSettingsBound = "1";
        this.element.addEventListener("click", (event) => {
          if (this.state.settingsMenuOpen && !event.target.closest(".hub-settings-menu")) {
            this.state.settingsMenuOpen = false;
            this.render({ parts: ["header"] });
          }
        });
      }
      if (!this.element.dataset.crTypeBound) {
        this.element.dataset.crTypeBound = "1";
        // Toggle the menu from its trigger; close it on any outside click.
        this.element.addEventListener("click", (event) => {
          if (event.target.closest(".doctype-summary")) {
            this.state.typeMenuOpen = !this.state.typeMenuOpen;
            return this.#renderList();
          }
          if (this.state.typeMenuOpen && !event.target.closest(".doctype-filter")) {
            this.state.typeMenuOpen = false;
            this.#renderList();
          }
        });
        // Check/uncheck a type; the menu stays open across the re-render.
        this.element.addEventListener("change", async (event) => {
          const cb = event.target.closest('input[name="doctype-check"]');
          if (!cb) return;
          const value = cb.value;
          if (cb.checked) this.state.types.add(value);
          else this.state.types.delete(value);
          await this.#renderList();
          // render({parts}) replaces this part's DOM — restore focus so keyboard
          // users can toggle several types without tabbing from the top each time.
          this.element.querySelector(`input[name="doctype-check"][value="${value}"]`)?.focus();
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
      // The timeline stays mounted (live) beneath an open record, but the
      // opaque overlay only blocks the mouse — keep its controls out of the
      // keyboard/AT reach while a record covers it.
      this.element.querySelector(".hub-timeline")?.toggleAttribute("inert", !!this.state.view);
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
