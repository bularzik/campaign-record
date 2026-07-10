import { RECORD_TYPES, typeId } from "../constants.mjs";
import { getGroups } from "../data/groups.mjs";
import { splitSections, suggestType } from "../logic/doc-import.mjs";
import { DOC_SOURCES } from "../integrations/doc-sources.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ImportWizard extends HandlebarsApplicationMixin(ApplicationV2) {
  static open() {
    new ImportWizard().render({ force: true });
  }

  static DEFAULT_OPTIONS = {
    id: "campaign-record-import",
    classes: ["campaign-record", "import-wizard-app"],
    window: { title: "CAMPAIGNRECORD.Import.Title", icon: "fa-solid fa-file-import" },
    position: { width: 640, height: "auto" },
    actions: {
      backToSource: ImportWizard.#onBackToSource,
      createImport: ImportWizard.#onCreate
    }
  };

  static PARTS = {
    body: { template: "modules/campaign-record/templates/import/wizard.hbs" }
  };

  state = { step: "source", docTitle: null, sections: [], rows: [] };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.isSource = this.state.step === "source";
    context.isReview = this.state.step === "review";
    context.sources = DOC_SOURCES;
    context.groups = getGroups().filter((g) => g.canUserModify(game.user, "update"))
      .map((g) => ({ id: g.id, name: g.name }));
    context.groupName = this.state.docTitle
      ?? game.i18n.localize("CAMPAIGNRECORD.Import.Title");
    context.rows = this.state.rows.map((row, index) => ({
      ...row, index,
      typeOptions: this.#typeOptions(row.type)
    }));
    return context;
  }

  #typeOptions(selected) {
    const options = [
      { value: "text", label: game.i18n.localize("CAMPAIGNRECORD.Import.TypeText") },
      ...RECORD_TYPES.map((t) => ({
        value: t, label: game.i18n.localize(`TYPES.JournalEntryPage.${typeId(t)}`)
      })),
      { value: "merge", label: game.i18n.localize("CAMPAIGNRECORD.Import.TypeMerge") },
      { value: "skip", label: game.i18n.localize("CAMPAIGNRECORD.Import.TypeSkip") }
    ];
    return options.map((o) => ({ ...o, selected: o.value === selected }));
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const input of this.element.querySelectorAll('.import-source input[type="file"]')) {
      input.addEventListener("change", (event) => {
        const sourceId = event.target.closest("[data-source-id]").dataset.sourceId;
        const file = event.target.files?.[0];
        if (file) this.#onFileChosen(sourceId, file);
      });
    }
  }

  async #onFileChosen(sourceId, file) {
    const source = DOC_SOURCES.find((s) => s.id === sourceId);
    let parsed;
    try {
      parsed = await source.parse(file);
    } catch (error) {
      console.error("campaign-record | docx parse failed", error);
      return ui.notifications.error(game.i18n.localize("CAMPAIGNRECORD.Import.ParseError"));
    }
    const root = new DOMParser().parseFromString(parsed.html, "text/html").body;
    const { title, sections } = splitSections(root);
    if (!sections.length) {
      return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Import.NoSections"));
    }
    this.state.docTitle = title ?? file.name.replace(/\.docx$/i, "");
    this.state.sections = sections;
    this.state.rows = sections.map((section) => ({
      title: section.title === "Introduction"
        ? game.i18n.localize("CAMPAIGNRECORD.Import.Introduction")
        : section.title,
      type: section.empty ? "skip" : suggestType(section, RECORD_TYPES).type,
      timepoint: section.isSession,
      date: section.date,
      wordCount: section.wordCount,
      preview: section.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)
    }));
    this.state.step = "review";
    this.render();
  }

  /** Read the review form back into rows. */
  _readForm() {
    const form = this.element.querySelector("form.import-review");
    const rows = this.state.rows.map((row, i) => ({
      ...row,
      title: form.elements[`title-${i}`].value.trim(),
      type: form.elements[`type-${i}`].value,
      timepoint: form.elements[`timepoint-${i}`].checked
    }));
    return {
      rows,
      groupId: form.elements["target-group"].value || null,
      groupName: form.elements["group-name"].value.trim()
    };
  }

  static #onBackToSource() {
    this.state = { step: "source", docTitle: null, sections: [], rows: [] };
    this.render();
  }

  static async #onCreate() {
    console.log("campaign-record | import creation wired in the next task");
  }
}
