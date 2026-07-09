# Timeline Document Drops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drop any Foundry document (world journals/pages, actors, scenes, items) or an image file onto a timeline timepoint in the Campaign Hub and see a permission-filtered, clickable link chip there.

**Architecture:** Links are stored on the timepoint objects inside the group journal's existing `flags.campaign-record.group.timepoints[]` flag (Approach A of the spec). Pure array/display logic lives in a new `scripts/logic/timeline-links.mjs` (vitest-testable, no Foundry globals); Foundry-coupled CRUD/resolution goes in `scripts/data/timepoints.mjs` (quench-tested); the hub app widens its existing DragDrop handler and renders link chips in the timeline template.

**Tech Stack:** Foundry VTT v13 module (vanilla ESM, ApplicationV2 + Handlebars), vitest for pure logic, quench for in-Foundry integration, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-07-09-timeline-document-drops-design.md`

**Branch:** already on `feature/timeline-document-drops` in worktree `.claude/worktrees/timeline-document-drops`. Run all commands from the worktree root.

## Global Constraints

- Foundry compatibility minimum/verified: **13** — use v13 APIs only (`foundry.applications.api.DialogV2`, `foundry.applications.apps.ImagePopout`, `foundry.applications.ux.DragDrop.implementation`).
- Every user-facing string is a `CAMPAIGNRECORD.*` key in `lang/en.json`; the vitest i18n gate (`tests/i18n-coverage.test.js`) scans templates and scripts and fails on any missing key. Add keys in the same task that introduces the reference.
- `scripts/logic/*` must stay pure (no `game`, `foundry`, `fromUuid*` references) so vitest can run it directly.
- Handlebars templates may only use Foundry-registered helpers (`localize`, `#if`, `#each`, `#unless`) — no `eq`/`and`; precompute booleans in JS.
- Concurrency model: last-write-wins on the whole timepoints flag array (already accepted; do not add locking).
- One deviation from the spec, flagged during planning: the GM control to flip an image link's `showPlayers` is a visible eye-icon button on the chip rather than a right-click context action (discoverable + e2e-testable). Everything else follows the spec.

---

### Task 1: Pure link logic (`timeline-links.mjs`)

**Files:**
- Create: `scripts/logic/timeline-links.mjs`
- Test: `tests/timeline-links.test.js`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by Tasks 2–4):
  - `LINKABLE_TYPES: string[]` — `["JournalEntry", "JournalEntryPage", "Actor", "Scene", "Item"]`
  - `LINK_ICONS: Record<string,string>` — FA classes per type plus `image`
  - `isImagePath(src: string): boolean`
  - `filenameFromSrc(src: string): string`
  - `withLink(links: object[]|undefined, link: object): object[]|null` — null on duplicate
  - `withoutLink(links: object[]|undefined, linkId: string): object[]`
  - `classifyDropData(data: object, uriList?: string): {kind:"document",uuid,type}|{kind:"image",src}|null`
  - `displayLink(link, {isGM, doc}): object|null` — render entry `{id, name, icon, kind, uuid?, src?, img, showPlayers?}` or null to hide; `doc` is `{permitted, name, img}` or `null` (dangling), omitted for image links

- [ ] **Step 1: Write the failing tests**

Create `tests/timeline-links.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  LINKABLE_TYPES, LINK_ICONS, isImagePath, filenameFromSrc,
  withLink, withoutLink, classifyDropData, displayLink
} from "../scripts/logic/timeline-links.mjs";

describe("isImagePath", () => {
  it("accepts common image extensions, case-insensitive", () => {
    expect(isImagePath("assets/map.png")).toBe(true);
    expect(isImagePath("assets/MAP.WEBP")).toBe(true);
    expect(isImagePath("https://example.com/a/b.jpg?x=1#frag")).toBe(true);
  });

  it("rejects non-images and junk", () => {
    expect(isImagePath("assets/theme.mp4")).toBe(false);
    expect(isImagePath("no-extension")).toBe(false);
    expect(isImagePath("")).toBe(false);
    expect(isImagePath(null)).toBe(false);
  });
});

describe("filenameFromSrc", () => {
  it("returns the decoded last path segment without query", () => {
    expect(filenameFromSrc("assets/art/old%20map.png?v=2")).toBe("old map.png");
    expect(filenameFromSrc("map.png")).toBe("map.png");
  });
});

describe("withLink / withoutLink", () => {
  const doc = { id: "l1", uuid: "Actor.abc", name: "Strahd", type: "Actor" };
  const img = { id: "l2", src: "assets/map.png", name: "map.png", showPlayers: false };

  it("appends to an empty/undefined list", () => {
    expect(withLink(undefined, doc)).toEqual([doc]);
    expect(withLink([doc], img)).toEqual([doc, img]);
  });

  it("returns null for a duplicate uuid or src, even with a different id", () => {
    expect(withLink([doc], { ...doc, id: "other" })).toBeNull();
    expect(withLink([img], { ...img, id: "other" })).toBeNull();
  });

  it("removes by link id and tolerates undefined", () => {
    expect(withoutLink([doc, img], "l1")).toEqual([img]);
    expect(withoutLink(undefined, "l1")).toEqual([]);
  });
});

describe("classifyDropData", () => {
  it("classifies Foundry document drag data", () => {
    for (const type of LINKABLE_TYPES) {
      expect(classifyDropData({ type, uuid: `${type}.x` }))
        .toEqual({ kind: "document", uuid: `${type}.x`, type });
    }
  });

  it("rejects unknown document types and missing uuids", () => {
    expect(classifyDropData({ type: "Macro", uuid: "Macro.x" })).toBeNull();
    expect(classifyDropData({ type: "Actor" })).toBeNull();
    expect(classifyDropData({})).toBeNull();
  });

  it("classifies image file payloads from src, path, or Tile texture", () => {
    expect(classifyDropData({ src: "a/b.png" })).toEqual({ kind: "image", src: "a/b.png" });
    expect(classifyDropData({ path: "a/b.webp" })).toEqual({ kind: "image", src: "a/b.webp" });
    expect(classifyDropData({ type: "Tile", texture: { src: "a/b.jpg" } }))
      .toEqual({ kind: "image", src: "a/b.jpg" });
  });

  it("falls back to a text/uri-list image URL", () => {
    expect(classifyDropData({}, "https://example.com/x.png\nhttps://other")).
      toEqual({ kind: "image", src: "https://example.com/x.png" });
  });

  it("rejects non-image files and empty payloads", () => {
    expect(classifyDropData({ src: "a/b.mp4" })).toBeNull();
    expect(classifyDropData({}, "")).toBeNull();
  });
});

describe("displayLink", () => {
  const docLink = { id: "l1", uuid: "Actor.abc", name: "Cached", type: "Actor" };
  const imgLink = { id: "l2", src: "assets/map.png", name: "map.png", showPlayers: false };

  it("renders a resolved, permitted document with live name and img", () => {
    const entry = displayLink(docLink, { isGM: false, doc: { permitted: true, name: "Strahd", img: "s.png" } });
    expect(entry).toEqual({
      id: "l1", name: "Strahd", icon: LINK_ICONS.Actor, kind: "document",
      uuid: "Actor.abc", img: "s.png"
    });
  });

  it("hides an unpermitted document", () => {
    expect(displayLink(docLink, { isGM: false, doc: { permitted: false, name: "Strahd", img: null } }))
      .toBeNull();
  });

  it("marks a dangling document GM-only broken, hidden from players", () => {
    const gm = displayLink(docLink, { isGM: true, doc: null });
    expect(gm.kind).toBe("broken");
    expect(gm.name).toBe("Cached");
    expect(displayLink(docLink, { isGM: false, doc: null })).toBeNull();
  });

  it("gates image links on showPlayers for players, never for GMs", () => {
    expect(displayLink(imgLink, { isGM: false })).toBeNull();
    expect(displayLink({ ...imgLink, showPlayers: true }, { isGM: false })).not.toBeNull();
    const gm = displayLink(imgLink, { isGM: true });
    expect(gm).toEqual({
      id: "l2", name: "map.png", icon: LINK_ICONS.image, kind: "image",
      src: "assets/map.png", img: "assets/map.png", showPlayers: false
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/timeline-links.test.js`
Expected: FAIL — `Cannot find module '../scripts/logic/timeline-links.mjs'`

- [ ] **Step 3: Write the implementation**

Create `scripts/logic/timeline-links.mjs`:

```js
/** Document classes accepted as timeline links. */
export const LINKABLE_TYPES = ["JournalEntry", "JournalEntryPage", "Actor", "Scene", "Item"];

/** FontAwesome icon classes per link type ("image" is the file-link pseudo-type). */
export const LINK_ICONS = {
  JournalEntry: "fa-solid fa-book",
  JournalEntryPage: "fa-solid fa-file-lines",
  Actor: "fa-solid fa-user",
  Scene: "fa-solid fa-map",
  Item: "fa-solid fa-suitcase",
  image: "fa-solid fa-image"
};

// Foundry's CONST.IMAGE_FILE_EXTENSIONS keys, inlined so this module stays pure.
const IMAGE_EXTENSIONS = ["apng", "avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "tiff", "webp"];

/** Whether a path/URL points at an image, by extension (query/fragment stripped). */
export function isImagePath(src) {
  if (typeof src !== "string" || !src) return false;
  const clean = src.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  if (dot === -1) return false;
  return IMAGE_EXTENSIONS.includes(clean.slice(dot + 1).toLowerCase());
}

/** Decoded final path segment of a src, without query/fragment. */
export function filenameFromSrc(src) {
  const clean = src.split("?")[0].split("#")[0];
  return decodeURIComponent(clean.split("/").pop());
}

/** Dedupe key of a link: uuid for documents, src for images. */
function linkKey(link) {
  return link.uuid ?? link.src;
}

/** Append with dedupe. Returns the new array, or null when already present. */
export function withLink(links, link) {
  const existing = links ?? [];
  if (existing.some((l) => linkKey(l) === linkKey(link))) return null;
  return [...existing, link];
}

/** Remove by link id. Returns the new array. */
export function withoutLink(links, linkId) {
  return (links ?? []).filter((l) => l.id !== linkId);
}

/**
 * Classify a timeline drop payload into a link candidate.
 * Accepts Foundry document drag data, FilePicker/Tile file payloads
 * (src / path / texture.src), and a text/uri-list image URL fallback.
 * @returns {{kind:"document",uuid:string,type:string}|{kind:"image",src:string}|null}
 */
export function classifyDropData(data, uriList = "") {
  if (LINKABLE_TYPES.includes(data?.type) && typeof data.uuid === "string") {
    return { kind: "document", uuid: data.uuid, type: data.type };
  }
  const src = [data?.src, data?.path, data?.texture?.src].find((s) => typeof s === "string");
  if (isImagePath(src)) return { kind: "image", src };
  const uri = uriList.split("\n")[0]?.trim();
  if (isImagePath(uri)) return { kind: "image", src: uri };
  return null;
}

/**
 * Decide how one stored link renders for a user.
 * @param {object} link stored link entry ({uuid,name,type} or {src,name,showPlayers})
 * @param {object} ctx {isGM, doc} — doc is {permitted, name, img} for a resolved
 *   document, null when the uuid no longer resolves; omit for image links.
 * @returns {object|null} render entry, or null to hide from this user
 */
export function displayLink(link, { isGM, doc }) {
  if (link.src) {
    if (!isGM && link.showPlayers !== true) return null;
    return {
      id: link.id, name: link.name, icon: LINK_ICONS.image, kind: "image",
      src: link.src, img: link.src, showPlayers: link.showPlayers === true
    };
  }
  const icon = LINK_ICONS[link.type] ?? "fa-solid fa-link";
  if (!doc) {
    if (!isGM) return null;
    return { id: link.id, name: link.name, icon, kind: "broken", uuid: link.uuid, img: null };
  }
  if (!doc.permitted) return null;
  return {
    id: link.id, name: doc.name ?? link.name, icon, kind: "document",
    uuid: link.uuid, img: doc.img ?? null
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/timeline-links.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Run the whole unit suite and commit**

Run: `npm test`
Expected: PASS (including i18n gate — this task adds no strings)

```bash
git add scripts/logic/timeline-links.mjs tests/timeline-links.test.js
git commit -m "feat: pure timeline-link logic — dedupe, drop classification, display filtering"
```

---

### Task 2: Data layer — link CRUD and resolution on timepoints

**Files:**
- Modify: `scripts/data/timepoints.mjs` (append after `detachRecord`, around line 68)
- Modify: `scripts/testing/quench.mjs` (imports at top; new `it` blocks inside the `"Timepoints"` describe of the `campaign-record.hub` batch)

**Interfaces:**
- Consumes (Task 1): `withLink`, `withoutLink`, `displayLink` from `../logic/timeline-links.mjs`.
- Produces (used by Tasks 3–4):
  - `addLink(group: JournalEntry, timepointId: string, link: object): Promise<object|null>` — generates `id`, returns the stored entry or null (duplicate / unknown timepoint)
  - `removeLink(group, timepointId, linkId): Promise<void>`
  - `toggleLinkShowPlayers(group, timepointId, linkId): Promise<void>` — image links only, no-op otherwise
  - `resolveLinks(timepoint: object, user: User): object[]` — render entries per `displayLink`, permission checks live (never cached)

- [ ] **Step 1: Write the failing quench tests**

In `scripts/testing/quench.mjs`, extend the timepoints import at the top of the file:

```js
import {
  getTimepoints, addTimepoint, renameTimepoint, moveTimepoint, deleteTimepoint,
  attachRecord, detachRecord, recordsAtTimepoint,
  addLink, removeLink, toggleLinkShowPlayers, resolveLinks
} from "../data/timepoints.mjs";
```

Then add these tests inside the existing `describe("Timepoints", ...)` block (in the `campaign-record.hub` batch), directly after the `it("attaches records and cleans references on delete", ...)` block:

```js
        it("adds document links with dedupe and removes them", async () => {
          const tp = await addTimepoint(group, "Linked Session");
          const entry = await addLink(group, tp.id, {
            uuid: page.uuid, name: page.name, type: "JournalEntryPage"
          });
          assert.ok(entry.id);
          const dup = await addLink(group, tp.id, {
            uuid: page.uuid, name: page.name, type: "JournalEntryPage"
          });
          assert.equal(dup, null);
          let stored = getTimepoints(group).find((t) => t.id === tp.id);
          assert.equal(stored.links.length, 1);
          await removeLink(group, tp.id, entry.id);
          stored = getTimepoints(group).find((t) => t.id === tp.id);
          assert.equal(stored.links.length, 0);
          await deleteTimepoint(group, tp.id);
        });

        it("resolves links live: permitted docs, dangling links, image gating", async () => {
          const tp = await addTimepoint(group, "Resolved Session");
          await addLink(group, tp.id, { uuid: page.uuid, name: "stale name", type: "JournalEntryPage" });
          await addLink(group, tp.id, { uuid: "Actor.deadbeefdead", name: "Ghost", type: "Actor" });
          await addLink(group, tp.id, { src: "icons/svg/mystery-man.svg", name: "mystery-man.svg", showPlayers: false });
          const stored = getTimepoints(group).find((t) => t.id === tp.id);
          const entries = resolveLinks(stored, game.user); // quench runs as GM
          assert.equal(entries.length, 3);
          const doc = entries.find((e) => e.kind === "document");
          assert.equal(doc.name, page.name); // live name, not the cached "stale name"
          assert.ok(entries.some((e) => e.kind === "broken"));
          assert.ok(entries.some((e) => e.kind === "image")); // GM sees hidden images
          await deleteTimepoint(group, tp.id);
        });

        it("toggles showPlayers on image links only", async () => {
          const tp = await addTimepoint(group, "Toggle Session");
          const img = await addLink(group, tp.id, {
            src: "icons/svg/mystery-man.svg", name: "mystery-man.svg", showPlayers: false
          });
          await toggleLinkShowPlayers(group, tp.id, img.id);
          let stored = getTimepoints(group).find((t) => t.id === tp.id);
          assert.equal(stored.links[0].showPlayers, true);
          const doc = await addLink(group, tp.id, { uuid: page.uuid, name: page.name, type: "JournalEntryPage" });
          await toggleLinkShowPlayers(group, tp.id, doc.id); // no-op on documents
          stored = getTimepoints(group).find((t) => t.id === tp.id);
          assert.equal(stored.links.find((l) => l.id === doc.id).showPlayers, undefined);
          await deleteTimepoint(group, tp.id);
        });
```

- [ ] **Step 2: Verify the failing state**

Quench runs inside Foundry, not headless — the fast failing check is the import: the new symbols don't exist yet, so any e2e boot would throw. Verify statically:

Run: `node --input-type=module -e "import('./scripts/data/timepoints.mjs').catch(()=>{}); console.log('syntax ok')"` — this only checks syntax (foundry globals are absent); the real red/green happens in Step 4 and in Task 5's e2e run.
Run: `npm test`
Expected: PASS (quench file is scanned by the i18n gate only for keys; none added)

- [ ] **Step 3: Implement the data layer**

In `scripts/data/timepoints.mjs`, add to the imports at the top:

```js
import { withLink, withoutLink, displayLink } from "../logic/timeline-links.mjs";
```

Append after `detachRecord` (before `recordsAtTimepoint`):

```js
async function updateTimepoint(group, timepointId, patch) {
  const tps = getTimepoints(group).map((t) => (t.id === timepointId ? { ...t, ...patch } : t));
  await setTimepoints(group, tps);
}

/**
 * Attach a document/image link to a timepoint. Generates the link id.
 * Returns the stored entry, or null for a duplicate or unknown timepoint.
 */
export async function addLink(group, timepointId, link) {
  const tp = getTimepoints(group).find((t) => t.id === timepointId);
  if (!tp) return null;
  const entry = { id: foundry.utils.randomID(), ...link };
  const links = withLink(tp.links, entry);
  if (!links) return null;
  await updateTimepoint(group, timepointId, { links });
  return entry;
}

export async function removeLink(group, timepointId, linkId) {
  const tp = getTimepoints(group).find((t) => t.id === timepointId);
  if (!tp) return;
  await updateTimepoint(group, timepointId, { links: withoutLink(tp.links, linkId) });
}

/** Flip an image link's player visibility. No-op for document links. */
export async function toggleLinkShowPlayers(group, timepointId, linkId) {
  const tp = getTimepoints(group).find((t) => t.id === timepointId);
  const link = tp?.links?.find((l) => l.id === linkId);
  if (!link?.src) return;
  const links = tp.links.map((l) =>
    l.id === linkId ? { ...l, showPlayers: l.showPlayers !== true } : l
  );
  await updateTimepoint(group, timepointId, { links });
}

/**
 * Timepoint links resolved and permission-filtered for a user.
 * Permission is evaluated at call time, never cached.
 */
export function resolveLinks(timepoint, user) {
  return (timepoint.links ?? [])
    .map((link) => {
      if (link.src) return displayLink(link, { isGM: user.isGM });
      const doc = fromUuidSync(link.uuid);
      // Compendium index entries lack testUserPermission; GMs pass regardless.
      const permitted = user.isGM || doc?.testUserPermission?.(user, "LIMITED") === true;
      return displayLink(link, {
        isGM: user.isGM,
        doc: doc ? { permitted, name: doc.name, img: doc.img ?? doc.thumb ?? null } : null
      });
    })
    .filter(Boolean);
}
```

- [ ] **Step 4: Verify and commit**

Run: `npm test`
Expected: PASS (pure suite unaffected; no new i18n keys)

The quench batch runs inside Foundry during the e2e world boot; Task 5's full e2e run is the executable verification for this task. If you have the local Foundry server running (see `tests/e2e/README.md`), you can verify now by opening Quench and running the `campaign-record.hub` batch — all three new tests green.

```bash
git add scripts/data/timepoints.mjs scripts/testing/quench.mjs
git commit -m "feat: timepoint link CRUD and live-permission resolution"
```

---

### Task 3: Hub drop handling — accept documents, images, cross-group records

**Files:**
- Modify: `scripts/apps/hub/campaign-hub.mjs` (`#onTimelineDrop`, imports)
- Modify: `lang/en.json` (new `CAMPAIGNRECORD.Hub.*` keys)

**Interfaces:**
- Consumes: `classifyDropData`, `filenameFromSrc` (Task 1); `Timepoints.addLink`, `Timepoints.attachRecord` (Task 2).
- Produces: drop behavior relied on by Task 5's e2e:
  - Foundry document payload `{type, uuid}` → `addLink` document entry
  - file payload (`src`/`path`/`texture.src`/uri-list) → `showPlayers` confirm → `addLink` image entry
  - `campaign-record.record` payload from another group → `addLink` (replaces the old "WrongGroup" warning)
  - unknown payload → `CannotAttach` warning; no group edit permission → `CannotEditTimeline` warning

- [ ] **Step 1: Add the i18n keys (the gate is the failing test)**

In `lang/en.json`, inside the `"Hub"` object after `"WrongGroup": ...` add:

```json
      "CannotEditTimeline": "You lack permission to edit this group's timeline.",
      "ShowImageToPlayers": "Show Image to Players?",
      "ShowImageToPlayersPrompt": "Should players see \"{name}\" on the timeline? You can change this later with the eye toggle on the chip.",
      "BrokenLink": "The linked document no longer exists.",
      "RemoveLink": "Remove this link",
      "ToggleShowPlayers": "Toggle player visibility of this image",
      "ToggleThumbnails": "Toggle thumbnail view"
```

(The last three are consumed by Task 4's template; adding them now keeps this file touched once. After this task nothing references `WrongGroup` anymore — cross-group drops attach instead of warning — but leave the key in place: the i18n gate only checks referenced→present, and an orphan key is harmless.)

- [ ] **Step 2: Widen `#onTimelineDrop`**

In `scripts/apps/hub/campaign-hub.mjs`, add to the imports:

```js
import { classifyDropData, filenameFromSrc } from "../../logic/timeline-links.mjs";
```

Replace the entire `#onTimelineDrop` method (currently lines 314–338) with:

```js
  async #onTimelineDrop(event) {
    const target = event.target.closest("[data-drop-timepoint]");
    if (!target) return;
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      data = {};
    }
    const groupId = target.closest("[data-group-id]").dataset.groupId;
    const group = game.journal.get(groupId);
    const timepointId = target.dataset.timepointId;
    if (data.kind === "campaign-record.timepoint") {
      if (data.groupId !== groupId) return; // no cross-group reordering
      return Timepoints.moveTimepoint(group, data.id, Number(target.dataset.position));
    }
    if (data.kind === "campaign-record.record") {
      const page = await fromUuid(data.uuid);
      if (!page) return;
      if (page.parent.id !== groupId) {
        // Cross-group records attach as document links instead of warning.
        return this.#dropLink(group, timepointId, {
          uuid: page.uuid, name: page.name, type: "JournalEntryPage"
        });
      }
      if (!page.system?.schema?.fields?.timepoints) {
        return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.CannotAttach"));
      }
      return Timepoints.attachRecord(page, timepointId);
    }
    const drop = classifyDropData(data, event.dataTransfer.getData("text/uri-list"));
    if (!drop) {
      return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.CannotAttach"));
    }
    if (drop.kind === "document") {
      const doc = await fromUuid(drop.uuid);
      if (!doc) {
        return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.CannotAttach"));
      }
      // A same-group record page dropped via Foundry drag data uses the
      // record-attachment path so it stays a first-class record chip.
      if (doc.documentName === "JournalEntryPage" && doc.parent?.id === groupId
          && doc.system?.schema?.fields?.timepoints) {
        return Timepoints.attachRecord(doc, timepointId);
      }
      return this.#dropLink(group, timepointId, { uuid: drop.uuid, name: doc.name, type: drop.type });
    }
    const showPlayers = await foundry.applications.api.DialogV2.confirm({
      window: { title: "CAMPAIGNRECORD.Hub.ShowImageToPlayers" },
      content: `<p>${game.i18n.format("CAMPAIGNRECORD.Hub.ShowImageToPlayersPrompt", {
        name: foundry.utils.escapeHTML(filenameFromSrc(drop.src))
      })}</p>`,
      rejectClose: false
    });
    if (showPlayers === null) return; // dialog dismissed: cancel the drop
    return this.#dropLink(group, timepointId, {
      src: drop.src, name: filenameFromSrc(drop.src), showPlayers: showPlayers === true
    });
  }

  /** Permission-checked link attach shared by the drop paths. */
  async #dropLink(group, timepointId, link) {
    if (!group.canUserModify(game.user, "update")) {
      return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.CannotEditTimeline"));
    }
    await Timepoints.addLink(group, timepointId, link);
  }
```

Note the deliberate behavior change from the old method: a malformed `text/plain` payload no longer aborts immediately (`data = {}`), because a FilePicker/uri-list drop may carry no JSON at all — classification decides.

- [ ] **Step 3: Verify and commit**

Run: `npm test`
Expected: PASS — in particular `tests/i18n-coverage.test.js` (all keys referenced by the new code resolve).

```bash
git add scripts/apps/hub/campaign-hub.mjs lang/en.json
git commit -m "feat: timeline drop accepts documents, image files, and cross-group records as links"
```

---

### Task 4: Rendering and interactions — chips, thumbnails toggle, actions

**Files:**
- Modify: `scripts/constants.mjs` (setting key)
- Modify: `scripts/hooks/hub-ui.mjs` (`registerHubSettings`)
- Modify: `scripts/campaign-record.mjs` (call it during init)
- Modify: `scripts/apps/hub/campaign-hub.mjs` (`#timelineGroups`, `_prepareContext`, actions)
- Modify: `templates/hub/timeline.hbs`
- Modify: `styles/campaign-record.css`

**Interfaces:**
- Consumes: `Timepoints.resolveLinks`, `Timepoints.removeLink`, `Timepoints.toggleLinkShowPlayers` (Task 2).
- Produces (relied on by Task 5's e2e):
  - Client setting `campaign-record.timelineThumbnails` (Boolean, default false, `config: false`)
  - Template hooks: `.link-chip[data-link-id][data-action="openLink"]`, `a[data-action="removeLink"]`, `a[data-action="toggleLinkShowPlayers"]`, header `button[data-action="toggleThumbnails"]`, `img.link-thumb`

- [ ] **Step 1: Register the client setting**

`scripts/constants.mjs` — append:

```js
/** Client setting: render timeline links as thumbnails instead of icon chips. */
export const THUMBNAILS_SETTING = "timelineThumbnails";
```

`scripts/hooks/hub-ui.mjs` — change the constants import to `import { MODULE_ID, THUMBNAILS_SETTING } from "../constants.mjs";` and append:

```js
/** Hub client preferences. Call during init. */
export function registerHubSettings() {
  game.settings.register(MODULE_ID, THUMBNAILS_SETTING, {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });
}
```

`scripts/campaign-record.mjs` — extend the hub-ui import and init block:

```js
import { registerHubUI, registerHubKeybinding, registerHubSettings } from "./hooks/hub-ui.mjs";
```

and inside `Hooks.once("init", ...)` after `registerHubKeybinding();` add:

```js
  registerHubSettings();
```

- [ ] **Step 2: Prepare link render data in the hub**

In `scripts/apps/hub/campaign-hub.mjs`, extend the constants import:

```js
import { MODULE_ID, THUMBNAILS_SETTING, RECORD_TYPES, typeId } from "../../constants.mjs";
```

(Replace the existing `import { RECORD_TYPES, typeId } from "../../constants.mjs";` line.)

Replace `#timelineGroups()` with:

```js
  #timelineGroups() {
    const thumbnails = game.settings.get(MODULE_ID, THUMBNAILS_SETTING);
    return getScopedGroups(this.state.groupId).map((group) => {
      const canEdit = group.canUserModify(game.user, "update");
      return {
        id: group.id,
        name: group.name,
        canEdit,
        timepoints: Timepoints.getTimepoints(group).map((tp, i) => ({
          ...tp,
          position: i,
          canEdit,
          records: Timepoints.recordsAtTimepoint(group, tp.id, game.user).map((p) => ({
            uuid: p.uuid, name: p.name
          })),
          links: Timepoints.resolveLinks(tp, game.user).map((entry) => ({
            ...entry,
            broken: entry.kind === "broken",
            thumb: thumbnails && entry.img ? entry.img : null,
            canToggleVisibility: canEdit && game.user.isGM && entry.kind === "image"
          }))
        }))
      };
    });
  }
```

In `_prepareContext`, after `context.timelineGroups = this.#timelineGroups();` add:

```js
    context.thumbnails = game.settings.get(MODULE_ID, THUMBNAILS_SETTING);
```

- [ ] **Step 3: Add the actions**

In `DEFAULT_OPTIONS.actions` add after `detachRecord: CampaignHub.#onDetachRecord`:

```js
      openLink: CampaignHub.#onOpenLink,
      removeLink: CampaignHub.#onRemoveLink,
      toggleLinkShowPlayers: CampaignHub.#onToggleLinkShowPlayers,
      toggleThumbnails: CampaignHub.#onToggleThumbnails
```

Add the handlers after `#onDetachRecord`:

```js
  static async #onOpenLink(event, target) {
    const chip = target.closest("[data-link-id]");
    const { uuid, src, name } = chip.dataset;
    if (src) {
      return new foundry.applications.apps.ImagePopout({ src, window: { title: name } }).render(true);
    }
    const doc = await fromUuid(uuid);
    if (!doc) return ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Hub.BrokenLink"));
    if (doc.documentName === "JournalEntryPage") {
      const sheet = doc.parent.sheet;
      await sheet.render(true);
      return sheet.goToPage(doc.id);
    }
    doc.sheet.render(true);
  }

  static async #onRemoveLink(event, target) {
    const group = game.journal.get(target.closest("[data-group-id]").dataset.groupId);
    const timepointId = target.closest("[data-timepoint-id]").dataset.timepointId;
    const linkId = target.closest("[data-link-id]").dataset.linkId;
    if (group) await Timepoints.removeLink(group, timepointId, linkId);
  }

  static async #onToggleLinkShowPlayers(event, target) {
    const group = game.journal.get(target.closest("[data-group-id]").dataset.groupId);
    const timepointId = target.closest("[data-timepoint-id]").dataset.timepointId;
    const linkId = target.closest("[data-link-id]").dataset.linkId;
    if (group) await Timepoints.toggleLinkShowPlayers(group, timepointId, linkId);
  }

  static async #onToggleThumbnails() {
    const current = game.settings.get(MODULE_ID, THUMBNAILS_SETTING);
    await game.settings.set(MODULE_ID, THUMBNAILS_SETTING, !current);
    this.render();
  }
```

(`openLink` clicks on the ✕/eye anchors never fire — inner `[data-action]` elements win in ApplicationV2's action dispatch, same as the existing `detachRecord` anchor inside `openRecord` chips.)

- [ ] **Step 4: Template**

In `templates/hub/timeline.hbs`:

After the opening `<section class="tab hub-timeline...>` line (line 1), insert the tools row:

```hbs
  <div class="timeline-tools">
    <button type="button" data-action="toggleThumbnails"
            class="{{#if thumbnails}}active{{/if}}"
            data-tooltip="CAMPAIGNRECORD.Hub.ToggleThumbnails">
      <i class="fa-solid fa-image"></i>
    </button>
  </div>
```

Inside `<div class="timepoint-records">`, after the record-chip `{{/each}}` and before `</div>`, add:

```hbs
          {{#each this.links}}
          <span class="record-chip link-chip{{#if this.broken}} broken{{/if}}"
                data-link-id="{{this.id}}" data-action="openLink" data-name="{{this.name}}"
                {{#if this.uuid}}data-uuid="{{this.uuid}}"{{/if}}
                {{#if this.src}}data-src="{{this.src}}"{{/if}}>
            {{#if this.thumb}}<img class="link-thumb" src="{{this.thumb}}" alt="">{{else}}<i class="{{this.icon}}"></i>{{/if}}
            {{this.name}}
            {{#if this.canToggleVisibility}}
            <a data-action="toggleLinkShowPlayers" data-tooltip="CAMPAIGNRECORD.Hub.ToggleShowPlayers"><i class="fa-solid {{#if this.showPlayers}}fa-eye{{else}}fa-eye-slash{{/if}}"></i></a>
            {{/if}}
            {{#if ../canEdit}}
            <a data-action="removeLink" data-tooltip="CAMPAIGNRECORD.Hub.RemoveLink"><i class="fa-solid fa-xmark"></i></a>
            {{/if}}
          </span>
          {{/each}}
```

- [ ] **Step 5: Styles**

Append to `styles/campaign-record.css` after the `.campaign-hub .record-chip` rule:

```css
.campaign-hub .link-chip > i {
  font-size: 0.85em;
  opacity: 0.8;
}

.campaign-hub .link-chip.broken {
  text-decoration: line-through;
  opacity: 0.6;
}

.campaign-hub .link-thumb {
  width: 24px;
  height: 24px;
  object-fit: cover;
  border-radius: 3px;
  border: none;
}

.campaign-hub .timeline-tools {
  display: flex;
  justify-content: flex-end;
  margin: 0 0 0.25rem;
}

.campaign-hub .timeline-tools button {
  width: auto;
  line-height: 1;
  padding: 0.15rem 0.5rem;
}

.campaign-hub .timeline-tools button.active {
  box-shadow: 0 0 4px var(--color-shadow-primary, #ff6400) inset;
}
```

- [ ] **Step 6: Verify and commit**

Run: `npm test`
Expected: PASS — the i18n gate now sees `ToggleThumbnails`, `ToggleShowPlayers`, `RemoveLink`, `BrokenLink` referenced and present (added in Task 3).

```bash
git add scripts/constants.mjs scripts/hooks/hub-ui.mjs scripts/campaign-record.mjs \
  scripts/apps/hub/campaign-hub.mjs templates/hub/timeline.hbs styles/campaign-record.css
git commit -m "feat: timeline link chips with thumbnails toggle, open/remove/visibility actions"
```

---

### Task 5: End-to-end coverage

**Files:**
- Create: `tests/e2e/19-hub-timeline-links.spec.mjs`

**Interfaces:**
- Consumes: everything above via the browser; helper functions from `tests/e2e/helpers/foundry.mjs` (`login`, `deleteGroupsByPrefix`, `createGroupWithPage`, `settle`); the synthetic `DragEvent` + `DataTransfer` dispatch pattern from `tests/e2e/08-hub-timeline.spec.mjs:99-135`.
- Produces: regression coverage for drop paths, permission gating, showPlayers gating, broken links, thumbnail toggle, cross-group link attach.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/19-hub-timeline-links.spec.mjs`:

```js
import { test, expect } from "@playwright/test";
import { login, deleteGroupsByPrefix, createGroupWithPage, settle } from "./helpers/foundry.mjs";

test.describe("hub timeline links", () => {
  let gmPage, playerCtx, playerPage, ids, actors;

  const openTimeline = async (p) => {
    await p.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = p.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    await hub.locator('[data-action="tab"][data-tab="timeline"]').click();
    return hub;
  };

  const dispatchDrop = (p, selector, payload) =>
    p.evaluate(([selector, payload]) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify(payload));
      const el = document.querySelector(selector);
      if (!el) throw new Error(`drop target not found: ${selector}`);
      el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, [selector, payload]);

  test.beforeAll(async ({ browser }) => {
    gmPage = await browser.newPage();
    await login(gmPage, "Gamemaster");
    ids = await createGroupWithPage(gmPage, "E2E Links Group", "E2E Links NPC", "campaign-record.npc");
    actors = await gmPage.evaluate(async () => {
      const secret = await Actor.implementation.create({
        name: "E2E Secret Villain", type: game.system.id === "dnd5e" ? "npc" : Object.keys(CONFIG.Actor.dataModels)[0] ?? "base",
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }
      });
      const known = await Actor.implementation.create({
        name: "E2E Known Ally", type: secret.type,
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
      });
      const { addTimepoint } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = game.journal.getName("E2E Links Group");
      await addTimepoint(group, "Linked Session");
      return { secretUuid: secret.uuid, knownUuid: known.uuid, secretId: secret.id, knownId: known.id };
    });
    playerCtx = await browser.newContext();
    playerPage = await playerCtx.newPage();
    await login(playerPage, "User 1");
  });

  test.afterAll(async () => {
    await gmPage.evaluate(async ({ secretId, knownId }) => {
      await game.actors.get(secretId)?.delete();
      await game.actors.get(knownId)?.delete();
    }, actors);
    await deleteGroupsByPrefix(gmPage, "E2E Links");
    await playerCtx.close();
    await gmPage.close();
  });

  test("dropped actors become link chips filtered by ownership", async () => {
    const gmHub = await openTimeline(gmPage);
    const dropSelector = `#campaign-hub .timeline-group[data-group-id="${ids.groupId}"] [data-drop-timepoint]`;
    await dispatchDrop(gmPage, dropSelector, { type: "Actor", uuid: actors.secretUuid });
    await dispatchDrop(gmPage, dropSelector, { type: "Actor", uuid: actors.knownUuid });

    await expect(gmHub.locator(".link-chip", { hasText: "E2E Secret Villain" })).toBeVisible({ timeout: 10_000 });
    await expect(gmHub.locator(".link-chip", { hasText: "E2E Known Ally" })).toBeVisible();

    const playerHub = await openTimeline(playerPage);
    await expect(playerHub.locator(".link-chip", { hasText: "E2E Known Ally" })).toBeVisible({ timeout: 10_000 });
    await expect(playerHub.locator(".link-chip", { hasText: "E2E Secret Villain" })).toHaveCount(0);
  });

  test("duplicate drop of the same document does not add a second chip", async () => {
    const gmHub = gmPage.locator("#campaign-hub");
    const dropSelector = `#campaign-hub .timeline-group[data-group-id="${ids.groupId}"] [data-drop-timepoint]`;
    await dispatchDrop(gmPage, dropSelector, { type: "Actor", uuid: actors.knownUuid });
    await settle(gmPage);
    await expect(gmHub.locator(".link-chip", { hasText: "E2E Known Ally" })).toHaveCount(1);
  });

  test("image drop prompts for player visibility; eye toggle reveals it live", async () => {
    const gmHub = gmPage.locator("#campaign-hub");
    const dropSelector = `#campaign-hub .timeline-group[data-group-id="${ids.groupId}"] [data-drop-timepoint]`;
    await dispatchDrop(gmPage, dropSelector, { src: "icons/svg/mystery-man.svg" });
    const noButton = gmPage.locator('dialog button[data-action="no"], .application.dialog button[data-action="no"]');
    await noButton.waitFor({ timeout: 10_000 });
    await noButton.click();

    const gmImageChip = gmHub.locator(".link-chip", { hasText: "mystery-man.svg" });
    await expect(gmImageChip).toBeVisible({ timeout: 10_000 });

    const playerHub = playerPage.locator("#campaign-hub");
    await expect(playerHub.locator(".link-chip", { hasText: "mystery-man.svg" })).toHaveCount(0);

    await gmImageChip.locator('[data-action="toggleLinkShowPlayers"]').click();
    await expect(playerHub.locator(".link-chip", { hasText: "mystery-man.svg" }))
      .toBeVisible({ timeout: 10_000 });
  });

  test("clicking an image chip opens an image popout", async () => {
    const gmHub = gmPage.locator("#campaign-hub");
    // click the chip body, not its inner action anchors
    await gmHub.locator(".link-chip", { hasText: "mystery-man.svg" }).locator("i").first().click();
    await expect(gmPage.locator(".image-popout, .app.image-popout, .application.image-popout"))
      .toBeVisible({ timeout: 10_000 });
    await gmPage.keyboard.press("Escape");
  });

  test("dangling links render GM-only as broken chips", async () => {
    await gmPage.evaluate(async ({ groupId }) => {
      const { getTimepoints, addLink } = await import("/modules/campaign-record/scripts/data/timepoints.mjs");
      const group = game.journal.get(groupId);
      await addLink(group, getTimepoints(group)[0].id, {
        uuid: "Actor.deadbeefdead", name: "E2E Ghost", type: "Actor"
      });
    }, { groupId: ids.groupId });
    const gmHub = gmPage.locator("#campaign-hub");
    await expect(gmHub.locator(".link-chip.broken", { hasText: "E2E Ghost" })).toBeVisible({ timeout: 10_000 });
    await expect(playerPage.locator("#campaign-hub .link-chip", { hasText: "E2E Ghost" })).toHaveCount(0);
  });

  test("thumbnail toggle switches image chips to thumbnails and persists the setting", async () => {
    const gmHub = gmPage.locator("#campaign-hub");
    await gmHub.locator('button[data-action="toggleThumbnails"]').click();
    await expect(gmHub.locator(".link-chip img.link-thumb").first()).toBeVisible({ timeout: 10_000 });
    const stored = await gmPage.evaluate(() => game.settings.get("campaign-record", "timelineThumbnails"));
    expect(stored).toBe(true);
    await gmHub.locator('button[data-action="toggleThumbnails"]').click();
    await expect(gmHub.locator(".link-chip img.link-thumb")).toHaveCount(0);
  });

  test("cross-group record drop attaches as a link instead of warning", async () => {
    const otherIds = await createGroupWithPage(
      gmPage, "E2E Links Other Group", "E2E Links Other NPC", "campaign-record.npc"
    );
    const dropSelector = `#campaign-hub .timeline-group[data-group-id="${ids.groupId}"] [data-drop-timepoint]`;
    await dispatchDrop(gmPage, dropSelector, { kind: "campaign-record.record", uuid: otherIds.pageUuid });
    await expect(gmPage.locator("#campaign-hub .link-chip", { hasText: "E2E Links Other NPC" }))
      .toBeVisible({ timeout: 10_000 });
  });

  test("GM removes a link with the chip's remove control", async () => {
    const gmHub = gmPage.locator("#campaign-hub");
    const chip = gmHub.locator(".link-chip", { hasText: "E2E Known Ally" });
    await chip.locator('[data-action="removeLink"]').click();
    await expect(gmHub.locator(".link-chip", { hasText: "E2E Known Ally" })).toHaveCount(0, { timeout: 10_000 });
  });
});
```

Adjust only if reality disagrees: the actor `type` fallback in `beforeAll` handles worlds whose system has no `npc` type, and the popout selector list covers v13's ImagePopout class names — check the actual DOM if the assertion fails and pin the right selector.

- [ ] **Step 2: Run the new spec**

Run: `npx playwright test tests/e2e/19-hub-timeline-links.spec.mjs`
Expected: PASS (the helper boots the local Foundry test world automatically; see `tests/e2e/README.md` if the server isn't available)

- [ ] **Step 3: Run everything**

Run: `npm test && npx playwright test`
Expected: PASS across the board — unit suites, i18n gate, and all e2e specs including the pre-existing `08-hub-timeline.spec.mjs`. **Note:** 08's test "cross-group record drop warns and does not attach" (around line 150) asserts the old WrongGroup warning; Task 3 changed that behavior, so update that test in `08-hub-timeline.spec.mjs` to assert a `.link-chip` appears instead of a warning notification, keeping the rest of the spec untouched.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/19-hub-timeline-links.spec.mjs tests/e2e/08-hub-timeline.spec.mjs
git commit -m "test: e2e coverage for timeline document/image links"
```
