/**
 * Pure import logic: docx-derived HTML -> section tree -> creation plan.
 * No Foundry globals; DOM nodes are supplied by the caller.
 */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december"];

/** Trim a section title and strip bold markers Word/Docs leave fused to it. */
export function cleanTitle(text) {
  return (text ?? "").replace(/\*+/g, "").replace(/\s+/g, " ").trim().replace(/:$/, "");
}

/**
 * Session-header heuristic for short plain/bold lines that aren't headings:
 * "Arc N Session M <date>", "Session Zero <date>", "IN PERSON SESSION N",
 * "Out of Arc - ...". Long prose lines never match (word-count guard), and a
 * pattern match must also carry a parseable date or be a very short line
 * (<= 5 words) so prose sentences that open with a session phrase are rejected.
 */
export function detectSessionHeader(text) {
  const t = cleanTitle(text);
  if (!t || t.split(/\s+/).length > 12) return false;
  const matchesPattern = /^(?:arc\s*\d+\s*,?\s*)?session\s+(?:zero|\d+)\b/i.test(t)
    || /^in person session\s+\d+/i.test(t)
    || /^out of arc\b/i.test(t);
  if (!matchesPattern) return false;
  return parseSectionDate(t) !== null || t.split(/\s+/).length <= 5;
}

/** Extract an ISO date from a heading line; null when absent or invalid. */
export function parseSectionDate(text) {
  const t = text ?? "";
  const numeric = t.match(/(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?!\d)/);
  if (numeric) {
    const [, m, d, yRaw] = numeric.map(Number);
    if (String(numeric[3]).length === 3) return null;
    const y = yRaw < 100 ? 2000 + yRaw : yRaw;
    return toIsoDate(y, m, d);
  }
  const spelled = t.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i
  );
  if (spelled) {
    return toIsoDate(Number(spelled[3]), MONTHS.indexOf(spelled[1].toLowerCase()) + 1, Number(spelled[2]));
  }
  return null;
}

function toIsoDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const valid = date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  if (!valid) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const HEADING_LEVELS = { H1: 1, H2: 2, H3: 3 };

function isWhitespaceOnly(el) {
  return !(el.textContent ?? "").replace(/[\s ]/g, "").length;
}

/** True when all of a paragraph's text sits inside <strong>/<b>. */
function isFullyBold(el) {
  const text = (el.textContent ?? "").trim();
  if (!text) return false;
  const boldText = [...el.querySelectorAll("strong, b")]
    .map((b) => b.textContent).join("").trim();
  return boldText === text;
}

function sectionBoundary(el) {
  const level = HEADING_LEVELS[el.tagName];
  if (level) return { level };
  if (el.tagName === "P" && (isFullyBold(el) || !el.querySelector("*"))
      && detectSessionHeader(el.textContent)) {
    return { level: 0 };
  }
  return null;
}

/**
 * Split a docx-derived HTML body into sections at headings (h1-h3) and
 * session-header paragraphs. Returns the document title (leading h1, if any)
 * and sections with cleaned titles, dates, html, and word counts.
 */
export function splitSections(root) {
  const nodes = [...root.children].filter((el) => !isWhitespaceOnly(el) || el.tagName === "TABLE");
  let title = null;
  if (nodes[0]?.tagName === "H1") title = cleanTitle(nodes.shift().textContent);

  const sections = [];
  let current = null;
  const open = (heading, level) => {
    current = { title: cleanTitle(heading), level, htmlParts: [] };
    current.isSession = detectSessionHeader(heading);
    current.date = parseSectionDate(heading);
    sections.push(current);
  };

  for (const el of nodes) {
    const boundary = sectionBoundary(el);
    if (boundary) {
      open(el.textContent, boundary.level);
      continue;
    }
    if (!current) open("Introduction", 1), current.isSession = false, current.date = null;
    current.htmlParts.push(el.outerHTML);
  }

  return {
    title,
    sections: sections.map(({ htmlParts, ...s }) => {
      const html = htmlParts.join("\n");
      const text = htmlParts.join(" ").replace(/<[^>]+>/g, " ");
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      return { ...s, html, wordCount, empty: htmlParts.length === 0 };
    })
  };
}
