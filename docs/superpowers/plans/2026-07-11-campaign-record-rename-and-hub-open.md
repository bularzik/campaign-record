# Campaign Record Rename + Group Double-Click Opens Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the user-facing term "Campaign Group" → "Campaign Record" (and page-sense "record(s)" → "entry/entries"), and make Journal-sidebar activation of a Campaign Record deterministically open the scoped hub instead of the core journal editor.

**Architecture:** Part A is a pure user-facing-text change — i18n **values** in `lang/en.json`, the `module.json` description, and `README.md` (no keys, code identifiers, CSS classes, flags, or migration). Part B adds a capture-phase click interceptor in the existing `renderJournalDirectory` hook so that activating a group entry opens `GroupHubSheet` regardless of whether the entry carries the `flags.core.sheetClass` override.

**Tech Stack:** Foundry VTT v13 module (ES modules), Vitest (unit), Playwright (e2e against a local Foundry world).

## Global Constraints

- **Working tree:** all work happens in the existing worktree at `.claude/worktrees/rename-campaign-record` on branch `feature/campaign-record-rename-and-hub-open`. Run every command from that directory.
- **Rename scope: user-facing text only.** Change i18n **values**, `module.json` description, `README.md` prose. Do **not** change: i18n **keys**, code identifiers (`createGroup`, `GroupHubSheet`, `isGroup`, `groupId`, …), filenames, CSS class names (`.record-row`, `.record-group`, `.group-hub`, `.timeline-group`), the stored `flags.campaign-record.group` flag, or `flags.core.sheetClass` values. **No data migration.**
- **Container term** "Campaign Group" → **"Campaign Record"**. **Page term** "record(s)" → **"entry/entries"**.
- **Intentionally unchanged** (here "Campaign Record" = the *module* name, not the container): `CAMPAIGNRECORD.RecordsFolder` ("Campaign Records"), `CAMPAIGNRECORD.Sheets.Npc … Media` (e.g. "Campaign Record NPC Sheet"), `CAMPAIGNRECORD.Warning.ReadOnly`, and `TYPES.JournalEntryPage.*`.
- **Unit tests:** `npm test` (Vitest). **E2E:** `npx playwright test <file>` — global setup boots the Foundry server automatically; **one runner at a time, no other browser connected to the test world** (login fails fast otherwise).
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- `lang/en.json` — modify string **values** (Task 1).
- `module.json` — modify `description` value (Task 2).
- `README.md` — modify prose (Task 2).
- `tests/i18n-rename.test.js` — **create**; Vitest guard locking the rename in place (Tasks 1–2).
- `scripts/hooks/directory.mjs` — modify; add the sidebar activation interceptor (Task 4).
- `tests/e2e/23-group-sidebar-open.spec.mjs` — **create**; drives the real sidebar click (Tasks 3–4).

---

## Task 1: Rename user-facing strings in `lang/en.json`

**Files:**
- Create: `tests/i18n-rename.test.js`
- Modify: `lang/en.json` (values only)

**Interfaces:**
- Consumes: nothing.
- Produces: the renamed i18n values consumed by the UI; the guard test `tests/i18n-rename.test.js` (extended in Task 2).

- [ ] **Step 1: Write the failing guard test**

Create `tests/i18n-rename.test.js`:

```js
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const lang = JSON.parse(fs.readFileSync(path.join(ROOT, "lang/en.json"), "utf8"));

function resolve(key) {
  return key.split(".").reduce((node, part) => node?.[part], lang);
}

function allStringValues(node, out = []) {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object") for (const v of Object.values(node)) allStringValues(v, out);
  return out;
}

describe("i18n rename: Campaign Group -> Campaign Record", () => {
  // Container term renamed everywhere.
  const containerExpectations = {
    "CAMPAIGNRECORD.CreateGroup": "Create Campaign Record",
    "CAMPAIGNRECORD.GroupName": "Campaign Record Name",
    "CAMPAIGNRECORD.Hub.GroupPicker": "Campaign Record",
    "CAMPAIGNRECORD.Hub.AllGroups": "All Campaign Records",
    "CAMPAIGNRECORD.Hub.NoGroups": "Create a Campaign Record first.",
    "CAMPAIGNRECORD.Hub.WrongGroup":
      "Entries can only attach to timepoints in their own Campaign Record.",
    "CAMPAIGNRECORD.Hub.CannotEditTimeline":
      "You lack permission to edit this Campaign Record's timeline.",
    "CAMPAIGNRECORD.Import.NewGroup": "New Campaign Record…",
    "CAMPAIGNRECORD.Import.GroupName": "Campaign Record name",
    "CAMPAIGNRECORD.Export.GroupButton": "Export Campaign Record",
    "CAMPAIGNRECORD.Export.SelectGroup": "Select a specific Campaign Record to export.",
    "CAMPAIGNRECORD.Sheets.GroupHub": "Campaign Hub (Campaign Record Sheet)",
    "CAMPAIGNRECORD.Warning.CreateGroupFailed":
      "Failed to create the Campaign Record. See the console for details."
  };

  // Page term renamed to entry/entries.
  const pageExpectations = {
    "CAMPAIGNRECORD.Hub.NewRecord": "New Entry",
    "CAMPAIGNRECORD.Hub.NoRecords": "No entries match the current filters.",
    "CAMPAIGNRECORD.Hub.HiddenOnly": "Show hidden entries only",
    "CAMPAIGNRECORD.Hub.SearchPlaceholder": "Search all entries…",
    "CAMPAIGNRECORD.Hub.NoResults": "No entries match.",
    "CAMPAIGNRECORD.Hub.EditRecord": "Edit entry",
    "CAMPAIGNRECORD.Hub.RecordUnavailable": "That entry can no longer be displayed.",
    "CAMPAIGNRECORD.Hub.DeleteTimepointConfirmNamed":
      'Delete the timepoint "{label}"? Attached entries stay; only the timepoint is removed.',
    "CAMPAIGNRECORD.Export.IncludeGM": "Include GM content (hidden entries, GM notes)",
    "CAMPAIGNRECORD.Export.HiddenRecord":
      'This entry is hidden — check "Include GM content" to export it.',
    "CAMPAIGNRECORD.Import.Created":
      'Imported {pages} entries and {timepoints} timepoints into "{group}".',
    "CAMPAIGNRECORD.Settings.InlineEditing.Hint":
      "Edit entries directly while viewing them; changes save automatically. Turn off for read-only views.",
    "CAMPAIGNRECORD.Warning.HiddenGMOnly": "Only a Gamemaster can hide or reveal entries.",
    "CAMPAIGNRECORD.Presenter.NoImages": "This media entry has no images to present."
  };

  for (const [key, value] of Object.entries({ ...containerExpectations, ...pageExpectations })) {
    it(`${key} is renamed`, () => {
      expect(resolve(key)).toBe(value);
    });
  }

  it("SchemaNewer warning uses 'Entries are read-only'", () => {
    expect(resolve("CAMPAIGNRECORD.Warning.SchemaNewer")).toContain("Entries are read-only");
  });

  it("no user-facing value still says 'Campaign Group'", () => {
    const offenders = allStringValues(lang).filter((s) => /campaign group/i.test(s));
    expect(offenders).toEqual([]);
  });

  it("intentional module-name strings are left intact", () => {
    expect(resolve("CAMPAIGNRECORD.RecordsFolder")).toBe("Campaign Records");
    expect(resolve("CAMPAIGNRECORD.Sheets.Npc")).toBe("Campaign Record NPC Sheet");
    expect(resolve("CAMPAIGNRECORD.ModuleName")).toBe("Campaign Record");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- i18n-rename`
Expected: FAIL — current values are still "Create Campaign Group", "New Record", etc.

- [ ] **Step 3: Apply the value edits in `lang/en.json`**

Edit **only the values** for these keys (keys and all other entries unchanged):

Container → Campaign Record:
- `CreateGroup`: `"Create Campaign Record"`
- `GroupName`: `"Campaign Record Name"`
- `Hub.GroupPicker`: `"Campaign Record"`
- `Hub.AllGroups`: `"All Campaign Records"`
- `Hub.NoGroups`: `"Create a Campaign Record first."`
- `Hub.WrongGroup`: `"Entries can only attach to timepoints in their own Campaign Record."`
- `Hub.CannotEditTimeline`: `"You lack permission to edit this Campaign Record's timeline."`
- `Import.NewGroup`: `"New Campaign Record…"`
- `Import.GroupName`: `"Campaign Record name"`
- `Export.GroupButton`: `"Export Campaign Record"`
- `Export.SelectGroup`: `"Select a specific Campaign Record to export."`
- `Sheets.GroupHub`: `"Campaign Hub (Campaign Record Sheet)"`
- `Warning.CreateGroupFailed`: `"Failed to create the Campaign Record. See the console for details."`

Page → entry/entries:
- `Hub.NewRecord`: `"New Entry"`
- `Hub.NoRecords`: `"No entries match the current filters."`
- `Hub.HiddenOnly`: `"Show hidden entries only"`
- `Hub.SearchPlaceholder`: `"Search all entries…"`
- `Hub.NoResults`: `"No entries match."`
- `Hub.EditRecord`: `"Edit entry"`
- `Hub.RecordUnavailable`: `"That entry can no longer be displayed."`
- `Hub.DeleteTimepointConfirmNamed`: `"Delete the timepoint \"{label}\"? Attached entries stay; only the timepoint is removed."`
- `Export.IncludeGM`: `"Include GM content (hidden entries, GM notes)"`
- `Export.HiddenRecord`: `"This entry is hidden — check \"Include GM content\" to export it."`
- `Import.Created`: `"Imported {pages} entries and {timepoints} timepoints into \"{group}\"."`
- `Settings.InlineEditing.Hint`: `"Edit entries directly while viewing them; changes save automatically. Turn off for read-only views."`
- `Warning.HiddenGMOnly`: `"Only a Gamemaster can hide or reveal entries."`
- `Warning.SchemaNewer`: change only the tail `"…Records are read-only until you update the module."` → `"…Entries are read-only until you update the module."` (keep the `{stored}`/`{current}` placeholders and the rest of the sentence intact).
- `Presenter.NoImages`: `"This media entry has no images to present."`

Do **not** touch `RecordsFolder`, `Sheets.Npc…Media`, `Warning.ReadOnly`, `TYPES.*`, or any key names.

- [ ] **Step 4: Run the guard test and the full unit suite**

Run: `npm test -- i18n-rename`
Expected: PASS.

Run: `npm test`
Expected: PASS — in particular `tests/i18n-coverage.test.js` stays green because only values changed, not keys.

- [ ] **Step 5: Commit**

```bash
git add lang/en.json tests/i18n-rename.test.js
git commit -m "$(cat <<'EOF'
feat: rename Campaign Group -> Campaign Record and record -> entry in UI strings

User-facing i18n values only; keys, code, and stored flags unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Rename `module.json` description and `README.md`

**Files:**
- Modify: `module.json` (`description` value only)
- Modify: `README.md`
- Modify: `tests/i18n-rename.test.js` (add doc assertions)

**Interfaces:**
- Consumes: the guard test from Task 1.
- Produces: renamed module description + README.

- [ ] **Step 1: Add failing doc assertions to the guard test**

Append this `describe` block to `tests/i18n-rename.test.js`:

```js
describe("rename: docs and manifest", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  it("module.json title and id are unchanged", () => {
    expect(manifest.title).toBe("Campaign Record");
    expect(manifest.id).toBe("campaign-record");
  });

  it("module.json description uses the new terms", () => {
    expect(manifest.description).toContain("typed entries");
    expect(manifest.description).toContain("organized into Campaign Records");
    expect(manifest.description).not.toContain("typed records");
    expect(manifest.description).not.toContain("into groups");
  });

  it("README no longer says 'Campaign Group'", () => {
    expect(/campaign group/i.test(readme)).toBe(false);
    expect(readme).toContain("Campaign Record");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- i18n-rename`
Expected: FAIL on the new "docs and manifest" assertions.

- [ ] **Step 3: Edit `module.json` description**

Change the `description` value from:

```
Collaborative campaign journaling: shared typed records (NPCs, places, quests, and more) organized into groups, with an index, timeline, and cross-document search.
```

to:

```
Collaborative campaign journaling: shared typed entries (NPCs, places, quests, and more) organized into Campaign Records, with an index, timeline, and cross-document search.
```

Leave `title`, `id`, and every other field unchanged.

- [ ] **Step 4: Edit `README.md` prose**

Apply these replacements (prose only — leave repo URLs, the module name "Campaign Record", and the migration batch names "Campaign Record: Core/Hub/Types" intact):

- "campaign records — NPCs, places, quests, and more" → "campaign entries — NPCs, places, quests, and more"
- "organized into shared campaign groups" → "organized into shared Campaign Records"
- "Ten record types" → "Ten entry types"
- "**Groups**: multiple named campaign groups per world" → "**Campaign Records**: multiple named Campaign Records per world"
- "create and edit records in a group" → "create and edit entries in a Campaign Record"
- "filterable record index" → "filterable entry index"
- "push images from a Media record's gallery" → "push images from a Media entry's gallery"
- "Hidden records & GM notes" → "Hidden entries & GM notes"
- "hide any record from players" → "hide any entry from players"
- "keep private GM Notes on any record" → "keep private GM Notes on any entry"
- "onto a Shop or Item record" → "onto a Shop or Item entry"
- "assigns record types, and builds timeline" → "assigns entry types, and builds timeline"
- "export any group or single record" → "export any Campaign Record or single entry"
- "Click **Create Campaign Group**" → "Click **Create Campaign Record**"
- "Open the group and add pages: the ten record types" → "Open the Campaign Record and add pages: the ten entry types"
- "browse and filter records" → "browse and filter entries"
- "dragging records onto a timepoint" → "dragging entries onto a timepoint"
- "group selected), or **Export to Word** in a record sheet's" → "Campaign Record selected), or **Export to Word** in an entry sheet's"
- "open a Media record's sheet as GM" → "open a Media entry's sheet as GM"
- "Every record is editable by all players by default (new groups get `OWNER`" → "Every entry is editable by all players by default (new Campaign Records get `OWNER`"
- "records inside existing groups but cannot create groups" → "entries inside existing Campaign Records but cannot create Campaign Records"
- "won't see the **Create Campaign Group** button" → "won't see the **Create Campaign Record** button"
- "GMs can hide individual records" → "GMs can hide individual entries"
- "can leak hidden records to those users" → "can leak hidden entries to those users"

After editing, verify no stragglers:

Run: `grep -in "campaign group" README.md`
Expected: no output.

- [ ] **Step 5: Run the guard test and full unit suite**

Run: `npm test -- i18n-rename`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add module.json README.md tests/i18n-rename.test.js
git commit -m "$(cat <<'EOF'
docs: rename Campaign Group -> Campaign Record in manifest and README

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Failing e2e — sidebar activation must open the hub

**Files:**
- Create: `tests/e2e/23-group-sidebar-open.spec.mjs`

**Interfaces:**
- Consumes: e2e helpers `login`, `createGroupWithPage(page, groupName, pageName, type) -> { groupId, pageId, pageUuid }`, `deleteGroupsByPrefix(page, prefix)` from `tests/e2e/helpers/foundry.mjs`.
- Produces: a spec that drives the **real** Journal-sidebar activation (`[data-action="activateEntry"]`), asserting a `GroupHubSheet` opens for the entry. Consumed by Task 4's fix.

- [ ] **Step 1: Write the failing e2e spec**

Create `tests/e2e/23-group-sidebar-open.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { login, createGroupWithPage, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

/** Click the entry's activation target in the Journal sidebar. */
async function activateEntry(page, groupId) {
  await page.evaluate(() => ui.sidebar.changeTab("journal", "primary"));
  const row = page.locator(`[data-entry-id="${groupId}"]`);
  await row.waitFor();
  // Synthetic click on the real activation target; the sidebar row can sit
  // outside the viewport, making a positional click flaky.
  await row.evaluate((li) => {
    (li.querySelector('[data-action="activateEntry"]') ?? li).click();
  });
}

/** True once a rendered GroupHubSheet is bound to this group. */
function hubOpenFor(page, groupId) {
  return page.evaluate(({ groupId }) => {
    const g = game.journal.get(groupId);
    return [...foundry.applications.instances.values()].some(
      (a) => a.rendered && a.document === g && a.constructor.name === "GroupHubSheet"
    );
  }, { groupId });
}

test.describe("campaign record sidebar activation", () => {
  test.afterEach(async ({ page }) => {
    await deleteGroupsByPrefix(page, "E2E Sidebar");
  });

  test("activating a flagged Campaign Record opens the scoped hub", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(
      page, "E2E Sidebar Flagged", "E2E Sidebar Npc", "campaign-record.npc"
    );
    await activateEntry(page, ids.groupId);

    const sheet = page.locator(".group-hub");
    await sheet.waitFor();
    await expect(sheet.locator('select[name="group-select"]')).toHaveCount(0);
    await expect(sheet.locator(".record-row", { hasText: "E2E Sidebar Npc" })).toBeVisible();
    await expect.poll(() => hubOpenFor(page, ids.groupId)).toBe(true);
  });

  test("activating a legacy Campaign Record (no sheetClass flag) still opens the hub", async ({ page }) => {
    await login(page, "Gamemaster");
    const ids = await createGroupWithPage(
      page, "E2E Sidebar Legacy", "E2E Sidebar Npc2", "campaign-record.npc"
    );
    // Simulate a pre-v2 group: strip the sheetClass override so the core
    // journal sheet would otherwise win on activation.
    await page.evaluate(async ({ groupId }) => {
      await game.journal.get(groupId).update({ "flags.core.-=sheetClass": null });
    }, { groupId: ids.groupId });

    await activateEntry(page, ids.groupId);

    await expect(page.locator(".group-hub")).toBeVisible();
    await expect.poll(() => hubOpenFor(page, ids.groupId)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the spec to verify the reproduction**

Run: `npx playwright test tests/e2e/23-group-sidebar-open.spec.mjs`
Expected: the **legacy** test FAILS — with the `sheetClass` flag stripped, activation falls back to the core journal editor, so no `GroupHubSheet` opens. (The **flagged** test may already pass, since a flagged group resolves `entry.sheet` to `GroupHubSheet`. If the flagged test also fails, that is fine — Task 4 fixes both; just confirm the legacy test reproduces the fall-through before continuing. If neither fails, stop and debug with superpowers:systematic-debugging, because the bug is not being reproduced.)

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/e2e/23-group-sidebar-open.spec.mjs
git commit -m "$(cat <<'EOF'
test: e2e reproduction for sidebar activation opening the hub

Legacy Campaign Records without flags.core.sheetClass fall back to the
core journal editor on sidebar activation; test fails until fixed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Interceptor — sidebar activation opens the hub deterministically

**Files:**
- Modify: `scripts/hooks/directory.mjs`
- Test: `tests/e2e/23-group-sidebar-open.spec.mjs` (from Task 3)

**Interfaces:**
- Consumes: `isGroup(entry)` from `scripts/data/groups.mjs`; `GroupHubSheet` from `scripts/apps/hub/group-hub-sheet.mjs`; the existing `renderJournalDirectory` hook in `registerDirectoryUI()`.
- Produces: a capture-phase click handler that opens `GroupHubSheet` for group entries. No new exports.

- [ ] **Step 1: Add the interceptor to `scripts/hooks/directory.mjs`**

Replace the entire contents of `scripts/hooks/directory.mjs` with:

```js
import { promptCreateGroup } from "../apps/create-group-dialog.mjs";
import { isGroup } from "../data/groups.mjs";
import { GroupHubSheet } from "../apps/hub/group-hub-sheet.mjs";

// Hub sheets built for legacy groups whose flags.core.sheetClass is missing.
// Cached per entry so repeated activations reuse one window instead of
// stacking duplicates. GC'd with the document (WeakMap).
const legacyHubs = new WeakMap();

/** Open a Campaign Record in the hub, independent of its sheetClass flag. */
function openGroupHub(entry) {
  if (entry.sheet instanceof GroupHubSheet) {
    entry.sheet.render(true);
    return;
  }
  let hub = legacyHubs.get(entry);
  if (!hub) {
    hub = new GroupHubSheet({ document: entry });
    legacyHubs.set(entry, hub);
  }
  hub.render(true);
}

/**
 * Make Journal-sidebar activation of a Campaign Record open the hub rather
 * than the core journal editor. Foundry's activateEntry action calls
 * `entry.sheet.render(true)`, which only lands on GroupHubSheet when the
 * entry carries flags.core.sheetClass — legacy groups miss it and fall back
 * to the journal editor. A capture-phase listener intercepts the activation
 * click first and routes every group entry to the hub deterministically.
 */
function registerGroupActivation(html) {
  if (html.dataset.campaignRecordActivation) return;
  html.dataset.campaignRecordActivation = "1";
  html.addEventListener(
    "click",
    (event) => {
      const nameEl = event.target.closest('[data-action="activateEntry"]');
      if (!nameEl) return;
      const li = nameEl.closest("[data-entry-id]");
      const entry = li && game.journal.get(li.dataset.entryId);
      if (!entry || !isGroup(entry)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openGroupHub(entry);
    },
    { capture: true }
  );
}

/**
 * Add a "Create Campaign Record" button to the journal sidebar footer and
 * route Campaign Record activation to the hub.
 * Available to any user with the Create Journal Entries permission.
 * In v13 the render hook receives an HTMLElement (ApplicationV2).
 */
export function registerDirectoryUI() {
  Hooks.on("renderJournalDirectory", (app, html) => {
    registerGroupActivation(html);

    if (!game.user.can("JOURNAL_CREATE")) return;
    if (html.querySelector(".campaign-record-create-group")) return;
    const footer = html.querySelector(".directory-footer") ?? html;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "campaign-record-create-group";
    btn.innerHTML = `<i class="fa-solid fa-book-atlas"></i> ${game.i18n.localize("CAMPAIGNRECORD.CreateGroup")}`;
    btn.addEventListener("click", () =>
      promptCreateGroup().catch((error) => {
        console.error("campaign-record | Failed to create group", error);
        ui.notifications.error(game.i18n.localize("CAMPAIGNRECORD.Warning.CreateGroupFailed"));
      })
    );
    footer.append(btn);
  });
}
```

- [ ] **Step 2: Run the e2e spec to verify it passes**

Run: `npx playwright test tests/e2e/23-group-sidebar-open.spec.mjs`
Expected: BOTH tests PASS.

> If the legacy test still fails because Foundry's own action handler ran before the capture listener, the AppV2 action dispatch is bound above `html`. Fix by attaching the listener one level up — use `html.closest(".application") ?? html` as the listener target (still capture phase) — and re-run. Do not weaken the assertions.

- [ ] **Step 3: Run the pre-existing sidebar/hub specs to check for regressions**

Run: `npx playwright test tests/e2e/01-module.spec.mjs tests/e2e/05-hub.spec.mjs tests/e2e/22-group-hub-sheet.spec.mjs`
Expected: PASS — the button still creates groups, the standalone hub still opens, and programmatic `entry.sheet` still resolves to `GroupHubSheet`.

- [ ] **Step 4: Commit**

```bash
git add scripts/hooks/directory.mjs
git commit -m "$(cat <<'EOF'
fix: sidebar activation of a Campaign Record opens the hub, not the editor

Capture-phase interceptor routes group-entry activation to GroupHubSheet
regardless of the flags.core.sheetClass override, so legacy groups no
longer fall back to the core journal editor.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the complete unit suite**

Run: `npm test`
Expected: PASS (includes `i18n-rename`, `i18n-coverage`, and all existing unit tests).

- [ ] **Step 2: Run the complete e2e suite**

Run: `npx playwright test`
Expected: PASS. Ensure no other browser is connected to the test world first (login fails fast otherwise).

- [ ] **Step 3: Confirm the branch state**

Run: `git -C . status -sb && git log --oneline origin/main..HEAD`
Expected: clean working tree; commits from Tasks 1–4 listed above `origin/main`.

- [ ] **Step 4: Hand back for review**

Report the passing unit + e2e counts and the commit list. Do not merge — integration is decided separately (superpowers:finishing-a-development-branch).

---

## Self-Review

**Spec coverage:**
- Part A rename — `lang/en.json` (Task 1), `module.json` description + `README.md` (Task 2). Deliberate boundaries (`RecordsFolder`, `Sheets.*`, `TYPES.*`) asserted-unchanged in the guard test. ✓
- Straggler sweep — `lang` values guarded by the "no 'Campaign Group'" assertion; README grep in Task 2 Step 4. (Initial scan found no hardcoded user-facing group/record text in `scripts/`/`templates/`; the i18n-coverage test already proves all referenced keys resolve.) ✓
- Part B double-click — reproduction spec (Task 3), interceptor (Task 4), regression check of existing specs (Task 4 Step 3). ✓
- No migration / no key or identifier changes — enforced by scope constraints and the guard test asserting keys resolve unchanged (existing `i18n-coverage`). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step states the exact command and expected result. ✓

**Type consistency:** `openGroupHub(entry)` and `registerGroupActivation(html)` are the only new internal helpers, both defined and used within `directory.mjs` (Task 4). Test helper signatures (`createGroupWithPage` → `{ groupId, pageId, pageUuid }`, `deleteGroupsByPrefix`, `login`) match the real exports in `tests/e2e/helpers/foundry.mjs`. The `hubOpenFor` / `activateEntry` helpers are local to the spec. ✓
