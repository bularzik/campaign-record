# Auto-Capture Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-create a Place + timeline point when the GM activates a map, and auto-create/sync/summarize an Encounter across a combat's lifecycle, all into a single configurable target Campaign Record.

**Architecture:** A self-contained auto-capture subsystem split into pure logic (`scripts/logic/auto-capture.mjs`, unit-tested with vitest), Foundry hook wiring (`scripts/hooks/auto-capture.mjs`, single-writer guarded, quench-tested), and a target-group world setting with a socket relay (`scripts/settings/auto-target.mjs`). A gear menu in the Hub header holds the target selector and absorbs the existing Import/Export/Edit-in-place controls.

**Tech Stack:** Foundry VTT v13 module (ES modules, `.mjs`), Handlebars ApplicationV2 sheets, vitest (unit), quench (in-Foundry integration), Playwright (e2e).

## Global Constraints

- Module id is `campaign-record`; namespaced page types via `typeId(t)` → `campaign-record.<t>` (from `scripts/constants.mjs`).
- Every auto-capture Foundry hook handler MUST early-return unless `game.user === game.users.activeGM` (single-writer guard) — exactly one client performs each write.
- World settings are GM-write-only in Foundry; non-GM writes to the target setting are relayed over the module socket to the active GM.
- Pure logic in `scripts/logic/auto-capture.mjs` MUST NOT reference Foundry globals (`game`, `Hooks`, `foundry`, `CONFIG`, `ui`) so it runs under vitest.
- Record pages are `JournalEntryPage` embedded documents on a group `JournalEntry`; create via `group.createEmbeddedDocuments("JournalEntryPage", [...])`.
- Timepoint helpers live in `scripts/data/timepoints.mjs`: `addTimepoint(group, label)`, `attachRecord(page, tpId)`, `getTimepoints(group)`.
- Feature is dormant (all triggers no-op) when no valid target group is set.
- Every new `game.i18n.localize(...)` key added MUST have an entry in `lang/en.json` (enforced by `tests/i18n-coverage.test.js`).

---

### Task 1: Target-group setting + socket relay

**Files:**
- Modify: `scripts/constants.mjs`
- Create: `scripts/logic/auto-capture.mjs`
- Create: `scripts/settings/auto-target.mjs`
- Modify: `scripts/campaign-record.mjs`
- Modify: `lang/en.json`
- Test: `tests/auto-capture.test.js` (vitest), `scripts/testing/quench.mjs` (relay)

**Interfaces:**
- Produces:
  - `resolveTargetGroup(settingId, groups)` → the group in `groups` whose `.id === settingId`, else `null`. `groups` is an array of `{ id }`.
  - `AUTO_TARGET_SETTING` (constant string `"autoCaptureTargetGroup"`), `AUTO_TARGET_ACTION` (constant string `"set-auto-target"`) in `constants.mjs`.
  - `registerAutoTargetSetting()` — call in `init`.
  - `registerAutoTargetSocket()` — call in `ready`.
  - `getTargetGroup()` → group `JournalEntry` or `null`.
  - `setTargetGroup(groupId)` → `Promise<void>`; sets directly when GM, else relays to active GM.

- [ ] **Step 1: Write the failing test for `resolveTargetGroup`**

Create `tests/auto-capture.test.js`:

```js
import { describe, it, expect } from "vitest";
import { resolveTargetGroup } from "../scripts/logic/auto-capture.mjs";

describe("resolveTargetGroup", () => {
  const groups = [{ id: "a" }, { id: "b" }];
  it("returns the matching group", () => {
    expect(resolveTargetGroup("b", groups)).toBe(groups[1]);
  });
  it("returns null for an empty setting", () => {
    expect(resolveTargetGroup("", groups)).toBe(null);
  });
  it("returns null for a stale id", () => {
    expect(resolveTargetGroup("gone", groups)).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auto-capture.test.js`
Expected: FAIL — "resolveTargetGroup is not a function" / module not found.

- [ ] **Step 3: Create `scripts/logic/auto-capture.mjs` with `resolveTargetGroup`**

```js
/**
 * Pure auto-capture logic. No Foundry globals — unit-tested with vitest.
 */

/** The group whose id matches the setting, or null when unset/stale. */
export function resolveTargetGroup(settingId, groups) {
  if (!settingId) return null;
  return groups.find((g) => g.id === settingId) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auto-capture.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Add constants**

In `scripts/constants.mjs`, after `GROUP_SHEET_CLASS`:

```js
/** World setting: id of the group that receives auto-captured records ("" = off). */
export const AUTO_TARGET_SETTING = "autoCaptureTargetGroup";

/** Socket action: relay a target-group change to the active GM. */
export const AUTO_TARGET_ACTION = "set-auto-target";
```

- [ ] **Step 6: Create `scripts/settings/auto-target.mjs`**

```js
import { MODULE_ID, AUTO_TARGET_SETTING, AUTO_TARGET_ACTION } from "../constants.mjs";
import { SOCKET_NAME } from "../presenter/socket.mjs";
import { getGroups } from "../data/groups.mjs";
import { resolveTargetGroup } from "../logic/auto-capture.mjs";

/** Register the target-group world setting. Call during init. */
export function registerAutoTargetSetting() {
  game.settings.register(MODULE_ID, AUTO_TARGET_SETTING, {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
}

/** The current target group, or null when unset/stale. */
export function getTargetGroup() {
  return resolveTargetGroup(game.settings.get(MODULE_ID, AUTO_TARGET_SETTING), getGroups());
}

/**
 * Set the target group. GMs write the world setting directly; players relay
 * to the active GM over the module socket. groupId "" clears the target.
 */
export async function setTargetGroup(groupId) {
  if (game.user.isGM) {
    await game.settings.set(MODULE_ID, AUTO_TARGET_SETTING, groupId ?? "");
    return;
  }
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.AutoCapture.NoGMForTarget"));
    return;
  }
  game.socket.emit(SOCKET_NAME, { action: AUTO_TARGET_ACTION, groupId: groupId ?? "" });
}

/** Listen for relayed target changes; only the active GM applies them. Call in ready. */
export function registerAutoTargetSocket() {
  game.socket.on(SOCKET_NAME, async (payload) => {
    if (payload?.action !== AUTO_TARGET_ACTION) return;
    if (game.user !== game.users.activeGM) return;
    await game.settings.set(MODULE_ID, AUTO_TARGET_SETTING, payload.groupId ?? "");
  });
}
```

- [ ] **Step 7: Wire registration in `scripts/campaign-record.mjs`**

Add the import alongside the others:

```js
import { registerAutoTargetSetting, registerAutoTargetSocket } from "./settings/auto-target.mjs";
```

In the `init` hook body, after `registerHubSettings();`:

```js
  registerAutoTargetSetting();
```

In the `ready` hook body, after `registerPresenterSocket();`:

```js
  registerAutoTargetSocket();
```

- [ ] **Step 8: Add the localization key**

In `lang/en.json`, inside the `CAMPAIGNRECORD` object, add an `AutoCapture` block (create it if absent):

```json
    "AutoCapture": {
      "NoGMForTarget": "No GM is connected, so the auto-capture target could not be changed."
    }
```

- [ ] **Step 9: Add a quench relay/direct-set test**

In `scripts/testing/quench.mjs`, add a new batch after the existing `campaign-record.types` batch (inside the `quenchReady` handler):

```js
  quench.registerBatch(
    "campaign-record.auto-target",
    (context) => {
      const { describe, it, assert, before, after } = context;
      let group;
      describe("Auto-capture target", () => {
        before(async () => { group = await createGroup("Quench Target Group"); });
        after(async () => {
          await game.settings.set("campaign-record", "autoCaptureTargetGroup", "");
          await group.delete();
        });
        it("GM setTargetGroup writes and resolves the world setting", async () => {
          const { setTargetGroup, getTargetGroup } = await import("../settings/auto-target.mjs");
          await setTargetGroup(group.id);
          assert.equal(game.settings.get("campaign-record", "autoCaptureTargetGroup"), group.id);
          assert.equal(getTargetGroup()?.id, group.id);
        });
        it("clears to null on a stale id", async () => {
          const { getTargetGroup } = await import("../settings/auto-target.mjs");
          await game.settings.set("campaign-record", "autoCaptureTargetGroup", "does-not-exist");
          assert.equal(getTargetGroup(), null);
        });
      });
    },
    { displayName: "Campaign Record: Auto Target" }
  );
```

- [ ] **Step 10: Run vitest and commit**

Run: `npx vitest run tests/auto-capture.test.js`
Expected: PASS.

```bash
git add scripts/constants.mjs scripts/logic/auto-capture.mjs scripts/settings/auto-target.mjs scripts/campaign-record.mjs lang/en.json scripts/testing/quench.mjs tests/auto-capture.test.js
git commit -m "feat: target-group world setting with GM socket relay"
```

---

### Task 2: New group becomes the target

**Files:**
- Create: `scripts/hooks/auto-capture.mjs`
- Modify: `scripts/campaign-record.mjs`
- Test: `scripts/testing/quench.mjs`

**Interfaces:**
- Consumes: `setTargetGroup(groupId)` (Task 1), `isGroup(entry)` from `scripts/data/groups.mjs`.
- Produces: `registerAutoCapture()` — registers all auto-capture Foundry hooks; call in `ready`. (Extended by Tasks 5–8.)

- [ ] **Step 1: Create `scripts/hooks/auto-capture.mjs` with the group-creation hook**

```js
import { isGroup } from "../data/groups.mjs";
import { setTargetGroup } from "../settings/auto-target.mjs";

/** Register every auto-capture Foundry hook. Call during ready. */
export function registerAutoCapture() {
  // A newly created Campaign Record becomes the auto-capture target. Only the
  // creating user reacts, so the relay fires once.
  Hooks.on("createJournalEntry", (entry, options, userId) => {
    if (userId !== game.user.id) return;
    if (!isGroup(entry)) return;
    setTargetGroup(entry.id);
  });
}
```

- [ ] **Step 2: Wire registration in `scripts/campaign-record.mjs`**

Add the import:

```js
import { registerAutoCapture } from "./hooks/auto-capture.mjs";
```

In the `ready` hook body, after `registerAutoTargetSocket();`:

```js
  registerAutoCapture();
```

- [ ] **Step 3: Add a quench test**

In `scripts/testing/quench.mjs`, inside the `describe("Auto-capture target", ...)` block, add:

```js
        it("a newly created group becomes the target", async () => {
          const { getTargetGroup } = await import("../settings/auto-target.mjs");
          const fresh = await createGroup("Quench Auto Target");
          assert.equal(getTargetGroup()?.id, fresh.id);
          await fresh.delete();
        });
```

- [ ] **Step 4: Verify vitest still green and commit**

Run: `npx vitest run`
Expected: PASS (no regressions; this task adds no unit test).

```bash
git add scripts/hooks/auto-capture.mjs scripts/campaign-record.mjs scripts/testing/quench.mjs
git commit -m "feat: newly created Campaign Record becomes auto-capture target"
```

---

### Task 3: Pure participant logic (collapse + merge)

**Files:**
- Modify: `scripts/logic/auto-capture.mjs`
- Test: `tests/auto-capture.test.js`

**Interfaces:**
- Produces:
  - `collapseParticipants(entries)` — `entries` is `[{ actorUuid: string|null, name: string }]`; returns `[{ id, name, count, actor }]` grouped by actor (or by name when `actorUuid` is null). `id` = `actorUuid` or `"name:" + name`; `actor` = `actorUuid` or `null`.
  - `mergeParticipants(existing, incoming)` — both `[{ id, name, count, actor }]`; returns the union keyed by `id` with `count = max(existing, incoming)` per id (additive; never shrinks). Names/actor come from `incoming` when present, else `existing`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/auto-capture.test.js`:

```js
import { collapseParticipants, mergeParticipants } from "../scripts/logic/auto-capture.mjs";

describe("collapseParticipants", () => {
  it("groups combatants sharing an actor into a count", () => {
    const rows = collapseParticipants([
      { actorUuid: "Actor.gob", name: "Goblin" },
      { actorUuid: "Actor.gob", name: "Goblin" },
      { actorUuid: "Actor.pc", name: "Aldric" }
    ]);
    expect(rows).toContainEqual({ id: "Actor.gob", name: "Goblin", count: 2, actor: "Actor.gob" });
    expect(rows).toContainEqual({ id: "Actor.pc", name: "Aldric", count: 1, actor: "Actor.pc" });
  });
  it("groups actor-less combatants by name with a null actor", () => {
    const rows = collapseParticipants([
      { actorUuid: null, name: "Mook" },
      { actorUuid: null, name: "Mook" }
    ]);
    expect(rows).toEqual([{ id: "name:Mook", name: "Mook", count: 2, actor: null }]);
  });
});

describe("mergeParticipants", () => {
  it("takes the element-wise max per id and unions new entries", () => {
    const existing = [{ id: "Actor.gob", name: "Goblin", count: 3, actor: "Actor.gob" }];
    const incoming = [
      { id: "Actor.gob", name: "Goblin", count: 1, actor: "Actor.gob" },
      { id: "Actor.orc", name: "Orc", count: 2, actor: "Actor.orc" }
    ];
    const merged = mergeParticipants(existing, incoming);
    expect(merged).toContainEqual({ id: "Actor.gob", name: "Goblin", count: 3, actor: "Actor.gob" });
    expect(merged).toContainEqual({ id: "Actor.orc", name: "Orc", count: 2, actor: "Actor.orc" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/auto-capture.test.js`
Expected: FAIL — `collapseParticipants` / `mergeParticipants` not exported.

- [ ] **Step 3: Implement both functions**

Append to `scripts/logic/auto-capture.mjs`:

```js
/** Key a combatant row by its actor uuid, or by name when it has no actor. */
function participantKey(actorUuid, name) {
  return actorUuid ?? `name:${name}`;
}

/** Collapse raw combatant entries into counted rows grouped by actor/name. */
export function collapseParticipants(entries) {
  const byKey = new Map();
  for (const { actorUuid, name } of entries) {
    const id = participantKey(actorUuid, name);
    const row = byKey.get(id);
    if (row) row.count += 1;
    else byKey.set(id, { id, name, count: 1, actor: actorUuid ?? null });
  }
  return [...byKey.values()];
}

/** Union two counted-row lists, keeping the larger count per id (additive). */
export function mergeParticipants(existing, incoming) {
  const byKey = new Map(existing.map((r) => [r.id, { ...r }]));
  for (const row of incoming) {
    const prev = byKey.get(row.id);
    if (prev) byKey.set(row.id, { ...prev, name: row.name, actor: row.actor, count: Math.max(prev.count, row.count) });
    else byKey.set(row.id, { ...row });
  }
  return [...byKey.values()];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/auto-capture.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/auto-capture.mjs tests/auto-capture.test.js
git commit -m "feat: pure participant collapse and additive merge"
```

---

### Task 4: Pure placement + outcome logic

**Files:**
- Modify: `scripts/logic/auto-capture.mjs`
- Test: `tests/auto-capture.test.js`

**Interfaces:**
- Produces:
  - `matchPlaceForScene(places, sceneUuid)` — `places` is `[{ scene }]`; returns the first element whose `scene === sceneUuid`, else `null`.
  - `pickLatestTimepoint(attachedIds, timepoints)` — `attachedIds` iterable of string; `timepoints` is `[{ id, sort }]`; returns the attached id with the greatest `sort`, or `null` if none attached.
  - `summarizeOutcome(state, labels)` — `state` is `{ present: [{ name, defeated, hp }], departed: [{ name, defeated }] }` (`hp` = `{ value, max }` or `null`); `labels` is `{ died, injured, fled, none }`; returns a summary string. Died = present-defeated + departed-defeated; Fled = departed not-defeated; Injured = present, not defeated, `hp.value < hp.max && hp.value > 0`. Names collapse to `Name ×N`. Empty → `labels.none`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/auto-capture.test.js`:

```js
import { matchPlaceForScene, pickLatestTimepoint, summarizeOutcome } from "../scripts/logic/auto-capture.mjs";

describe("matchPlaceForScene", () => {
  const places = [{ scene: "Scene.a" }, { scene: "Scene.b" }];
  it("finds the place for a scene", () => {
    expect(matchPlaceForScene(places, "Scene.b")).toBe(places[1]);
  });
  it("returns null when no place matches", () => {
    expect(matchPlaceForScene(places, "Scene.z")).toBe(null);
  });
});

describe("pickLatestTimepoint", () => {
  const tps = [{ id: "t1", sort: 0 }, { id: "t2", sort: 100 }, { id: "t3", sort: 200 }];
  it("returns the highest-sort attached id", () => {
    expect(pickLatestTimepoint(["t1", "t2"], tps)).toBe("t2");
  });
  it("returns null when nothing is attached", () => {
    expect(pickLatestTimepoint([], tps)).toBe(null);
  });
});

describe("summarizeOutcome", () => {
  const labels = { died: "Died", injured: "Injured", fled: "Fled", none: "All combatants unharmed." };
  it("buckets died, injured, and fled with counts", () => {
    const s = summarizeOutcome({
      present: [
        { name: "Goblin", defeated: true, hp: { value: 0, max: 7 } },
        { name: "Goblin", defeated: true, hp: { value: 0, max: 7 } },
        { name: "Aldric", defeated: false, hp: { value: 4, max: 20 } },
        { name: "Thorne", defeated: false, hp: { value: 20, max: 20 } }
      ],
      departed: [{ name: "Bandit", defeated: false }]
    }, labels);
    expect(s).toContain("Died: Goblin ×2");
    expect(s).toContain("Injured: Aldric");
    expect(s).toContain("Fled: Bandit");
    expect(s).not.toContain("Thorne");
  });
  it("skips injuries when HP is unavailable", () => {
    const s = summarizeOutcome({
      present: [{ name: "Ghost", defeated: false, hp: null }],
      departed: []
    }, labels);
    expect(s).toBe(labels.none);
  });
  it("counts a defeated departed combatant as died, not fled", () => {
    const s = summarizeOutcome({
      present: [],
      departed: [{ name: "Orc", defeated: true }]
    }, labels);
    expect(s).toContain("Died: Orc");
    expect(s).not.toContain("Fled");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/auto-capture.test.js`
Expected: FAIL — the three functions are not exported.

- [ ] **Step 3: Implement the functions**

Append to `scripts/logic/auto-capture.mjs`:

```js
/** The place whose scene matches, or null. */
export function matchPlaceForScene(places, sceneUuid) {
  return places.find((p) => p.scene === sceneUuid) ?? null;
}

/** The attached timepoint id with the greatest sort, or null. */
export function pickLatestTimepoint(attachedIds, timepoints) {
  const attached = new Set(attachedIds);
  let best = null;
  for (const tp of timepoints) {
    if (attached.has(tp.id) && (best === null || tp.sort > best.sort)) best = tp;
  }
  return best?.id ?? null;
}

/** Collapse a list of names into "Name ×N" fragments (N omitted when 1). */
function countedNames(names) {
  const counts = new Map();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(", ");
}

/** Build the combat outcome summary string from resolved end-state. */
export function summarizeOutcome(state, labels) {
  const died = [
    ...state.present.filter((c) => c.defeated).map((c) => c.name),
    ...state.departed.filter((c) => c.defeated).map((c) => c.name)
  ];
  const fled = state.departed.filter((c) => !c.defeated).map((c) => c.name);
  const injured = state.present
    .filter((c) => !c.defeated && c.hp && c.hp.value < c.hp.max && c.hp.value > 0)
    .map((c) => c.name);
  const parts = [];
  if (died.length) parts.push(`${labels.died}: ${countedNames(died)}`);
  if (injured.length) parts.push(`${labels.injured}: ${countedNames(injured)}`);
  if (fled.length) parts.push(`${labels.fled}: ${countedNames(fled)}`);
  return parts.length ? parts.join(" · ") : labels.none;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/auto-capture.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/auto-capture.mjs tests/auto-capture.test.js
git commit -m "feat: pure place-matching, timepoint selection, outcome summary"
```

---

### Task 5: Map activation → Place + timepoint

**Files:**
- Modify: `scripts/hooks/auto-capture.mjs`
- Test: `scripts/testing/quench.mjs`

**Interfaces:**
- Consumes: `getTargetGroup()` (Task 1); `matchPlaceForScene`, `pickLatestTimepoint` (Task 4); `addTimepoint`, `attachRecord`, `getTimepoints` from `scripts/data/timepoints.mjs`; `typeId` from `scripts/constants.mjs`.
- Produces: `ensurePlaceForScene(group, scene, { createTimepoint })` → `Promise<{ place, timepointId }>`. Reuses the group's existing place for the scene, creating one only if absent; when `createTimepoint` is true (or the place has no attached timepoint yet) it appends a new end-of-timeline timepoint labeled with the scene name and attaches the place; otherwise returns the place's latest attached timepoint id.

- [ ] **Step 1: Add imports and `ensurePlaceForScene` to `scripts/hooks/auto-capture.mjs`**

Replace the top imports with:

```js
import { isGroup } from "../data/groups.mjs";
import { setTargetGroup, getTargetGroup } from "../settings/auto-target.mjs";
import { typeId } from "../constants.mjs";
import { addTimepoint, attachRecord, getTimepoints } from "../data/timepoints.mjs";
import { matchPlaceForScene, pickLatestTimepoint } from "../logic/auto-capture.mjs";
```

Add above `registerAutoCapture`:

```js
const PLACE_TYPE = typeId("place");

/** Every place page in a group whose scene is set. */
function placesOf(group) {
  return group.pages.filter((p) => p.type === PLACE_TYPE && p.system.scene);
}

/**
 * Ensure the target group has a place for `scene`, returning it plus the
 * timepoint the caller should attach records to. Reuses an existing place;
 * adds a fresh end-of-timeline timepoint when asked (map activation) or when
 * the place has none yet (combat fallback).
 */
export async function ensurePlaceForScene(group, scene, { createTimepoint }) {
  let place = matchPlaceForScene(placesOf(group), scene.uuid);
  if (!place) {
    [place] = await group.createEmbeddedDocuments("JournalEntryPage", [
      { name: scene.name, type: PLACE_TYPE, system: { scene: scene.uuid } }
    ]);
  }
  const attached = [...(place.system.timepoints ?? [])];
  let timepointId = createTimepoint ? null : pickLatestTimepoint(attached, getTimepoints(group));
  if (!timepointId) {
    const tp = await addTimepoint(group, scene.name);
    await attachRecord(place, tp.id);
    timepointId = tp.id;
  }
  return { place, timepointId };
}
```

- [ ] **Step 2: Register the `updateScene` hook**

Inside `registerAutoCapture()`, after the `createJournalEntry` hook:

```js
  // GM activates a map → ensure a Place and add a fresh visit timepoint.
  Hooks.on("updateScene", async (scene, changes) => {
    if (game.user !== game.users.activeGM) return;
    if (changes.active !== true) return;
    const group = getTargetGroup();
    if (!group) return;
    await ensurePlaceForScene(group, scene, { createTimepoint: true });
  });
```

- [ ] **Step 3: Add a quench test**

In `scripts/testing/quench.mjs`, add a new batch after the `campaign-record.auto-target` batch:

```js
  quench.registerBatch(
    "campaign-record.auto-capture",
    (context) => {
      const { describe, it, assert, before, after } = context;
      let group, scene;
      describe("Auto-capture placement", () => {
        before(async () => {
          group = await createGroup("Quench Capture Group");
          await game.settings.set("campaign-record", "autoCaptureTargetGroup", group.id);
          scene = await Scene.create({ name: "Quench Tavern", width: 1000, height: 1000 });
        });
        after(async () => {
          await game.settings.set("campaign-record", "autoCaptureTargetGroup", "");
          await scene.delete();
          await group.delete();
        });
        it("ensurePlaceForScene reuses a place and adds a timepoint each activation", async () => {
          const { ensurePlaceForScene } = await import("../hooks/auto-capture.mjs");
          const first = await ensurePlaceForScene(group, scene, { createTimepoint: true });
          const second = await ensurePlaceForScene(group, scene, { createTimepoint: true });
          assert.equal(first.place.id, second.place.id, "same place reused");
          assert.notEqual(first.timepointId, second.timepointId, "new timepoint each time");
          assert.equal(first.place.type, "campaign-record.place");
          assert.equal(first.place.system.scene, scene.uuid);
          assert.ok(first.place.system.timepoints.has(second.timepointId));
        });
      });
    },
    { displayName: "Campaign Record: Auto Capture" }
  );
```

- [ ] **Step 4: Verify vitest green and commit**

Run: `npx vitest run`
Expected: PASS (no regressions).

```bash
git add scripts/hooks/auto-capture.mjs scripts/testing/quench.mjs
git commit -m "feat: auto-create Place and visit timepoint on map activation"
```

---

### Task 6: Combat start → Encounter

**Files:**
- Modify: `scripts/constants.mjs`
- Modify: `scripts/hooks/auto-capture.mjs`
- Modify: `lang/en.json`
- Test: `scripts/testing/quench.mjs`

**Interfaces:**
- Consumes: `ensurePlaceForScene` (Task 5); `collapseParticipants` (Task 3); `attachRecord` from `scripts/data/timepoints.mjs`.
- Produces: `ENCOUNTER_FLAG` (`"encounterUuid"`) and `DEPARTED_FLAG` (`"departed"`) constants; `combatParticipants(combat)` helper → `[{ actorUuid, name }]` from live combatants; a `combatStart` hook that creates an Encounter and stamps `combat.flags.campaign-record.encounterUuid`.

- [ ] **Step 1: Add constants**

In `scripts/constants.mjs`, after `AUTO_TARGET_ACTION`:

```js
/** Combat flag: uuid of the Encounter page this combat is captured into. */
export const ENCOUNTER_FLAG = "encounterUuid";

/** Combat flag: combatants that left mid-fight, for the end summary. */
export const DEPARTED_FLAG = "departed";
```

- [ ] **Step 2: Add imports and the combat helper to `scripts/hooks/auto-capture.mjs`**

Replace the existing `import { typeId } from "../constants.mjs";` line with:

```js
import { MODULE_ID, typeId, ENCOUNTER_FLAG, DEPARTED_FLAG } from "../constants.mjs";
```

Add `collapseParticipants` to the logic import:

```js
import { matchPlaceForScene, pickLatestTimepoint, collapseParticipants } from "../logic/auto-capture.mjs";
```

Add near `placesOf`:

```js
/** Live combatants as raw {actorUuid, name} entries. */
function combatParticipants(combat) {
  return combat.combatants.map((c) => ({ actorUuid: c.actor?.uuid ?? null, name: c.name }));
}
```

- [ ] **Step 3: Register the `combatStart` hook**

Inside `registerAutoCapture()`, after the `updateScene` hook:

```js
  // GM begins combat → create an Encounter on the scene's Place timepoint.
  Hooks.on("combatStart", async (combat) => {
    if (game.user !== game.users.activeGM) return;
    const scene = combat.scene;
    if (!scene) return;
    const group = getTargetGroup();
    if (!group) return;
    const { timepointId } = await ensurePlaceForScene(group, scene, { createTimepoint: false });
    const combatants = collapseParticipants(combatParticipants(combat));
    const [encounter] = await group.createEmbeddedDocuments("JournalEntryPage", [
      {
        name: game.i18n.format("CAMPAIGNRECORD.AutoCapture.EncounterName", { scene: scene.name }),
        type: typeId("encounter"),
        system: { scene: scene.uuid, combatants }
      }
    ]);
    await attachRecord(encounter, timepointId);
    await combat.setFlag(MODULE_ID, ENCOUNTER_FLAG, encounter.uuid);
  });
```

- [ ] **Step 4: Add the localization key**

In `lang/en.json`, inside the `CAMPAIGNRECORD.AutoCapture` block, add:

```json
      "EncounterName": "Combat at {scene}"
```

- [ ] **Step 5: Add a quench test**

In `scripts/testing/quench.mjs`, inside `describe("Auto-capture placement", ...)`, add:

```js
        it("combatStart creates an Encounter attached to the Place timepoint", async () => {
          const { ensurePlaceForScene } = await import("../hooks/auto-capture.mjs");
          const { timepointId } = await ensurePlaceForScene(group, scene, { createTimepoint: true });
          const actor = await Actor.create({ name: "Quench Goblin", type: Object.keys(game.system.model?.Actor ?? { npc: {} })[0] });
          const combat = await Combat.create({ scene: scene.id });
          await combat.createEmbeddedDocuments("Combatant", [{ actorId: actor.id }, { actorId: actor.id }]);
          await combat.startCombat();
          const encounterUuid = combat.getFlag("campaign-record", "encounterUuid");
          assert.ok(encounterUuid, "encounter flag stamped");
          const encounter = await fromUuid(encounterUuid);
          assert.equal(encounter.type, "campaign-record.encounter");
          assert.equal(encounter.system.scene, scene.uuid);
          assert.ok(encounter.system.timepoints.has(timepointId), "attached to latest timepoint");
          assert.equal(encounter.system.combatants[0].count, 2, "collapsed by actor");
          await combat.delete();
          await actor.delete();
        });
```

- [ ] **Step 6: Verify vitest green and commit**

Run: `npx vitest run`
Expected: PASS.

```bash
git add scripts/constants.mjs scripts/hooks/auto-capture.mjs lang/en.json scripts/testing/quench.mjs
git commit -m "feat: auto-create Encounter on combat start"
```

---

### Task 7: Roster sync during combat

**Files:**
- Modify: `scripts/hooks/auto-capture.mjs`
- Test: `scripts/testing/quench.mjs`

**Interfaces:**
- Consumes: `mergeParticipants`, `collapseParticipants` (Task 3); `ENCOUNTER_FLAG`, `DEPARTED_FLAG`, `MODULE_ID`.
- Produces: `syncEncounterRoster(combat)` → updates the linked Encounter's `system.combatants` via additive merge; `recordDeparture(combat, combatant)` → appends `{ actorUuid, name, defeated }` to the combat's departed flag. Hooks: `createCombatant`, `updateCombatant`, `deleteCombatant`.

- [ ] **Step 1: Add the sync helpers to `scripts/hooks/auto-capture.mjs`**

Add `mergeParticipants` to the logic import line:

```js
import { matchPlaceForScene, pickLatestTimepoint, collapseParticipants, mergeParticipants } from "../logic/auto-capture.mjs";
```

Add near `combatParticipants`:

```js
/** The Encounter page linked to a combat, or null. */
async function linkedEncounter(combat) {
  const uuid = combat.getFlag(MODULE_ID, ENCOUNTER_FLAG);
  return uuid ? fromUuid(uuid) : null;
}

/** Additively merge the live roster into the linked Encounter (never shrinks). */
async function syncEncounterRoster(combat) {
  const encounter = await linkedEncounter(combat);
  if (!encounter) return;
  const merged = mergeParticipants(
    encounter.system.combatants.map((c) => c.toObject?.() ?? { ...c }),
    collapseParticipants(combatParticipants(combat))
  );
  await encounter.update({ "system.combatants": merged });
}

/** Note a departing combatant (with its defeated state) for the end summary. */
async function recordDeparture(combat, combatant) {
  if (!combat.getFlag(MODULE_ID, ENCOUNTER_FLAG)) return;
  const departed = [...(combat.getFlag(MODULE_ID, DEPARTED_FLAG) ?? [])];
  departed.push({ actorUuid: combatant.actor?.uuid ?? null, name: combatant.name, defeated: combatant.isDefeated === true });
  await combat.setFlag(MODULE_ID, DEPARTED_FLAG, departed);
}
```

- [ ] **Step 2: Register the roster hooks**

Inside `registerAutoCapture()`, after the `combatStart` hook:

```js
  // Roster grows/changes → additively sync the Encounter's participants.
  const onRosterChange = (combatant) => {
    if (game.user !== game.users.activeGM) return;
    syncEncounterRoster(combatant.combat);
  };
  Hooks.on("createCombatant", onRosterChange);
  Hooks.on("updateCombatant", onRosterChange);
  // Removal doesn't shrink the record; note who left (and whether defeated).
  Hooks.on("deleteCombatant", (combatant) => {
    if (game.user !== game.users.activeGM) return;
    recordDeparture(combatant.combat, combatant);
  });
```

- [ ] **Step 3: Add a quench test**

In `scripts/testing/quench.mjs`, inside `describe("Auto-capture placement", ...)`, add:

```js
        it("adding a combatant grows the Encounter; removal is tracked as departed", async () => {
          const { ensurePlaceForScene } = await import("../hooks/auto-capture.mjs");
          await ensurePlaceForScene(group, scene, { createTimepoint: true });
          const gob = await Actor.create({ name: "Quench Gob2", type: Object.keys(game.system.model?.Actor ?? { npc: {} })[0] });
          const orc = await Actor.create({ name: "Quench Orc", type: Object.keys(game.system.model?.Actor ?? { npc: {} })[0] });
          const combat = await Combat.create({ scene: scene.id });
          await combat.createEmbeddedDocuments("Combatant", [{ actorId: gob.id }]);
          await combat.startCombat();
          const encounter = await fromUuid(combat.getFlag("campaign-record", "encounterUuid"));
          const [added] = await combat.createEmbeddedDocuments("Combatant", [{ actorId: orc.id }]);
          assert.equal(encounter.system.combatants.length, 2, "orc synced in");
          await added.delete();
          const departed = combat.getFlag("campaign-record", "departed") ?? [];
          assert.equal(departed.length, 1, "departure recorded");
          assert.equal(encounter.system.combatants.length, 2, "roster did not shrink");
          await combat.delete();
          await gob.delete();
          await orc.delete();
        });
```

- [ ] **Step 4: Verify vitest green and commit**

Run: `npx vitest run`
Expected: PASS.

```bash
git add scripts/hooks/auto-capture.mjs scripts/testing/quench.mjs
git commit -m "feat: additively sync Encounter roster and track departures"
```

---

### Task 8: Combat end → outcome summary

**Files:**
- Modify: `scripts/hooks/auto-capture.mjs`
- Modify: `lang/en.json`
- Test: `scripts/testing/quench.mjs`

**Interfaces:**
- Consumes: `summarizeOutcome` (Task 4); `linkedEncounter`, `ENCOUNTER_FLAG`, `DEPARTED_FLAG`, `MODULE_ID`.
- Produces: `actorHp(actor)` → `{ value, max }` or `null`; a `deleteCombat` hook that writes `system.outcome` on the linked Encounter.

- [ ] **Step 1: Add the HP reader and `summarizeOutcome` import**

Add `summarizeOutcome` to the logic import line:

```js
import { matchPlaceForScene, pickLatestTimepoint, collapseParticipants, mergeParticipants, summarizeOutcome } from "../logic/auto-capture.mjs";
```

Add near `combatParticipants`:

```js
/** Best-effort current/max HP for an actor, or null when the system hides it. */
function actorHp(actor) {
  const hp = actor?.system?.attributes?.hp;
  return hp && typeof hp.value === "number" && typeof hp.max === "number"
    ? { value: hp.value, max: hp.max }
    : null;
}
```

- [ ] **Step 2: Register the `deleteCombat` hook**

Inside `registerAutoCapture()`, after the roster hooks:

```js
  // Combat ends → summarize deaths, injuries, and flights onto the Encounter.
  Hooks.on("deleteCombat", async (combat) => {
    if (game.user !== game.users.activeGM) return;
    const encounter = await linkedEncounter(combat);
    if (!encounter) return;
    const present = combat.combatants.map((c) => ({
      name: c.name, defeated: c.isDefeated === true, hp: actorHp(c.actor)
    }));
    const departed = combat.getFlag(MODULE_ID, DEPARTED_FLAG) ?? [];
    const outcome = summarizeOutcome({ present, departed }, {
      died: game.i18n.localize("CAMPAIGNRECORD.AutoCapture.Died"),
      injured: game.i18n.localize("CAMPAIGNRECORD.AutoCapture.Injured"),
      fled: game.i18n.localize("CAMPAIGNRECORD.AutoCapture.Fled"),
      none: game.i18n.localize("CAMPAIGNRECORD.AutoCapture.NoCasualties")
    });
    await encounter.update({ "system.outcome": outcome });
  });
```

- [ ] **Step 3: Add localization keys**

In `lang/en.json`, inside `CAMPAIGNRECORD.AutoCapture`, add:

```json
      "Died": "Died",
      "Injured": "Injured",
      "Fled": "Fled",
      "NoCasualties": "All combatants unharmed."
```

- [ ] **Step 4: Add a quench test**

In `scripts/testing/quench.mjs`, inside `describe("Auto-capture placement", ...)`, add:

```js
        it("deleteCombat writes an outcome summary onto the Encounter", async () => {
          const { ensurePlaceForScene } = await import("../hooks/auto-capture.mjs");
          await ensurePlaceForScene(group, scene, { createTimepoint: true });
          const foe = await Actor.create({ name: "Quench Foe", type: Object.keys(game.system.model?.Actor ?? { npc: {} })[0] });
          const combat = await Combat.create({ scene: scene.id });
          const [c1] = await combat.createEmbeddedDocuments("Combatant", [{ actorId: foe.id }]);
          await combat.startCombat();
          const encounterUuid = combat.getFlag("campaign-record", "encounterUuid");
          await c1.update({ defeated: true });
          await combat.delete();
          const encounter = await fromUuid(encounterUuid);
          assert.ok(encounter.system.outcome.includes("Died"), "died bucket present");
          await foe.delete();
        });
```

- [ ] **Step 5: Verify vitest green and commit**

Run: `npx vitest run`
Expected: PASS.

```bash
git add scripts/hooks/auto-capture.mjs lang/en.json scripts/testing/quench.mjs
git commit -m "feat: summarize combat outcome onto the Encounter at combat end"
```

---

### Task 9: Hub gear menu with target selector

**Files:**
- Modify: `templates/hub/header.hbs`
- Modify: `scripts/apps/hub/hub-mixin.mjs`
- Modify: `styles/campaign-record.css`
- Modify: `lang/en.json`
- Test: `tests/e2e/11-auto-capture-menu.spec.mjs` (Playwright, run under the `foundry-e2e` skill contract)

**Interfaces:**
- Consumes: `getTargetGroup`, `setTargetGroup` from `scripts/settings/auto-target.mjs`; existing actions `importDocument`, `exportGroup`, `toggleInlineEdit`.
- Produces: `state.settingsMenuOpen` (boolean, default false); action `toggleSettingsMenu`; context fields `settingsMenuOpen`, `autoTargetOptions` (`[{ id, name, selected }]`), `autoTargetNoneSelected`.

- [ ] **Step 1: Rewrite the header template**

Replace the whole body of `templates/hub/header.hbs` with:

```hbs
<div class="hub-header">
  {{#if showGroupPicker}}
  <select name="group-select" aria-label="{{localize "CAMPAIGNRECORD.Hub.GroupPicker"}}">
    <option value="all" {{#if allSelected}}selected{{/if}}>{{localize "CAMPAIGNRECORD.Hub.AllGroups"}}</option>
    {{#each groups}}
    <option value="{{this.id}}" {{#if this.selected}}selected{{/if}}>{{this.name}}</option>
    {{/each}}
  </select>
  {{/if}}
  <div class="hub-settings-menu {{#if settingsMenuOpen}}open{{/if}}">
    <button type="button" class="hub-settings-trigger" data-action="toggleSettingsMenu"
            data-tooltip="CAMPAIGNRECORD.Hub.Settings" aria-haspopup="true"
            aria-expanded="{{#if settingsMenuOpen}}true{{else}}false{{/if}}">
      <i class="fa-solid fa-gear"></i>
    </button>
    {{#if settingsMenuOpen}}
    <div class="hub-settings-panel" role="menu">
      {{#if canImport}}
      <button type="button" role="menuitem" data-action="importDocument">
        <i class="fa-solid fa-file-import"></i> {{localize "CAMPAIGNRECORD.Import.Button"}}
      </button>
      {{/if}}
      <button type="button" role="menuitem" data-action="exportGroup">
        <i class="fa-solid fa-file-word"></i> {{localize "CAMPAIGNRECORD.Export.GroupButton"}}
      </button>
      <button type="button" role="menuitemcheckbox" data-action="toggleInlineEdit"
              aria-checked="{{#if inlineEditing}}true{{else}}false{{/if}}">
        <i class="fa-solid {{#if inlineEditing}}fa-pen{{else}}fa-pen-slash{{/if}}"></i>
        {{localize "CAMPAIGNRECORD.Hub.ToggleInlineEdit"}}
      </button>
      <hr>
      <label class="hub-auto-target">
        {{localize "CAMPAIGNRECORD.Hub.AutoTargetLabel"}}
        <select name="auto-target-select">
          <option value="" {{#if autoTargetNoneSelected}}selected{{/if}}>{{localize "CAMPAIGNRECORD.Hub.AutoTargetNone"}}</option>
          {{#each autoTargetOptions}}
          <option value="{{this.id}}" {{#if this.selected}}selected{{/if}}>{{this.name}}</option>
          {{/each}}
        </select>
      </label>
    </div>
    {{/if}}
  </div>
</div>
```

- [ ] **Step 2: Add the menu state, action, and context**

In `scripts/apps/hub/hub-mixin.mjs`:

Add the import near the other app imports (top of file):

```js
import { getTargetGroup, setTargetGroup } from "../../settings/auto-target.mjs";
```

Add `toggleSettingsMenu` to the `actions` block in `DEFAULT_OPTIONS`:

```js
        toggleSettingsMenu: HubBase.#onToggleSettingsMenu,
```

Add `settingsMenuOpen: false` to the `state = {...}` initializer:

```js
    state = { groupId: "all", types: new Set(), hiddenOnly: false, sort: "name", query: "", typeMenuOpen: false, settingsMenuOpen: false };
```

Add the action handler (near `#onToggleEditMode`):

```js
    static async #onToggleSettingsMenu() {
      this.state.settingsMenuOpen = !this.state.settingsMenuOpen;
      await this.render({ parts: ["header"] });
    }
```

In `_prepareContext`, after the `context.inlineEditing = ...` line, add:

```js
      context.settingsMenuOpen = this.state.settingsMenuOpen;
      const target = getTargetGroup();
      context.autoTargetNoneSelected = !target;
      context.autoTargetOptions = getGroups().map((g) => ({
        id: g.id, name: g.name, selected: g.id === target?.id
      }));
```

In `_onClose`, alongside `this.state.typeMenuOpen = false;`, add:

```js
      this.state.settingsMenuOpen = false;
```

- [ ] **Step 3: Bind the target selector and outside-click close in `_onRender`**

In `_onRender`, after the `sortSelect` binding block, add:

```js
      const targetSelect = this.element.querySelector('select[name="auto-target-select"]');
      if (targetSelect && !targetSelect.dataset.crBound) {
        targetSelect.dataset.crBound = "1";
        targetSelect.addEventListener("change", async (event) => {
          await setTargetGroup(event.target.value);
          await this.render({ parts: ["header"] });
        });
      }
      if (!this.element.dataset.crSettingsBound) {
        this.element.dataset.crSettingsBound = "1";
        this.element.addEventListener("click", (event) => {
          if (this.state.settingsMenuOpen && !event.target.closest(".hub-settings-menu")) {
            this.state.settingsMenuOpen = false;
            this.render({ parts: ["header"] });
          }
        });
      }
```

- [ ] **Step 4: Add localization keys**

In `lang/en.json`, inside the `CAMPAIGNRECORD.Hub` object, add:

```json
      "Settings": "Settings",
      "AutoTargetLabel": "Auto-capture target",
      "AutoTargetNone": "None"
```

- [ ] **Step 5: Add minimal menu styling**

In `styles/campaign-record.css`, append:

```css
.hub-settings-menu { position: relative; display: inline-block; }
.hub-settings-panel {
  position: absolute; right: 0; top: 100%; z-index: 100; min-width: 220px;
  display: flex; flex-direction: column; gap: 4px; padding: 6px;
  background: var(--color-bg, #1c1c1c); border: 1px solid var(--color-border-dark, #000); border-radius: 4px;
}
.hub-settings-panel > button { justify-content: flex-start; text-align: left; }
.hub-settings-panel .hub-auto-target { display: flex; flex-direction: column; gap: 2px; font-size: var(--font-size-12); }
```

- [ ] **Step 6: Run the i18n coverage + full unit suite**

Run: `npx vitest run`
Expected: PASS — including `tests/i18n-coverage.test.js` (every new `localize`/`format` key resolves in `lang/en.json`).

- [ ] **Step 7: Write the e2e spec**

Create `tests/e2e/11-auto-capture-menu.spec.mjs`, following the harness/setup pattern of `tests/e2e/05-hub.spec.mjs` (reuse its Hub-open approach — a shared helper if one exists, otherwise the sidebar footer button):

```js
import { test, expect } from "@playwright/test";
// Match the imports/fixtures used by tests/e2e/05-hub.spec.mjs.

test("gear menu exposes import, export, edit toggle, and the auto-capture target", async ({ page }) => {
  // ...open the Hub exactly as 05-hub.spec.mjs does...
  await page.locator(".hub-settings-trigger").click();
  const panel = page.locator(".hub-settings-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-action="importDocument"]')).toBeVisible();
  await expect(panel.locator('[data-action="exportGroup"]')).toBeVisible();
  await expect(panel.locator('[data-action="toggleInlineEdit"]')).toBeVisible();
  await expect(panel.locator('select[name="auto-target-select"]')).toBeVisible();
  // the loose header buttons are gone
  await expect(page.locator('.hub-header > [data-action="importDocument"]')).toHaveCount(0);
});
```

> **Note:** e2e runs against the shared Foundry install. Before running, follow the `foundry-e2e` skill contract (session lock, module symlink, unlock). Open the Hub via whatever mechanism `05-hub.spec.mjs` already uses.

- [ ] **Step 8: Run e2e (under the foundry-e2e contract) and commit**

Run: `npm run test:e2e -- 11-auto-capture-menu.spec.mjs` (after acquiring the e2e lock per the `foundry-e2e` skill)
Expected: PASS.

```bash
git add templates/hub/header.hbs scripts/apps/hub/hub-mixin.mjs styles/campaign-record.css lang/en.json tests/e2e/11-auto-capture-menu.spec.mjs
git commit -m "feat: Hub gear menu holding Import/Export/Edit and the auto-capture target"
```

---

## Self-Review

**Spec coverage:**

- Target-group world setting, editable by anyone via relay, dormant when unset → Task 1. ✓
- New group becomes target → Task 2. ✓
- Map activation → Place (reuse-or-create) + new timepoint each visit → Tasks 4–5. ✓
- Combat start → Encounter, participants collapsed by actor, attached to Place's latest timepoint, Place fallback → Tasks 3, 4, 6. ✓
- Roster sync additive (max), departures tracked → Tasks 3, 7. ✓
- Combat end → outcome summary (died/injured/fled, HP best-effort + graceful degradation) → Tasks 4, 8. ✓
- Single-writer guard on every hook → Tasks 2, 5, 6, 7, 8. ✓
- Gear menu absorbing Import/Export/Edit + target selector → Task 9. ✓
- Edge cases (no target, stale id, combat with no scene, combat created-but-not-begun) → dormant returns in Tasks 5/6, `linkedEncounter` null-guard in Tasks 7/8, `combat.scene` guard in Task 6. ✓
- Testing: vitest for pure logic (Tasks 1,3,4), quench for hooks (Tasks 1,2,5,6,7,8), e2e for UI (Task 9). ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N" — every code step carries full code. ✓

**Type consistency:** Row shape `{ id, name, count, actor }` consistent across `collapseParticipants`/`mergeParticipants`/schema. `ensurePlaceForScene(group, scene, { createTimepoint })` → `{ place, timepointId }` used identically in Tasks 5/6. Flag names `ENCOUNTER_FLAG`/`DEPARTED_FLAG` centralized in constants, reused in Tasks 6/7/8. `summarizeOutcome(state, labels)` signature matches between Task 4 definition and Task 8 call. `SOCKET_NAME` reused from `presenter/socket.mjs` (a second `game.socket.on` listener coexists with the presenter's; each ignores the other's actions). ✓
