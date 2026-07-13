# Drag-and-Drop Fixes + Timeline Link Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two drag-and-drop bugs by making hub records drag as real Foundry document payloads and by unifying every timeline attachment onto the existing "link" model.

**Architecture:** Retire the record-chip model (`system.timepoints` on record pages) in favor of links stored on the timepoint. Pure logic goes in `scripts/logic/timeline-links.mjs` (vitest); Foundry glue (`scripts/data`, `scripts/hooks`, `scripts/apps`) is exercised by quench/Playwright e2e. A schema-v3 migration copies existing memberships into links; the field is left in the schema this release and deleted later.

**Tech Stack:** Foundry VTT v13 module (ES modules), vitest for unit tests, quench + Playwright for e2e.

## Global Constraints

- Module id is `"campaign-record"`; group flag key is `GROUP_FLAG` = `"group"`.
- Record pages are `JournalEntryPage` documents; custom types are prefixed `campaign-record.` (`typeId(type)`); journal records are core `text` pages.
- Pure logic lives under `scripts/logic/` and is unit-tested with vitest (`npm test`). Foundry-touching code is verified with e2e, not vitest.
- Link entries have shape `{ id, uuid, name, type }` (document) or `{ id, src, name, showPlayers }` (image). `addLink` generates `id` and dedupes via `withLink`.
- This release keeps the `timepoints` `SetField` in `base-record.mjs`. Do NOT delete it — the migration reads it.

---

### Task 1: Record drag payload includes Foundry's document shape (Bug 1)

**Files:**
- Modify: `scripts/logic/timeline-links.mjs` (add `recordDragPayload`)
- Modify: `scripts/apps/hub/hub-mixin.mjs:525-530` (`#onTimelineDragStart` record branch)
- Test: `tests/timeline-links.test.js`

**Interfaces:**
- Produces: `recordDragPayload(uuid: string) → { kind: "campaign-record.record", type: "JournalEntryPage", uuid: string }`

- [ ] **Step 1: Write the failing test**

Append to `tests/timeline-links.test.js`:

```js
import { recordDragPayload } from "../scripts/logic/timeline-links.mjs";

describe("recordDragPayload", () => {
  it("carries the internal routing key plus Foundry's document shape", () => {
    expect(recordDragPayload("JournalEntry.g1.JournalEntryPage.p1")).toEqual({
      kind: "campaign-record.record",
      type: "JournalEntryPage",
      uuid: "JournalEntry.g1.JournalEntryPage.p1"
    });
  });
});
```

(Add `recordDragPayload` to the existing top-of-file import from `timeline-links.mjs` rather than a second import line if you prefer; a separate `import` also works.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/timeline-links.test.js -t "recordDragPayload"`
Expected: FAIL — `recordDragPayload is not a function` / not exported.

- [ ] **Step 3: Add the pure helper**

Append to `scripts/logic/timeline-links.mjs`:

```js
/**
 * Drag payload for a record row. `type`+`uuid` is Foundry's standard document
 * drop shape (so a drop into a journal becomes an @UUID content link); `kind`
 * is the internal key the timeline drop handler checks first.
 */
export function recordDragPayload(uuid) {
  return { kind: "campaign-record.record", type: "JournalEntryPage", uuid };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/timeline-links.test.js -t "recordDragPayload"`
Expected: PASS

- [ ] **Step 5: Wire it into the drag handler**

In `scripts/apps/hub/hub-mixin.mjs`, add `recordDragPayload` to the existing import from `../../logic/timeline-links.mjs` (currently `import { classifyDropData, filenameFromSrc } from ...`), making it:

```js
import { classifyDropData, filenameFromSrc, recordDragPayload } from "../../logic/timeline-links.mjs";
```

Then replace the `recordRow` branch of `#onTimelineDragStart` (the `else if (recordRow) { ... }` block) with:

```js
      } else if (recordRow) {
        event.dataTransfer.setData("text/plain", JSON.stringify(recordDragPayload(recordRow.dataset.uuid)));
      }
```

- [ ] **Step 6: Run the full unit suite**

Run: `npm test`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add scripts/logic/timeline-links.mjs scripts/apps/hub/hub-mixin.mjs tests/timeline-links.test.js
git commit -m "fix: drag records into journals as @UUID content links"
```

---

### Task 2: Pure reverse-lookup helper + `timepointsForRecord`

**Files:**
- Modify: `scripts/logic/timeline-links.mjs` (add `timepointIdsWithLink`)
- Modify: `scripts/data/timepoints.mjs` (add `timepointsForRecord`)
- Test: `tests/timeline-links.test.js`

**Interfaces:**
- Produces: `timepointIdsWithLink(timepoints: Array<{id,links?}>, uuid: string) → string[]`
- Produces: `timepointsForRecord(group, uuid: string) → string[]` (in `timepoints.mjs`)

- [ ] **Step 1: Write the failing test**

Append to `tests/timeline-links.test.js`:

```js
import { timepointIdsWithLink } from "../scripts/logic/timeline-links.mjs";

describe("timepointIdsWithLink", () => {
  const tps = [
    { id: "t1", links: [{ id: "l1", uuid: "JournalEntry.g.JournalEntryPage.p1" }] },
    { id: "t2", links: [] },
    { id: "t3", links: [{ id: "l2", uuid: "JournalEntry.g.JournalEntryPage.p1" }, { id: "l3", uuid: "Actor.x" }] },
    { id: "t4" }
  ];
  it("returns ids of timepoints whose links reference the uuid", () => {
    expect(timepointIdsWithLink(tps, "JournalEntry.g.JournalEntryPage.p1")).toEqual(["t1", "t3"]);
  });
  it("returns empty when nothing matches", () => {
    expect(timepointIdsWithLink(tps, "Actor.none")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/timeline-links.test.js -t "timepointIdsWithLink"`
Expected: FAIL — not exported.

- [ ] **Step 3: Add the pure helper**

Append to `scripts/logic/timeline-links.mjs`:

```js
/** Ids of timepoints whose links reference this document uuid. */
export function timepointIdsWithLink(timepoints, uuid) {
  return (timepoints ?? [])
    .filter((tp) => (tp.links ?? []).some((l) => l.uuid === uuid))
    .map((tp) => tp.id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/timeline-links.test.js -t "timepointIdsWithLink"`
Expected: PASS

- [ ] **Step 5: Add the Foundry-facing wrapper**

In `scripts/data/timepoints.mjs`, update the import from `../logic/timeline-links.mjs` to include the new helper:

```js
import { withLink, withoutLink, displayLink, timepointIdsWithLink } from "../logic/timeline-links.mjs";
```

Then add, after `getTimepoints`:

```js
/** Timepoint ids whose links reference this record uuid. */
export function timepointsForRecord(group, uuid) {
  return timepointIdsWithLink(getTimepoints(group), uuid);
}
```

- [ ] **Step 6: Commit**

```bash
git add scripts/logic/timeline-links.mjs scripts/data/timepoints.mjs tests/timeline-links.test.js
git commit -m "feat: add timepointsForRecord reverse lookup over links"
```

---

### Task 3: `resolveLinks` respects hidden-record visibility (correctness 3a)

**Files:**
- Modify: `scripts/data/timepoints.mjs` (`resolveLinks`, ~lines 111-124)

**Interfaces:**
- Consumes: `isRecordVisible(user, doc)` (already imported in `timepoints.mjs` from `../logic/visibility.mjs`).

**Note:** `resolveLinks` calls `fromUuidSync` (Foundry glue), so it is verified by the quench e2e in Task 12, not vitest. `isRecordVisible` returns `true` for any doc without `system.hidden === true`, so applying it to all document links is safe for non-record types (Actors/Scenes/Items).

- [ ] **Step 1: Update the permission computation**

In `scripts/data/timepoints.mjs`, inside `resolveLinks`, replace the `permitted` line:

```js
      const permitted = user.isGM || doc?.testUserPermission?.(user, "LIMITED") === true;
```

with:

```js
      // A GM-hidden Campaign Record page must never surface to players through a
      // link; isRecordVisible is a no-op for non-record docs (no system.hidden).
      const permitted = user.isGM
        || (doc?.testUserPermission?.(user, "LIMITED") === true && isRecordVisible(user, doc));
```

- [ ] **Step 2: Run the full unit suite**

Run: `npm test`
Expected: PASS (no vitest touches this glue; confirm nothing broke).

- [ ] **Step 3: Commit**

```bash
git add scripts/data/timepoints.mjs
git commit -m "fix: hide GM-only records from players in timeline links"
```

---

### Task 4: Auto-capture attaches via links

**Files:**
- Modify: `scripts/hooks/auto-capture.mjs` (imports; `ensurePlaceForScene` ~68-74; `combatStart` ~113)

**Interfaces:**
- Consumes: `addLink(group, timepointId, link)`, `timepointsForRecord(group, uuid)` from `../data/timepoints.mjs`; `pickLatestTimepoint(attachedIds, timepoints)` (unchanged).

**Note:** Foundry glue — covered by the auto-capture quench e2e (Task 12), not vitest.

- [ ] **Step 1: Update imports**

In `scripts/hooks/auto-capture.mjs`, change:

```js
import { addTimepoint, attachRecord, getTimepoints } from "../data/timepoints.mjs";
```

to:

```js
import { addTimepoint, addLink, getTimepoints, timepointsForRecord } from "../data/timepoints.mjs";
```

- [ ] **Step 2: Replace the place-attachment logic in `ensurePlaceForScene`**

Replace:

```js
  const attached = [...(place.system.timepoints ?? [])];
  let timepointId = createTimepoint ? null : pickLatestTimepoint(attached, getTimepoints(group));
  if (!timepointId) {
    const tp = await addTimepoint(group, scene.name);
    await attachRecord(place, tp.id);
    timepointId = tp.id;
  }
```

with:

```js
  const attached = timepointsForRecord(group, place.uuid);
  let timepointId = createTimepoint ? null : pickLatestTimepoint(attached, getTimepoints(group));
  if (!timepointId) {
    const tp = await addTimepoint(group, scene.name);
    await addLink(group, tp.id, { uuid: place.uuid, name: place.name, type: "JournalEntryPage" });
    timepointId = tp.id;
  }
```

- [ ] **Step 3: Replace the encounter attachment in `combatStart`**

Replace:

```js
    await attachRecord(encounter, timepointId);
```

with:

```js
    await addLink(group, timepointId, { uuid: encounter.uuid, name: encounter.name, type: "JournalEntryPage" });
```

- [ ] **Step 4: Run the full unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/auto-capture.mjs
git commit -m "refactor: auto-capture attaches places/encounters as links"
```

---

### Task 5: Timeline drop handler routes every document to a link

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs` (`#onTimelineDrop` ~533-591)

**Interfaces:**
- Consumes: `classifyDropData`, `#dropLink` (unchanged), `Timepoints.moveTimepoint`.

- [ ] **Step 1: Remove the record-attachment branches**

In `#onTimelineDrop`, delete the entire `if (data.kind === "campaign-record.record") { ... }` block (the one that calls `fromUuid`, checks `page.parent.id`, the `timepoints` schema field, and `Timepoints.attachRecord`). Timepoint reordering stays:

```js
      if (data.kind === "campaign-record.timepoint") {
        if (data.groupId !== groupId) return; // no cross-group reordering
        return Timepoints.moveTimepoint(group, data.id, Number(target.dataset.position));
      }
      const drop = classifyDropData(data, event.dataTransfer.getData("text/uri-list"));
```

- [ ] **Step 2: Simplify the document branch to always link**

Within the `if (drop.kind === "document") { ... }` block, delete the same-group record special-case that calls `Timepoints.attachRecord(doc, timepointId)`, leaving:

```js
      if (drop.kind === "document") {
        const doc = await fromUuid(drop.uuid);
        if (!doc) {
          return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.CannotAttach"));
        }
        return this.#dropLink(group, timepointId, { uuid: drop.uuid, name: doc.name, type: drop.type });
      }
```

- [ ] **Step 3: Sanity-check the file parses**

Run: `node --check scripts/apps/hub/hub-mixin.mjs`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add scripts/apps/hub/hub-mixin.mjs
git commit -m "refactor: timeline drops always attach as links"
```

---

### Task 6: Render timeline attachments from links only

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs` (`#timelineGroups` ~401-414; action map ~56; `#onDetachRecord` ~470-474)
- Modify: `templates/hub/timeline.hbs` (records loop ~27-35)

- [ ] **Step 1: Drop the `records` array from the view model**

In `#timelineGroups`, remove the `records:` property so the timepoint mapping is:

```js
          timepoints: Timepoints.getTimepoints(group).map((tp, i) => ({
            ...tp,
            position: i,
            canEdit,
            links: Timepoints.resolveLinks(tp, game.user).map((entry) => ({
              ...entry,
              broken: entry.kind === "broken",
              thumb: entry.img || null,
              canToggleVisibility: canEdit && game.user.isGM && entry.kind === "image"
            }))
          }))
```

- [ ] **Step 2: Remove the record loop from the template**

In `templates/hub/timeline.hbs`, delete the `{{#each this.records}} ... {{/each}}` block (the `record-chip` with `detachRecord`), keeping the `{{#each this.links}}` block that follows.

- [ ] **Step 3: Remove the detach action and handler**

In `scripts/apps/hub/hub-mixin.mjs`, delete the `detachRecord: HubBase.#onDetachRecord,` line from the actions map, and delete the entire `static async #onDetachRecord(event, target) { ... }` method.

- [ ] **Step 4: Sanity-check**

Run: `node --check scripts/apps/hub/hub-mixin.mjs`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/apps/hub/hub-mixin.mjs templates/hub/timeline.hbs
git commit -m "refactor: render timeline attachments as links only"
```

---

### Task 7: Retire record-chip helpers in `timepoints.mjs`

**Files:**
- Modify: `scripts/data/timepoints.mjs` (`attachRecord`, `detachRecord`, `recordsAtTimepoint`, `deleteTimepoint`)

- [ ] **Step 1: Delete `attachRecord` and `detachRecord`**

Remove both exported functions (the two that read/write `page.system.timepoints`).

- [ ] **Step 2: Delete `recordsAtTimepoint`**

Remove the exported `recordsAtTimepoint` function (bottom of file). `isRecordVisible` is still used by `resolveLinks`, so keep the import.

- [ ] **Step 3: Simplify `deleteTimepoint`**

Replace the whole `deleteTimepoint` function with:

```js
export async function deleteTimepoint(group, id) {
  await setTimepoints(group, getTimepoints(group).filter((t) => t.id !== id));
}
```

(Its links live inside the timepoint object and are removed with it; no page cleanup needed.)

- [ ] **Step 4: Confirm no remaining references**

Run: `grep -rn "attachRecord\|detachRecord\|recordsAtTimepoint" scripts/`
Expected: no matches under `scripts/` (all call sites updated in Tasks 4, 5, 6, 8, 9).

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/data/timepoints.mjs
git commit -m "refactor: remove record-chip attach/detach helpers"
```

---

### Task 8: Make every hub record draggable

**Files:**
- Modify: `scripts/apps/hub/hub-data.mjs` (`toIndexEntry` ~66-67)
- Modify: `templates/hub/index-row.hbs:2`

- [ ] **Step 1: Remove the `canAttach` gate from the index entry**

In `scripts/apps/hub/hub-data.mjs`, delete the `canAttach` property and its comment from the object returned by `toIndexEntry`:

```js
    // (delete these two lines)
    // Core text pages have no timepoints SetField, so they can't be dragged onto the timeline.
    canAttach: shortType !== "journal",
```

- [ ] **Step 2: Always mark rows draggable**

In `templates/hub/index-row.hbs`, change line 2 from:

```hbs
    {{#if this.canAttach}}data-drag-record draggable="true"{{/if}}
```

to:

```hbs
    data-drag-record draggable="true"
```

- [ ] **Step 3: Run the full unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/apps/hub/hub-data.mjs templates/hub/index-row.hbs
git commit -m "fix: allow journal records to be dragged onto the timeline"
```

---

### Task 9: Import wizard and export dialog use links

**Files:**
- Modify: `scripts/apps/import-wizard.mjs` (~271-276)
- Modify: `scripts/apps/export-dialog.mjs` (`groupSnapshot` ~59-67)

- [ ] **Step 1: Simplify import-wizard attachment**

In `scripts/apps/import-wizard.mjs`, replace:

```js
        const page = created[i];
        // Text pages have no system.timepoints; they attach as document links.
        if (page?.system?.schema?.fields?.timepoints) await Timepoints.attachRecord(page, tp.id);
        else if (page) await Timepoints.addLink(group, tp.id, {
          uuid: page.uuid, name: page.name, type: "JournalEntryPage"
        });
```

with:

```js
        const page = created[i];
        if (page) await Timepoints.addLink(group, tp.id, {
          uuid: page.uuid, name: page.name, type: "JournalEntryPage"
        });
```

- [ ] **Step 2: Simplify export-dialog timeline items**

In `scripts/apps/export-dialog.mjs`, replace the `items` array in `groupSnapshot`:

```js
    items: [
      ...Timepoints.recordsAtTimepoint(group, tp.id, game.user)
        .filter((p) => includeGM || p.system?.hidden !== true)
        .map((p) => p.name),
      ...snapshotLinkNames(tp, includeGM)
    ]
```

with:

```js
    items: snapshotLinkNames(tp, includeGM)
```

- [ ] **Step 3: Confirm no remaining references and file parses**

Run: `grep -rn "recordsAtTimepoint\|attachRecord" scripts/ && node --check scripts/apps/import-wizard.mjs && node --check scripts/apps/export-dialog.mjs`
Expected: grep prints nothing (then the `&&` chain continues); both `node --check` exit 0.
(If `grep` finds nothing it exits non-zero and stops the chain — that's fine; run the two `node --check` commands individually to confirm exit 0.)

- [ ] **Step 4: Run the full unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/apps/import-wizard.mjs scripts/apps/export-dialog.mjs
git commit -m "refactor: import/export use timeline links, not record chips"
```

---

### Task 10: Migration planner (pure)

**Files:**
- Modify: `scripts/logic/timeline-links.mjs` (add `recordLinkMigrationEntries`)
- Test: `tests/timeline-links.test.js`

**Interfaces:**
- Produces: `recordLinkMigrationEntries(pages: Array<{uuid,name,timepointIds:string[]}>) → Array<{timepointId: string, link: {uuid,name,type:"JournalEntryPage"}}>`

- [ ] **Step 1: Write the failing test**

Append to `tests/timeline-links.test.js`:

```js
import { recordLinkMigrationEntries } from "../scripts/logic/timeline-links.mjs";

describe("recordLinkMigrationEntries", () => {
  it("emits one link entry per (page, timepoint) membership", () => {
    const pages = [
      { uuid: "JournalEntry.g.JournalEntryPage.p1", name: "Natick", timepointIds: ["t1", "t2"] },
      { uuid: "JournalEntry.g.JournalEntryPage.p2", name: "Strahd", timepointIds: [] },
      { uuid: "JournalEntry.g.JournalEntryPage.p3", name: "Vault", timepointIds: ["t2"] }
    ];
    expect(recordLinkMigrationEntries(pages)).toEqual([
      { timepointId: "t1", link: { uuid: "JournalEntry.g.JournalEntryPage.p1", name: "Natick", type: "JournalEntryPage" } },
      { timepointId: "t2", link: { uuid: "JournalEntry.g.JournalEntryPage.p1", name: "Natick", type: "JournalEntryPage" } },
      { timepointId: "t2", link: { uuid: "JournalEntry.g.JournalEntryPage.p3", name: "Vault", type: "JournalEntryPage" } }
    ]);
  });

  it("returns empty for no memberships", () => {
    expect(recordLinkMigrationEntries([{ uuid: "x", name: "x", timepointIds: [] }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/timeline-links.test.js -t "recordLinkMigrationEntries"`
Expected: FAIL — not exported.

- [ ] **Step 3: Add the pure planner**

Append to `scripts/logic/timeline-links.mjs`:

```js
/**
 * Flatten record→timepoint memberships into link-add operations for the v3
 * migration. addLink dedupes, so re-running is safe.
 */
export function recordLinkMigrationEntries(pages) {
  const entries = [];
  for (const page of pages ?? []) {
    for (const timepointId of page.timepointIds ?? []) {
      entries.push({ timepointId, link: { uuid: page.uuid, name: page.name, type: "JournalEntryPage" } });
    }
  }
  return entries;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/timeline-links.test.js -t "recordLinkMigrationEntries"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/timeline-links.mjs tests/timeline-links.test.js
git commit -m "feat: add v3 migration planner for record→link conversion"
```

---

### Task 11: Wire the v3 migration and bump the schema version

**Files:**
- Modify: `scripts/constants.mjs:45` (`SCHEMA_VERSION`)
- Modify: `scripts/data/migration-runner.mjs` (imports; `MIGRATIONS` array)

**Interfaces:**
- Consumes: `addLink` from `./timepoints.mjs`; `recordLinkMigrationEntries` from `../logic/timeline-links.mjs`; `getGroups` (already imported).

**Note:** Migration `run()` is Foundry glue, verified by the quench e2e in Task 12. The pure planner it calls is unit-tested in Task 10.

- [ ] **Step 1: Bump the schema version**

In `scripts/constants.mjs`, change:

```js
export const SCHEMA_VERSION = 2;
```

to:

```js
export const SCHEMA_VERSION = 3;
```

- [ ] **Step 2: Add imports to the migration runner**

In `scripts/data/migration-runner.mjs`, add below the existing imports:

```js
import { addLink } from "./timepoints.mjs";
import { recordLinkMigrationEntries } from "../logic/timeline-links.mjs";
```

- [ ] **Step 3: Append the v3 migration**

Add as the last entry of the `MIGRATIONS` array (after the `version: 2` object):

```js
  ,{
    version: 3,
    // Record→timepoint membership moved from page.system.timepoints onto the
    // timepoint as links. Copy every membership to a link, then clear the field.
    // The field stays in the schema this release so this read works; a later
    // release deletes it. addLink dedupes, so re-running is a no-op.
    async run() {
      for (const group of getGroups()) {
        const pages = group.pages.map((p) => ({
          uuid: p.uuid, name: p.name, timepointIds: [...(p.system?.timepoints ?? [])]
        }));
        for (const { timepointId, link } of recordLinkMigrationEntries(pages)) {
          await addLink(group, timepointId, link);
        }
        const clears = group.pages
          .filter((p) => (p.system?.timepoints?.size ?? 0) > 0)
          .map((p) => ({ _id: p.id, "system.timepoints": [] }));
        if (clears.length) await group.updateEmbeddedDocuments("JournalEntryPage", clears);
      }
    }
  }
```

- [ ] **Step 4: Sanity-check the runner parses**

Run: `node --check scripts/data/migration-runner.mjs`
Expected: exit 0.

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/constants.mjs scripts/data/migration-runner.mjs
git commit -m "feat: v3 migration converts record memberships to timeline links"
```

---

### Task 12: Update e2e specs and verify end-to-end

**Files:**
- Modify: `tests/e2e/08-hub-timeline.spec.mjs`
- Modify: `tests/e2e/25-auto-capture-engine.spec.mjs`

**Note:** e2e runs against the shared Foundry install. Before running, read the `foundry-e2e` skill for session locking, symlink ownership, and unlock steps.

- [ ] **Step 1: Find the stale assertions**

Run: `grep -n "attachRecord\|detachRecord\|recordsAtTimepoint\|system.timepoints\|record-chip\|Detach" tests/e2e/08-hub-timeline.spec.mjs tests/e2e/25-auto-capture-engine.spec.mjs`
Expected: lists the drag/attach/detach assertions to update.

- [ ] **Step 2: Rework the timeline spec**

In `tests/e2e/08-hub-timeline.spec.mjs`, update attachment assertions so that:
- Dragging a record onto a timepoint produces a `.link-chip` (not a bare `.record-chip` with a `detachRecord` control).
- Removing it uses the `removeLink` action.
- A journal (`text`) record can be dragged onto a timepoint and yields a link chip.
- Add/confirm an assertion that a GM-hidden record attached to a timepoint is not visible to a non-GM client.

Match the project's existing quench assertion style in that file; keep selectors aligned with `templates/hub/timeline.hbs` (`.record-chip.link-chip`, `[data-action="removeLink"]`).

- [ ] **Step 3: Rework the auto-capture spec**

In `tests/e2e/25-auto-capture-engine.spec.mjs`, replace assertions that read `place.system.timepoints` / expect record chips with assertions that the place and encounter appear as links on the expected timepoint (via `getTimepoints(group)` link entries or the rendered `.link-chip`).

- [ ] **Step 4: Add a Bug 1 assertion**

Add (in the timeline spec or a suitable existing e2e) a check that dragging a record into a JournalEntryPage editor inserts an `@UUID[...]{Name}` content link — e.g. assert the resulting page HTML contains `data-uuid` / a rendered `.content-link`, or that the ProseMirror drop produced an `@UUID` enricher.

- [ ] **Step 5: Run the affected e2e**

Per the `foundry-e2e` skill (lock the session, ensure the module symlink, then run):
Run: the project's e2e command for these two specs (e.g. `npx playwright test tests/e2e/08-hub-timeline.spec.mjs tests/e2e/25-auto-capture-engine.spec.mjs`).
Expected: PASS. Unlock the session afterward per the skill.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/08-hub-timeline.spec.mjs tests/e2e/25-auto-capture-engine.spec.mjs
git commit -m "test(e2e): timeline attachments and drag-to-journal via links"
```

---

### Task 13: Full verification sweep

- [ ] **Step 1: Run the entire unit suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Grep for orphaned references**

Run: `grep -rn "attachRecord\|detachRecord\|recordsAtTimepoint\|canAttach" scripts/ templates/`
Expected: no matches.

- [ ] **Step 3: Confirm the schema field is still present (deprecate, not delete)**

Run: `grep -n "timepoints:" scripts/data/base-record.mjs`
Expected: the `timepoints: new SetField(...)` line still exists (removal is a later release).

- [ ] **Step 4: Manual smoke (Foundry running)**

- Drag a Place record into a journal page → renders a clickable link to the record.
- Drag a journal (text) record onto a timepoint → link chip appears.
- Remove a link via the ✕ control → chip disappears.
- As a player, a GM-hidden record on a timepoint is not shown.
- Load a pre-v3 world with existing record→timepoint attachments → they appear as link chips after migration; re-opening does not duplicate them.

- [ ] **Step 5: Final commit if any doc/notes changed**

```bash
git add -A
git commit -m "chore: verification notes for link unification" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- Bug 1 (drag payload) → Task 1. ✓
- Bug 2 (journal records draggable) → Task 8 (draggable) + Task 5 (drop routes to link). ✓
- Unify on links: drop handler → Task 5; rendering/detach → Task 6; helpers removed → Task 7; index draggable → Task 8; callers (auto-capture/import/export) → Tasks 4, 9. ✓
- Correctness 3a (hidden visibility) → Task 3 + e2e Task 12. ✓
- Correctness 3b (reverse lookup) → Task 2 + Task 4. ✓
- Migration deprecate-then-remove → Tasks 10 (planner) + 11 (wire + schema bump); field kept → verified Task 13 Step 3. ✓
- Testing (unit + e2e) → Tasks 1/2/10 unit; Task 12 e2e; Task 13 sweep. ✓
- Out of scope (field deletion) → explicitly deferred in Task 11 comment and Task 13 Step 3. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. e2e steps (Task 12) describe assertions to match against the existing spec style rather than inventing selectors blind — acceptable because they adapt existing project tests whose exact current text must be read first (Step 1 greps for it).

**Type consistency:** `recordDragPayload → {kind,type,uuid}` used verbatim in Task 1 wire-in. `timepointIdsWithLink(timepoints,uuid)` (Task 2) consumed by `timepointsForRecord` (Task 2) and mirrors link shape `{uuid}`. `recordLinkMigrationEntries(pages)→[{timepointId,link}]` (Task 10) consumed identically in Task 11 `run()`. `addLink(group, timepointId, {uuid,name,type})` signature matches existing `timepoints.mjs`. Link `type` is `"JournalEntryPage"` everywhere.
