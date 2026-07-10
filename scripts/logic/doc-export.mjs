/**
 * Pure export logic: record snapshots -> intermediate doc model.
 * Node kinds: heading, paragraph, list, table, image (see tests).
 * No Foundry globals; DOM nodes and i18n are supplied by the caller.
 */

/** Foundry @UUID enrichers are meaningless outside the VTT: keep the label. */
export function replaceUuidTags(html) {
  return (html ?? "")
    .replace(/@UUID\[[^\]]+\]\{([^}]*)\}/g, "<strong>$1</strong>")
    .replace(/@UUID\[([^\]]+)\]/g, (_, uuid) => `<strong>${uuid.split(".").pop()}</strong>`);
}

const INLINE_FLAGS = { STRONG: "bold", B: "bold", EM: "italics", I: "italics",
  U: "underline", S: "strike", STRIKE: "strike", DEL: "strike" };

/** Flatten an element's inline content into styled runs. */
function collectRuns(el, flags = {}) {
  const runs = [];
  for (const node of el.childNodes) {
    if (node.nodeType === 3) { // text
      const text = node.textContent.replace(/\s+/g, " ");
      if (text) runs.push({ text, ...flags });
    } else if (node.nodeType === 1) {
      if (node.tagName === "BR") { runs.push({ text: "\n", ...flags }); continue; }
      const next = { ...flags };
      const flag = INLINE_FLAGS[node.tagName];
      if (flag) next[flag] = true;
      if (node.tagName === "A" && node.getAttribute("href")) next.link = node.getAttribute("href");
      runs.push(...collectRuns(node, next));
    }
  }
  return runs;
}

function trimRuns(runs) {
  if (runs.length) {
    runs[0].text = runs[0].text.replace(/^\s+/, "");
    runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, "");
  }
  return runs.filter((r) => r.text);
}

function listItems(listEl, level, out) {
  for (const li of listEl.children) {
    if (li.tagName !== "LI") continue;
    const clone = li.cloneNode(true);
    for (const nested of clone.querySelectorAll("ul, ol")) nested.remove();
    out.push({ runs: trimRuns(collectRuns(clone)), level });
    for (const nested of li.children) {
      if (nested.tagName === "UL" || nested.tagName === "OL") listItems(nested, level + 1, out);
    }
  }
}

/** Convert a parsed HTML body into doc-model nodes. */
export function htmlToNodes(root, flags = {}) {
  const nodes = [];
  for (const el of root.children) {
    const heading = el.tagName.match(/^H([1-6])$/);
    if (heading) {
      const text = el.textContent.trim();
      if (text) nodes.push({ kind: "heading", level: Number(heading[1]), text });
    } else if (el.tagName === "P" || el.tagName === "PRE") {
      const runs = trimRuns(collectRuns(el, flags));
      // Intra-paragraph image position is not preserved: the paragraph's text
      // runs are emitted first, then one image node per <img> in document order.
      if (runs.length) nodes.push({ kind: "paragraph", runs });
      for (const img of el.querySelectorAll("img[src]")) {
        nodes.push({ kind: "image", src: img.getAttribute("src"), caption: img.getAttribute("alt") ?? "" });
      }
    } else if (el.tagName === "UL" || el.tagName === "OL") {
      // Known limitation: nested lists flatten under the OUTER list's ordered
      // flag — a nested <ol> inside a <ul> loses its orderedness (and vice versa).
      const items = [];
      listItems(el, 0, items);
      if (items.length) nodes.push({ kind: "list", ordered: el.tagName === "OL", items });
    } else if (el.tagName === "TABLE") {
      const rows = [...el.querySelectorAll("tr")].map((tr) =>
        [...tr.children].filter((c) => /^T[HD]$/.test(c.tagName))
          .map((cell) => trimRuns(collectRuns(cell))));
      if (rows.length) nodes.push({ kind: "table", rows });
    } else if (el.tagName === "IMG" && el.getAttribute("src")) {
      nodes.push({ kind: "image", src: el.getAttribute("src"), caption: el.getAttribute("alt") ?? "" });
    } else if (el.tagName === "BLOCKQUOTE") {
      nodes.push(...htmlToNodes(el, { ...flags, italics: true }));
    } else if (el.children.length) { // div and other wrappers: recurse
      nodes.push(...htmlToNodes(el, flags));
    } else {
      const runs = trimRuns(collectRuns(el, flags));
      if (runs.length) nodes.push({ kind: "paragraph", runs });
    }
  }
  return nodes;
}
