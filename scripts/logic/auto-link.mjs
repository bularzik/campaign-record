// scripts/logic/auto-link.mjs

/**
 * Split HTML into ordered, lossless segments. Only "text" segments are scanned
 * for name mentions; "tag", "link" (existing @UUID shorthand or <a> anchor), and
 * "code" segments are opaque passthrough so we never nest or double-link.
 */
export function tokenizeHtml(html) {
  const specials = [
    { type: "link", re: /@UUID\[[^\]]*\]\{[^}]*\}/y },
    { type: "link", re: /<a\b[^>]*>[\s\S]*?<\/a>/iy },
    { type: "code", re: /<code\b[^>]*>[\s\S]*?<\/code>/iy },
    { type: "code", re: /<pre\b[^>]*>[\s\S]*?<\/pre>/iy },
    { type: "tag", re: /<[^>]+>/y }
  ];
  const segs = [];
  let i = 0;
  let textStart = 0;
  while (i < html.length) {
    let hit = null;
    for (const s of specials) {
      s.re.lastIndex = i;
      const m = s.re.exec(html);
      if (m && m.index === i) {
        hit = { type: s.type, raw: m[0] };
        break;
      }
    }
    if (hit) {
      if (i > textStart) segs.push({ type: "text", raw: html.slice(textStart, i) });
      segs.push(hit);
      i += hit.raw.length;
      textStart = i;
    } else {
      i++;
    }
  }
  if (i > textStart) segs.push({ type: "text", raw: html.slice(textStart) });
  return segs;
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/** Ordered visible words from "text" segments, with their in-segment offsets. */
export function extractWords(segs) {
  const words = [];
  segs.forEach((seg, segIndex) => {
    if (seg.type !== "text") return;
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(seg.raw))) {
      words.push({ text: m[0], segIndex, start: m.index, end: m.index + m[0].length });
    }
  });
  return words;
}

/**
 * LCS alignment of lowercased words. Returns a boolean per newWord: true when it
 * is not part of the longest common subsequence with baseWords (i.e. inserted).
 */
export function diffAddedWordFlags(baseWords, newWords) {
  const a = baseWords.map((w) => w.toLowerCase());
  const b = newWords.map((w) => w.toLowerCase());
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const added = new Array(m).fill(true);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      added[j] = false;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return added;
}
