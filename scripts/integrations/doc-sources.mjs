import { loadVendorGlobal } from "./vendor-loader.mjs";

async function parseDocx(file) {
  const mammoth = await loadVendorGlobal("mammoth.browser.min.js", "mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return { html: result.value, messages: result.messages ?? [] };
}

/**
 * Registered import sources. A future Google OAuth source slots in here
 * (id: "google-oauth") without wizard changes; today the google-docs entry
 * is the guided manual flow: download as .docx, then pick the file.
 */
export const DOC_SOURCES = [
  {
    id: "docx-file",
    labelKey: "CAMPAIGNRECORD.Import.SourceLocal",
    hintKey: "CAMPAIGNRECORD.Import.SourceLocalHint",
    accept: ".docx",
    parse: parseDocx
  }
];
