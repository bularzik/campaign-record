import { MODULE_ID, RECORD_TYPES, typeId } from "../constants.mjs";
import { snapshotToDocModel, replaceUuidTags } from "../logic/doc-export.mjs";
import { isRecordVisible } from "../logic/visibility.mjs";
import { loadVendorGlobal } from "../integrations/vendor-loader.mjs";
import * as Timepoints from "../data/timepoints.mjs";

const KIND_BY_TYPE = Object.fromEntries(RECORD_TYPES.map((t) => [typeId(t), t]));

function pageSnapshot(page) {
  const kind = KIND_BY_TYPE[page.type] ?? (page.type === "text" ? "text" : null);
  if (!kind) return null; // other core page types (image/pdf/video) are not exported
  return {
    name: page.name,
    kind,
    hidden: page.system?.hidden === true,
    system: kind === "text" ? null : page.system.toObject(),
    html: kind === "text" ? (page.text?.content ?? "") : (page.system.description ?? "")
  };
}

function groupSnapshot(group, includeGM) {
  const pages = group.pages.contents
    .filter((p) => includeGM || isRecordVisible(game.user, p))
    .map(pageSnapshot).filter(Boolean);
  const timeline = Timepoints.getTimepoints(group).map((tp) => ({
    label: tp.label,
    items: [
      ...Timepoints.recordsAtTimepoint(group, tp.id, game.user).map((p) => p.name),
      ...Timepoints.resolveLinks(tp, game.user).map((l) => l.name).filter(Boolean)
    ]
  }));
  return { name: group.name, timeline, records: pages };
}

/** Prompt for options and export a whole group. */
export async function exportGroupDialog(group) {
  const includeGM = await promptOptions(group.name);
  if (includeGM === null) return;
  await runExport(() => groupSnapshot(group, includeGM), includeGM, group.name);
}

/** Prompt for options and export a single record page. */
export async function exportRecordDialog(page) {
  const includeGM = await promptOptions(page.name);
  if (includeGM === null) return;
  const snapshot = pageSnapshot(page);
  if (!snapshot) return;
  await runExport(
    () => ({ name: page.name, timeline: null, records: [snapshot] }),
    includeGM, page.name
  );
}

async function promptOptions(name) {
  const gmToggle = game.user.isGM
    ? `<div class="form-group"><label>
        <input type="checkbox" name="includeGM">
        ${game.i18n.localize("CAMPAIGNRECORD.Export.IncludeGM")}</label></div>`
    : "";
  return foundry.applications.api.DialogV2.prompt({
    window: { title: "CAMPAIGNRECORD.Export.Title" },
    content: `<p><strong>${foundry.utils.escapeHTML(name)}</strong></p>${gmToggle}
      <p class="hint">${game.i18n.localize("CAMPAIGNRECORD.Export.GoogleHint")}</p>`,
    ok: {
      label: "CAMPAIGNRECORD.Export.Download",
      callback: (event, button) => button.form.elements.includeGM?.checked === true
    },
    rejectClose: false
  }).then((result) => (result === undefined || result === null ? null : result));
}

async function runExport(buildSnapshot, includeGM, name) {
  try {
    const nodes = snapshotToDocModel(buildSnapshot(), {
      includeGM,
      parse: (html) => new DOMParser().parseFromString(replaceUuidTags(html), "text/html").body,
      i18n: (k) => game.i18n.localize(k)
    });
    const blob = await renderDocx(nodes);
    downloadBlob(blob, `${name.slugify({ strict: true }) || "campaign-record"}.docx`);
    ui.notifications.info(game.i18n.format("CAMPAIGNRECORD.Export.Done", { name }));
  } catch (error) {
    console.error("campaign-record | export failed", error);
    ui.notifications.error(game.i18n.localize("CAMPAIGNRECORD.Export.Failed"));
  }
}

/** Fetch an image and measure it; null on any failure (caption fallback). */
async function fetchImage(src) {
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const bitmap = await createImageBitmap(new Blob([buffer]));
    const scale = Math.min(1, 480 / bitmap.width);
    const ext = src.split("?")[0].split(".").pop()?.toLowerCase();
    return {
      data: buffer,
      type: ext === "jpeg" ? "jpg" : (["png", "jpg", "gif", "bmp"].includes(ext) ? ext : "png"),
      width: Math.round(bitmap.width * scale),
      height: Math.round(bitmap.height * scale)
    };
  } catch {
    return null;
  }
}

async function renderDocx(nodes) {
  const docx = await loadVendorGlobal("docx.iife.js", "docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink,
    Table, TableRow, TableCell, ImageRun, WidthType } = docx;

  const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

  // The doc model represents a <br> as a run whose text contains "\n". Split
  // each run's text on "\n" into one TextRun per segment, with `break: 1`
  // (a line break before the text) on every segment after the first. A run
  // whose text is exactly "\n" becomes a single empty-text TextRun with
  // `break: 1`. Formatting flags apply to every segment; hyperlink wrapping
  // applies to the whole set of segments for that run.
  const toRuns = (runs) => runs.map((r) => {
    const segments = r.text.split("\n").map((text, i) => new TextRun({
      text, bold: r.bold, italics: r.italics,
      underline: r.underline ? {} : undefined, strike: r.strike,
      break: i > 0 ? 1 : undefined
    }));
    return r.link ? new ExternalHyperlink({ children: segments, link: r.link }) : segments;
  }).flat();

  const children = [];
  for (const node of nodes) {
    if (node.kind === "heading") {
      children.push(new Paragraph({ text: node.text, heading: HEADINGS[node.level - 1] }));
    } else if (node.kind === "paragraph") {
      children.push(new Paragraph({
        children: toRuns(node.runs),
        style: node.style === "subtitle" ? "IntenseQuote" : undefined
      }));
    } else if (node.kind === "list") {
      for (const item of node.items) {
        children.push(new Paragraph({
          children: toRuns(item.runs),
          bullet: node.ordered ? undefined : { level: item.level },
          numbering: node.ordered ? { reference: "cr-numbered", level: item.level } : undefined
        }));
      }
    } else if (node.kind === "table") {
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: node.rows.map((cells) => new TableRow({
          children: cells.map((runs) => new TableCell({
            children: [new Paragraph({ children: toRuns(runs) })]
          }))
        }))
      }));
    } else if (node.kind === "image") {
      const image = await fetchImage(node.src);
      if (image) {
        children.push(new Paragraph({
          children: [new ImageRun({
            type: image.type, data: image.data,
            transformation: { width: image.width, height: image.height }
          })]
        }));
        if (node.caption) children.push(new Paragraph({
          children: [new TextRun({ text: node.caption, italics: true })]
        }));
      } else {
        children.push(new Paragraph({
          children: [new TextRun({
            text: node.caption || node.src.split("/").pop(), italics: true
          })]
        }));
      }
    }
  }

  const doc = new Document({
    numbering: {
      config: [{
        reference: "cr-numbered",
        levels: [0, 1, 2].map((level) => ({
          level, format: "decimal", text: `%${level + 1}.`, alignment: "left"
        }))
      }]
    },
    sections: [{ children }]
  });
  return Packer.toBlob(doc);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
