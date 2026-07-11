/** Pure navigation-history state for the hub record pane. */

export function createHistory() {
  return { entries: [{ kind: "index" }], cursor: 0 };
}

export function currentEntry(history) {
  return history.entries[history.cursor];
}

function entriesEqual(a, b) {
  return a.kind === b.kind && a.uuid === b.uuid;
}

/** Append an entry after the cursor, dropping forward history. No-op if equal to current. */
export function pushEntry(history, entry) {
  if (entriesEqual(currentEntry(history), entry)) return;
  history.entries = history.entries.slice(0, history.cursor + 1);
  history.entries.push(entry);
  history.cursor = history.entries.length - 1;
}

export function canGoBack(history) {
  return history.cursor > 0;
}

export function canGoForward(history) {
  return history.cursor < history.entries.length - 1;
}

export function goBack(history) {
  if (!canGoBack(history)) return null;
  history.cursor -= 1;
  return currentEntry(history);
}

export function goForward(history) {
  if (!canGoForward(history)) return null;
  history.cursor += 1;
  return currentEntry(history);
}

/** Remove all entries for a deleted page; collapse resulting adjacent duplicates. */
export function pruneUuid(history, uuid) {
  const kept = [];
  let cursor = 0;
  history.entries.forEach((entry, i) => {
    const doomed = entry.kind === "record" && entry.uuid === uuid;
    const duplicate = kept.length && !doomed && entriesEqual(kept[kept.length - 1], entry);
    if (!doomed && !duplicate) kept.push(entry);
    // The cursor lands on the nearest surviving entry at-or-before its old position.
    if (i === history.cursor) cursor = kept.length ? kept.length - 1 : 0;
  });
  history.entries = kept.length ? kept : [{ kind: "index" }];
  history.cursor = Math.min(cursor, history.entries.length - 1);
}
