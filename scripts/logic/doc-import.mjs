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
