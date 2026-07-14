# Auto-link entry names on save — Design

**Date:** 2026-07-14
**Status:** Approved design; pending implementation plan

## Summary

When a Campaign Record entry is saved, scan the text the user added since
opening (or last linking) the field, find mentions of the names of *other*
entries in the same campaign record, and rewrite each mention as a content link
— identical to the link a drag-drop produces (`@UUID[…]{Name}`) — so it renders
and opens in-pane exactly like a manually dragged link.

The intent, in the user's words: "every time you save a journal entry, first
check to see if any of the newly added text matches the name of any entry. If it
does, make that text a link to that entry (as if it had been dragged into the
page)."

## Decisions (locked)

These were settled during brainstorming and are not open for re-litigation in the
plan:

1. **Scan scope — newly added text only.** Never retroactively link old prose and
   never re-link text the user deliberately left plain. The link pass diffs the
   saved content against a baseline and only touches inserted text.
2. **Match granularity — newly-added text spans.** Do a text-level diff; link only
   the name occurrences that fall inside inserted spans. A name already present in
   the baseline stays plain; a *new* occurrence of that same name (in added text)
   gets linked.
3. **Trigger — committed saves only.** Link on focus-out / close / explicit save /
   plain-text-page submit. Do **not** link on the mid-typing ~2s quiet autosave.
4. **Insertion model — stored-content rewrite.** Rewrite the prose string before it
   persists (via `preUpdateJournalEntryPage`). No live ProseMirror manipulation, no
   cursor risk. On a committed save the sheet re-renders, so the new link becomes
   visible in the editor immediately after.
5. **Match rule — case-insensitive, whole-word, all occurrences** within added
   spans. `gandalf`, `GANDALF`, and `Gandalf` all match entry `Gandalf`; matches
   never fire inside another word (no `Frodo` inside `Frodos`).
6. **Candidate scope — same campaign record only.** Only entries in the same group
   (campaign record) as the page being edited are linkable, and only those the
   acting user can currently see.
7. **Fields — all rich prose fields.** `system.description`, `system.gmNotes`,
   quest `system.rewards`, loot `system.distribution`, and plain text pages'
   `text.content`.

## Why these decisions (rationale worth keeping)

- **Baseline, not previous-stored-value.** The inline editor autosaves quietly every
  ~2s with `{ render: false }` (`base-record-sheet.mjs` `#bindInlineProse` →
  `inline-edit.mjs createDebouncedSaver`). By the time a committed save fires, the
  previously-stored value already contains most of what was typed. Diffing against
  it would miss any name typed more than ~2s before focus-out. So the diff baseline
  must be a snapshot taken *when the editable view rendered* (before typing), not
  the immediately-previous save.
- **Committed-save gate avoids drift.** Quiet saves don't re-render the open editor.
  If we rewrote stored content on a quiet save, the editor would still hold plain
  text and the next keystroke would clobber the injected link. Restricting linking
  to committed saves (which render) keeps stored content and editor content in sync.

## Architecture

Three pieces, following the module's existing "pure logic module + thin hook"
pattern (cf. `scripts/logic/*` + `scripts/hooks/*`).

### 1. Pure core — `scripts/logic/auto-link.mjs`

No Foundry globals; fully unit-testable in isolation like `search-index.mjs`.

- `diffAddedSpans(baselineHtml, newHtml)` → array of `{ start, end }` offset ranges
  in `newHtml`'s **visible text** that were inserted relative to `baselineHtml`.
  Implemented as a word-level diff of the extracted visible text, with a mapping
  from visible-text offsets back to positions in the raw `newHtml` string (so we
  can splice links into the HTML, skipping tags and existing links).
- `linkNames(newHtml, addedSpans, candidates)` → rewritten HTML. For each candidate
  `{ name, uuid }`, find whole-word, case-insensitive occurrences whose visible
  offset lies inside an added span, that are **not** already inside a link or code
  region, and wrap them as `@UUID[uuid]{Name}`. Constraints:
  - **Longest match wins** on overlap (`Waterdeep Harbor` beats `Waterdeep`); no
    overlapping links.
  - **Self-link skip**: the entry being edited is excluded by the caller (its uuid is
    not in `candidates`), so no self-links are produced.
  - Idempotent: re-running over already-linked output produces no change.

### 2. Candidate builder

Reuse the existing record enumeration (`hub-data.mjs collectRecords` / the hub
search index's `records` map) to produce, for the page's own group, a
`{ name, uuid }[]` list that:

- excludes the page being edited (self),
- excludes entries not visible to the acting user (`isRecordVisible`),
- excludes names shorter than 3 characters,
- is sorted longest-name-first (so `linkNames` can prefer longer matches).

### 3. Save interceptor — `scripts/hooks/auto-link.mjs`

`Hooks.on("preUpdateJournalEntryPage", (page, changes, options) => …)`, mirroring
`scripts/hooks/guards.mjs`.

- **Gate:** run only when `options.render !== false` (committed save). Quiet
  autosaves pass `render: false` and are skipped.
- For each changed prose field present in `changes`
  (`system.description`, `system.gmNotes`, `system.rewards`, `system.distribution`,
  `text.content`), compute `linkNames(diffAddedSpans(baseline, newValue), …)` and
  replace the value in `changes` in place.
- Resolve the page's group, build candidates, and look up the baseline (below).

### Baseline tracking

- **Typed records** (module sheets, subject to quiet autosaves): baseline is an
  in-memory snapshot captured when the editable view renders. Kept in a
  `Map` keyed by `"<page.uuid>:<field>"`, seeded/refreshed on each full render of
  the record sheet (a committed save triggers a render, so the baseline follows the
  now-linked content). Snapshotting hooks into the base record sheet's render path.
- **Plain text pages** (core sheet, submit-only, no quiet autosaves): baseline is
  simply the previously-stored value (`page.text.content` before the update). No
  snapshot map needed for this path.

## Data flow (typed record, happy path)

1. User opens a record in the hub pane → editable view renders → baseline snapshot
   `= current stored description` (already contains any existing links).
2. User types `Frodo joined us`. Quiet autosaves fire every ~2s, writing plain text
   to the stored doc with `render: false` — **no linking** (gated out).
3. User clicks away → flush save with `render: true` → `preUpdateJournalEntryPage`.
4. Interceptor diffs new content vs the open-time baseline → added span covers the
   typed text → finds `Frodo` (a candidate in this group) → rewrites to
   `@UUID[…]{Frodo}` in `changes.system.description`.
5. Update persists; sheet re-renders; `enrichHTML` turns the shorthand into an
   in-pane content link. Baseline refreshes to the linked content.

## Edge cases & defaults

| Case | Behavior |
|------|----------|
| Entry mentions its own name | Not linked (self excluded from candidates). |
| Mention already inside a link / `@UUID` / code | Skipped; no nesting or double-linking. |
| Overlapping candidate names | Longest name wins; no overlapping links. |
| Two entries share an exact name | Link to the first; log a warning. Known, tunable limitation. |
| Entry not visible to the editor | Not a candidate (no leaking hidden entries). |
| Name shorter than 3 chars | Not auto-linked (avoids pathological matches). |
| Pre-existing plain mention (in baseline) | Left untouched. |

## Format fidelity (implementation must verify)

The auto-linker's output must be **byte-identical** to what a drag-drop stores, so
auto-links and dragged links are indistinguishable and both open in-pane. Before
finalizing the emitted markup, the implementation must confirm the exact stored
representation a drag produces in this module's ProseMirror setup — the `@UUID[…]{…}`
shorthand vs. a serialized `<a class="content-link" data-uuid="…">` — and match it.
The "skip already-linked" check must recognize whichever form(s) can appear in
stored content.

## Testing

### Unit (vitest) — `tests/auto-link.test.js`

Mirrors `tests/search-index.test.js` (pure functions, fixture records, no DOM):

- `diffAddedSpans`: pure insertion, insertion amid unchanged text, edit that mixes
  insert + delete, no-op when unchanged.
- `linkNames`: whole-word match; case-insensitivity; multiple occurrences in a span;
  no match outside added spans; skip inside existing link / code; longest-match on
  overlap; min-length exclusion; idempotency (re-run is a no-op).
- Candidate exclusion of self and hidden entries (test the builder's filter, or the
  pure core given a pre-filtered candidate list).

### E2E (Playwright)

- Type a known entry name into a description, click away → assert an in-pane content
  link appears and navigates to the target in-pane.
- Assert a pre-existing plain mention already in the field is **not** linked.
- Assert a quiet autosave mid-typing (before focus-out) does **not** produce a link.
- Assert cross-record: a name that only exists in another campaign record is not
  linked.

## Out of scope (YAGNI)

- Aliases / alternate names (no alias field exists today).
- Fuzzy / partial-name matching.
- Live in-editor insertion while typing (explicitly rejected in favor of robustness).
- Retroactive linking of existing prose, or a "re-scan whole library" command.
