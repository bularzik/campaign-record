import { RECORD_TYPES, typeId } from "../constants.mjs";
import { getGroups, createGroup } from "../data/groups.mjs";
import { splitSections, suggestType, buildImportPlan } from "../logic/doc-import.mjs";
import { DOC_SOURCES } from "../integrations/doc-sources.mjs";
import * as Timepoints from "../data/timepoints.mjs";

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
      cancel: ImportWizard.#onCancel,
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
    if (this.state.step === "review") {
      const groupSelect = this.element.querySelector('select[name="target-group"]');
      const groupNameInput = this.element.querySelector('input[name="group-name"]');
      if (groupSelect && groupNameInput) {
        if (!groupSelect.dataset.crBound) {
          groupSelect.dataset.crBound = "1";
          groupSelect.addEventListener("change", (event) => {
            groupNameInput.disabled = event.target.value !== "";
          });
        }
        groupNameInput.disabled = groupSelect.value !== "";
      }
    }
  }

  #rowFromSection(section) {
    return {
      title: section.title === "Introduction"
        ? game.i18n.localize("CAMPAIGNRECORD.Import.Introduction")
        : section.title,
      type: section.empty ? "skip" : suggestType(section, RECORD_TYPES).type,
      timepoint: section.isSession,
      date: section.date,
      wordCount: section.wordCount,
      preview: sectionPreview(section.html)
    };
  }

  #setReading(on) {
    for (const input of this.element.querySelectorAll('.import-source input[type="file"]')) {
      input.disabled = on;
    }
    const status = this.element.querySelector(".cr-reading");
    if (status) status.hidden = !on;
  }

  async #onFileChosen(sourceId, file) {
    this.#setReading(true);
    const source = DOC_SOURCES.find((s) => s.id === sourceId);
    let parsed;
    try {
      parsed = await source.parse(file);
    } catch (error) {
      console.error("campaign-record | docx parse failed", error);
      this.#setReading(false);
      return ui.notifications.error(game.i18n.localize("CAMPAIGNRECORD.Import.ParseError"));
    }
    const root = new DOMParser().parseFromString(parsed.html, "text/html").body;
    const { title, sections } = splitSections(root);
    if (!sections.length) {
      this.#setReading(false);
      return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Import.NoSections"));
    }
    this.state.docTitle = title ?? file.name.replace(/\.docx$/i, "");
    this.state.sections = sections;
    this.state.rows = sections.map((section) => this.#rowFromSection(section));
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

  static #onCancel() {
    this.close();
  }

  static #onBackToSource() {
    this.state = { step: "source", docTitle: null, sections: [], rows: [] };
    this.render();
  }

  // Spec deviation, deliberate: unparseable session dates are surfaced as a
  // missing date next to the timepoint checkbox in the review table rather
  // than as a post-import warning notification.
  static async #onCreate(event, target) {
    const { rows, groupId, groupName } = this._readForm();
    let plan;
    try {
      plan = buildImportPlan(this.state.sections, rows, RECORD_TYPES);
    } catch (error) {
      console.error("campaign-record | import plan failed", error);
      return ui.notifications.error(game.i18n.localize("CAMPAIGNRECORD.Import.ParseError"));
    }
    if (!plan.pages.length) {
      return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Import.NothingToImport"));
    }
    target.disabled = true;
    try {
      const group = groupId
        ? game.journal.get(groupId)
        : await createGroup(groupName || this.state.docTitle || "Imported Document");
      if (!group) throw new Error(`group ${groupId} not found`);

      const slug = group.name.slugify({ strict: true }) || "import";
      for (const page of plan.pages) {
        page.html = await uploadDataUriImages(page.html, slug, plan.warnings);
      }

      const payload = plan.pages.map((p) => p.type === "text"
        ? { name: p.name, type: "text",
            text: { content: p.html, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML } }
        : { name: p.name, type: typeId(p.type), system: { description: p.html } });
      const created = await group.createEmbeddedDocuments("JournalEntryPage", payload);

      let timepoints = 0;
      for (let i = 0; i < plan.pages.length; i++) {
        if (!plan.pages[i].timepoint) continue;
        const tp = await Timepoints.addTimepoint(group, plan.pages[i].timepoint);
        const page = created[i];
        // Text pages have no system.timepoints; they attach as document links.
        if (page?.system?.schema?.fields?.timepoints) await Timepoints.attachRecord(page, tp.id);
        else if (page) await Timepoints.addLink(group, tp.id, {
          uuid: page.uuid, name: page.name, type: "JournalEntryPage"
        });
        timepoints++;
      }

      ui.notifications.info(game.i18n.format("CAMPAIGNRECORD.Import.Created", {
        pages: created.length, timepoints, group: group.name
      }));
      for (const warning of plan.warnings) ui.notifications.warn(warning, { console: false });
      this.close();
      group.sheet.render(true);
    } catch (error) {
      console.error("campaign-record | import failed", error);
      ui.notifications.error(game.i18n.localize("CAMPAIGNRECORD.Import.CreateFailed"));
      return;
    } finally {
      target.disabled = false;
    }
  }
}

function sectionPreview(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function dataUriToFile(uri, basename) {
  const match = uri.match(/^data:(image\/(\w+));base64,(.+)$/);
  if (!match) return null;
  const bytes = Uint8Array.from(atob(match[3]), (c) => c.charCodeAt(0));
  const ext = match[2] === "jpeg" ? "jpg" : match[2];
  return new File([bytes], `${basename}.${ext}`, { type: match[1] });
}

/**
 * Upload data-URI images (mammoth inlines docx images) to the user data dir
 * and rewrite srcs. On any failure the import proceeds without images.
 */
async function uploadDataUriImages(html, slug, warnings) {
  if (!html?.includes("data:image")) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const images = [...doc.body.querySelectorAll('img[src^="data:"]')];
  if (!images.length) return html;
  const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
  const dir = `campaign-record-imports/${slug}`;
  try {
    await FilePickerImpl.browse("data", dir)
      .catch(() => FilePickerImpl.createDirectory("data", dir));
    let n = 0;
    for (const img of images) {
      const file = dataUriToFile(img.src, `import-${Date.now()}-${++n}`);
      const result = file && await FilePickerImpl.upload("data", dir, file, {}, { notify: false });
      if (result?.path) img.setAttribute("src", result.path);
      else img.remove();
    }
  } catch (error) {
    console.warn("campaign-record | image upload failed; importing without images", error);
    for (const img of images) img.remove();
    warnings.push(game.i18n.localize("CAMPAIGNRECORD.Import.ImagesDropped"));
  }
  return doc.body.innerHTML;
}
