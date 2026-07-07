/** Replace HTML tags with spaces so adjacent words don't fuse. */
export function stripHtml(html) {
  return String(html ?? "").replace(/<[^>]*>/g, " ");
}

/** Lowercased word tokens (letters/digits), length >= 2. */
export function tokenize(text) {
  return stripHtml(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
}

/**
 * Inverted index:
 * - tokens: Map<token, Map<uuid, Set<field>>>
 * - records: Map<uuid, { uuid, name, type, texts: {field: plainText}, gmOnly: Set<field> }>
 */
export function createIndex() {
  return { tokens: new Map(), records: new Map() };
}

export function indexRecord(index, record) {
  removeRecord(index, record.uuid);
  const fields = {
    name: record.name,
    tags: (record.tags ?? []).join(" "),
    ...(record.fields ?? {}),
    ...(record.gmFields ?? {})
  };
  const gmOnly = new Set(Object.keys(record.gmFields ?? {}));
  const texts = {};
  for (const [field, raw] of Object.entries(fields)) {
    const text = stripHtml(raw).replace(/\s+/g, " ").trim();
    if (!text) continue;
    texts[field] = text;
    for (const token of tokenize(text)) {
      let byUuid = index.tokens.get(token);
      if (!byUuid) index.tokens.set(token, (byUuid = new Map()));
      let fieldSet = byUuid.get(record.uuid);
      if (!fieldSet) byUuid.set(record.uuid, (fieldSet = new Set()));
      fieldSet.add(field);
    }
  }
  index.records.set(record.uuid, {
    uuid: record.uuid, name: record.name, type: record.type, texts, gmOnly
  });
}

export function removeRecord(index, uuid) {
  if (!index.records.delete(uuid)) return;
  for (const [token, byUuid] of index.tokens) {
    byUuid.delete(uuid);
    if (!byUuid.size) index.tokens.delete(token);
  }
}

function snippetFor(text, terms, radius = 40) {
  const lower = text.toLowerCase();
  let pos = -1;
  for (const t of terms) {
    pos = lower.indexOf(t);
    if (pos >= 0) break;
  }
  if (pos < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, pos - radius);
  const end = Math.min(text.length, pos + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function search(index, query, { gm = false } = {}) {
  const terms = tokenize(query);
  if (!terms.length) return [];
  let candidates = null;
  const fieldHits = new Map(); // uuid -> Set<field>
  for (const term of terms) {
    const termMatches = new Map();
    for (const [token, byUuid] of index.tokens) {
      if (!token.startsWith(term)) continue;
      for (const [uuid, fields] of byUuid) {
        let set = termMatches.get(uuid);
        if (!set) termMatches.set(uuid, (set = new Set()));
        for (const f of fields) set.add(f);
      }
    }
    candidates = candidates === null
      ? new Set(termMatches.keys())
      : new Set([...candidates].filter((u) => termMatches.has(u)));
    for (const [uuid, fields] of termMatches) {
      let set = fieldHits.get(uuid);
      if (!set) fieldHits.set(uuid, (set = new Set()));
      for (const f of fields) set.add(f);
    }
  }
  const results = [];
  for (const uuid of candidates) {
    const rec = index.records.get(uuid);
    const fields = [...(fieldHits.get(uuid) ?? [])].filter((f) => gm || !rec.gmOnly.has(f));
    if (!fields.length) continue;
    results.push({
      uuid, name: rec.name, type: rec.type,
      matches: fields.map((f) => ({ field: f, snippet: snippetFor(rec.texts[f], terms) }))
    });
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}
