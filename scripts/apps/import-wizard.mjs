import { RECORD_TYPES, typeId } from "../constants.mjs";
import { getGroups, createGroup } from "../data/groups.mjs";
import { splitSections, suggestType, buildImportPlan, mergeSections, splitSectionAt } from "../logic/doc-import.mjs";
import { DOC_SOURCES } from "../integrations/doc-sources.mjs";
import * as Timepoints from "../data/timepoints.mjs";
import { parseImageDataUri, imageExtension, assignTimepoints } from "../logic/import-images.mjs";
import { fileMediaBatchToTimepoint } from "../hooks/auto-capture.mjs";
import { uploadHubMedia } from "./hub/media-upload.mjs";

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
      createImport: ImportWizard.#onCreate,
      mergeUp: ImportWizard.#onMergeUp,
      splitSection: ImportWizard.#onSplitSection
    }
  };

  static PARTS = {
    body: { template: "modules/campaign-record/templates/import/wizard.hbs" }
  };

  state = { step: "source", docTitle: null, sections: [], rows: [], groupId: null, groupName: null };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.isSource = this.state.step === "source";
    context.isReview = this.state.step === "review";
    context.sources = DOC_SOURCES;
    context.groupId = this.state.groupId;
    context.groups = getGroups().filter((g) => g.canUserModify(game.user, "update"))
      .map((g) => ({ id: g.id, name: g.name, selected: g.id === this.state.groupId }));
    context.groupName = this.state.groupName
      ?? this.state.docTitle
      ?? game.i18n.localize("CAMPAIGNRECORD.Import.Title");
    context.rows = this.state.rows.map((row, index) => ({
      ...row, index,
      canMergeUp: index > 0,
      canSplit: (this.state.sections[index]?.blocks?.length ?? 0) > 1,
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

  /** Read the per-row fields back out of the review form. */
  #formRows() {
    const form = this.element.querySelector("form.import-review");
    return this.state.rows.map((row, i) => ({
      ...row,
      title: form.elements[`title-${i}`].value.trim(),
      type: form.elements[`type-${i}`].value,
      timepoint: form.elements[`timepoint-${i}`].checked
    }));
  }

  #formGroup() {
    const form = this.element.querySelector("form.import-review");
    return {
      groupId: form.elements["target-group"].value || null,
      groupName: form.elements["group-name"].value.trim()
    };
  }

  /** Read the review form back into rows + group choice. */
  _readForm() {
    return { rows: this.#formRows(), ...this.#formGroup() };
  }

  static #onCancel() {
    this.close();
  }

  static #onBackToSource() {
    this.state = { step: "source", docTitle: null, sections: [], rows: [], groupId: null, groupName: null };
    this.render();
  }

  static #onMergeUp(event, target) {
    const index = Number(target.closest("[data-index]").dataset.index);
    if (index <= 0) return;
    this.state.rows = this.#formRows();
    Object.assign(this.state, this.#formGroup());
    this.state.sections = mergeSections(this.state.sections, index);
    this.state.rows.splice(index, 1);
    const merged = this.state.sections[index - 1];
    this.state.rows[index - 1] = {
      ...this.state.rows[index - 1],
      wordCount: merged.wordCount,
      preview: sectionPreview(merged.html)
    };
    this.render();
  }

  static async #onSplitSection(event, target) {
    const index = Number(target.closest("[data-index]").dataset.index);
    this.state.rows = this.#formRows();
    Object.assign(this.state, this.#formGroup());
    const cutIndices = await this.#promptSplit(this.state.sections[index]);
    if (!cutIndices?.length) return;
    const before = this.state.sections.length;
    this.state.sections = splitSectionAt(this.state.sections, index, cutIndices);
    const count = this.state.sections.length - before + 1;
    const original = this.state.rows[index];
    const newRows = [];
    for (let i = 0; i < count; i++) {
      const section = this.state.sections[index + i];
      newRows.push(i === 0
        ? { ...original, wordCount: section.wordCount, preview: sectionPreview(section.html) }
        : this.#rowFromSection(section));
    }
    this.state.rows.splice(index, 1, ...newRows);
    this.render();
  }

  async #promptSplit(section) {
    const blocks = section.blocks;
    if (blocks.length < 2) return null;
    const escapeHTML = foundry.utils.escapeHTML;
    const parts = blocks.map((html, i) => {
      const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
      const gap = i > 0
        ? `<label class="cr-split-gap"><input type="checkbox" name="cut-${i}"> `
          + `${game.i18n.localize("CAMPAIGNRECORD.Import.SplitHere")}</label>`
        : "";
      return `${gap}<p class="cr-split-block">${escapeHTML(text)}</p>`;
    });
    const content = `<div class="cr-split-modal">${parts.join("")}</div>`;
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format("CAMPAIGNRECORD.Import.SplitTitle", { title: section.title }) },
      modal: true,
      content,
      buttons: [
        { action: "cancel", label: "CAMPAIGNRECORD.Import.Cancel" },
        {
          action: "split", label: "CAMPAIGNRECORD.Import.SplitConfirm", default: true,
          callback: (event, button) => [...button.form.elements]
            .filter((el) => el.name?.startsWith("cut-") && el.checked)
            .map((el) => Number(el.name.slice(4)))
        }
      ],
      rejectClose: false
    });
    return Array.isArray(result) ? result : null;
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

      // Upload inline images once each (deduped across the whole document);
      // collect per-page refs for gallery filing.
      const uploadedByUri = new Map();
      for (const page of plan.pages) {
        const { html, images } = await uploadInlineImages(page.html, group, plan.warnings, uploadedByUri);
        page.html = html;
        page.images = images;
      }

      const payload = plan.pages.map((p) => p.type === "text"
        ? { name: p.name, type: "text",
            text: { content: p.html, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML } }
        : { name: p.name, type: typeId(p.type), system: { description: p.html } });
      const created = await group.createEmbeddedDocuments("JournalEntryPage", payload);

      // Create a timepoint per session page; record each page's own tp id (or null).
      const sessionTpIds = [];
      let timepoints = 0;
      for (let i = 0; i < plan.pages.length; i++) {
        if (!plan.pages[i].timepoint) { sessionTpIds.push(null); continue; }
        const tp = await Timepoints.addTimepoint(group, plan.pages[i].timepoint);
        const page = created[i];
        if (page) await Timepoints.addLink(group, tp.id, {
          uuid: page.uuid, name: page.name, type: "JournalEntryPage"
        });
        sessionTpIds.push(tp.id);
        timepoints++;
      }

      // File images into the nearest-preceding timepoint's gallery, batched per tp.
      const governing = assignTimepoints(sessionTpIds);
      const byTimepoint = new Map();
      plan.pages.forEach((page, i) => {
        const tpId = governing[i];
        if (!tpId || !page.images?.length) return;
        const entries = page.images.map((img) => ({ id: foundry.utils.randomID(), ...img }));
        byTimepoint.set(tpId, [...(byTimepoint.get(tpId) ?? []), ...entries]);
      });
      for (const [tpId, entries] of byTimepoint) {
        await fileMediaBatchToTimepoint(group, entries, tpId);
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

/**
 * Build an upload File from an image data-URI. Renderable types upload as-is;
 * unknown-but-decodable types transcode to PNG; undecodable types (EMF/WMF)
 * return { skipped: subtype }.
 */
async function dataUriToFile(uri, basename) {
  const parsed = parseImageDataUri(uri);
  if (!parsed) return { skipped: "unknown" };
  const bytes = Uint8Array.from(atob(parsed.base64), (c) => c.charCodeAt(0));
  const ext = imageExtension(parsed.subtype);
  if (ext) return { file: new File([bytes], `${basename}.${ext}`, { type: parsed.mime }) };
  // Not directly renderable — best-effort transcode to PNG (EMF/WMF will throw).
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: parsed.mime }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const png = await canvas.convertToBlob({ type: "image/png" });
    return { file: new File([await png.arrayBuffer()], `${basename}.png`, { type: "image/png" }) };
  } catch {
    return { skipped: parsed.subtype };
  }
}

/**
 * Upload each inline data-URI image once (mammoth inlines docx images), rewrite
 * srcs to the stored path, and return the collected {src, caption} refs for
 * gallery filing. Identical data-URIs upload once. Per-image failures drop that
 * image with a warning; other images are unaffected. `uploadedByUri` (data-URI ->
 * stored path or null) is supplied by the caller and shared across the whole
 * document, so identical images on different pages are also deduped.
 */
async function uploadInlineImages(html, group, warnings, uploadedByUri) {
  if (!html?.includes("data:image")) return { html, images: [] };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const imgs = [...doc.body.querySelectorAll('img[src^="data:"]')];
  if (!imgs.length) return { html, images: [] };

  const images = [];
  let uploadFailed = false;
  let n = 0;
  for (const img of imgs) {
    const uri = img.getAttribute("src");
    if (!uploadedByUri.has(uri)) {
      const result = await dataUriToFile(uri, `import-${Date.now()}-${++n}`);
      let path = null;
      if (result.skipped) {
        warnings.push(game.i18n.format("CAMPAIGNRECORD.Import.ImageTypeUnsupported", { type: result.skipped }));
      } else {
        try {
          path = await uploadHubMedia(group, result.file);
        } catch (error) {
          console.warn("campaign-record | inline image upload failed", error);
          uploadFailed = true;
        }
      }
      uploadedByUri.set(uri, path);
    }
    const path = uploadedByUri.get(uri);
    if (path) {
      img.setAttribute("src", path);
      const caption = (img.getAttribute("alt") ?? "").trim();
      images.push({ src: path, caption });
    } else {
      img.remove();
    }
  }

  if (uploadFailed) warnings.push(game.i18n.localize("CAMPAIGNRECORD.Import.ImagesDropped"));

  // Dedupe refs by src so the same image inline twice yields one gallery entry.
  const seen = new Set();
  const uniqueImages = images.filter((i) => (seen.has(i.src) ? false : seen.add(i.src)));
  return { html: doc.body.innerHTML, images: uniqueImages };
}
