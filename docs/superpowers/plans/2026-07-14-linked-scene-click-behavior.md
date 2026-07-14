# Linked-scene Click Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make clicking a scene content link on a Campaign Record sheet load the scene for users who can view it, and otherwise pop up the scene's image locally without filing it into a media entry.

**Architecture:** Put every testable decision in a pure `scripts/logic/scene-link.mjs` module (a DOM extractor + a branch resolver, both Foundry-free). Wire a single capture-phase click listener into `BaseRecordSheet._onRender` that calls those helpers and performs the Foundry action. The listener is bound only to Campaign Record sheet elements, so standard journals keep Foundry's defaults.

**Tech Stack:** Foundry VTT v13 module (ES modules, `.mjs`), vitest + jsdom for unit tests, Handlebars templates (unchanged here).

## Global Constraints

- Foundry compatibility: minimum and verified **v13** (`module.json`).
- The image popout MUST be rendered locally with `.render(true)` and MUST NOT call `ImagePopout.prototype.shareImage` — auto-capture (`scripts/hooks/auto-capture.mjs`) only files media on `shareImage`, so a local render never creates a media entry.
- Pure logic lives in `scripts/logic/*.mjs` and stays Foundry-free (importable in vitest without globals), mirroring `record-links.mjs` / `visibility.mjs`.
- All user-facing strings go through `game.i18n` with a key defined in `lang/en.json` (the `i18n-coverage` test enforces key/usage parity).
- New scene UUIDs referenced by content links: world scenes are `Scene.<id>`; compendium scenes end in `.Scene.<id>`. Both must be treated as scenes.

---

### Task 1: Pure scene-link logic module

**Files:**
- Create: `scripts/logic/scene-link.mjs`
- Test: `tests/scene-link.test.js`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces (relied on by Task 2):
  - `sceneUuidFromContentLink(target) -> string | null` — given a click-event target (a DOM node), returns the Scene UUID of the nearest enclosing `a.content-link[data-uuid]` when that link points at a Scene (world `Scene.<id>` or compendium `…​.Scene.<id>`); otherwise `null`.
  - `resolveSceneClickAction({ canView, backgroundSrc, thumb, name }) -> { kind: "view" } | { kind: "image", src, title } | { kind: "notify" }` — pure branch decision. `canView` is a boolean; `backgroundSrc`/`thumb` may be empty strings or undefined; `name` is the scene name used as the popout title.

- [ ] **Step 1: Write the failing tests**

Create `tests/scene-link.test.js`:

```js
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { sceneUuidFromContentLink, resolveSceneClickAction } from "../scripts/logic/scene-link.mjs";

const bodyFrom = (html) => new JSDOM(`<body>${html}</body>`).window.document.body;

describe("sceneUuidFromContentLink", () => {
  it("returns the uuid for a world scene content link", () => {
    const body = bodyFrom(`<a class="content-link" data-uuid="Scene.abc"><i></i>Keep</a>`);
    const inner = body.querySelector("i"); // click often lands on the icon
    expect(sceneUuidFromContentLink(inner)).toBe("Scene.abc");
  });

  it("returns the uuid for a compendium scene content link", () => {
    const body = bodyFrom(`<a class="content-link" data-uuid="Compendium.world.maps.Scene.xyz">Map</a>`);
    expect(sceneUuidFromContentLink(body.querySelector("a"))).toBe("Compendium.world.maps.Scene.xyz");
  });

  it("returns null for a non-scene content link", () => {
    const body = bodyFrom(`<a class="content-link" data-uuid="JournalEntry.j1.JournalEntryPage.p1">Page</a>`);
    expect(sceneUuidFromContentLink(body.querySelector("a"))).toBeNull();
  });

  it("returns null when there is no content link ancestor", () => {
    const body = bodyFrom(`<span>plain text</span>`);
    expect(sceneUuidFromContentLink(body.querySelector("span"))).toBeNull();
  });

  it("returns null for a null target", () => {
    expect(sceneUuidFromContentLink(null)).toBeNull();
  });
});

describe("resolveSceneClickAction", () => {
  it("views the scene when the user can view it", () => {
    expect(resolveSceneClickAction({ canView: true, backgroundSrc: "bg.webp", thumb: "t.webp", name: "Keep" }))
      .toEqual({ kind: "view" });
  });

  it("shows the background image when the user cannot view it", () => {
    expect(resolveSceneClickAction({ canView: false, backgroundSrc: "bg.webp", thumb: "t.webp", name: "Keep" }))
      .toEqual({ kind: "image", src: "bg.webp", title: "Keep" });
  });

  it("falls back to the thumbnail when there is no background", () => {
    expect(resolveSceneClickAction({ canView: false, backgroundSrc: "", thumb: "t.webp", name: "Keep" }))
      .toEqual({ kind: "image", src: "t.webp", title: "Keep" });
  });

  it("notifies when the user cannot view it and there is no image at all", () => {
    expect(resolveSceneClickAction({ canView: false, backgroundSrc: "", thumb: "", name: "Keep" }))
      .toEqual({ kind: "notify" });
  });

  it("treats undefined image fields as absent", () => {
    expect(resolveSceneClickAction({ canView: false, name: "Keep" })).toEqual({ kind: "notify" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/scene-link.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/scene-link.mjs` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `scripts/logic/scene-link.mjs`:

```js
/**
 * Scene-link click logic for Campaign Record sheets. Pure and Foundry-free so
 * it can be unit-tested without a running game; the sheet supplies DOM nodes
 * and scene primitives and performs the resulting Foundry action.
 */

// A content-link UUID points at a Scene when its final "<Type>.<id>" segment
// is a Scene — matches world ("Scene.abc") and compendium
// ("Compendium.pack.Scene.abc") references alike.
const SCENE_UUID = /(?:^|\.)Scene\.[^.]+$/;

/**
 * The Scene UUID of the content link enclosing `target`, or null when the
 * click was not on a scene content link (so it falls through to Foundry).
 */
export function sceneUuidFromContentLink(target) {
  const uuid = target?.closest?.("a.content-link[data-uuid]")?.dataset?.uuid ?? null;
  return uuid && SCENE_UUID.test(uuid) ? uuid : null;
}

/**
 * Decide what a scene-link click should do:
 * - { kind: "view" }                    when the user can view the scene
 * - { kind: "image", src, title }       otherwise, if the scene has an image
 *                                        (background preferred, thumbnail fallback)
 * - { kind: "notify" }                  otherwise (no image to show)
 */
export function resolveSceneClickAction({ canView, backgroundSrc, thumb, name }) {
  if (canView) return { kind: "view" };
  const src = backgroundSrc || thumb;
  if (src) return { kind: "image", src, title: name };
  return { kind: "notify" };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/scene-link.test.js`
Expected: PASS (11 assertions across the two describe blocks).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/scene-link.mjs tests/scene-link.test.js
git commit -m "feat: scene-link click decision logic"
```

---

### Task 2: Wire the interceptor into BaseRecordSheet

**Files:**
- Modify: `scripts/sheets/base-record-sheet.mjs` (imports at top; `_onRender` around lines 84-98; add one private method)
- Modify: `lang/en.json` (add `CAMPAIGNRECORD.Warning.SceneNoImage`)

**Interfaces:**
- Consumes (from Task 1): `sceneUuidFromContentLink`, `resolveSceneClickAction` from `../logic/scene-link.mjs`.
- Produces: no exports; adds runtime click behavior to every Campaign Record page sheet.

This task's deliverable is Foundry glue verified at runtime (the branch logic is already unit-tested in Task 1). There is no vitest step; verification is manual/e2e in the running game.

- [ ] **Step 1: Add the i18n string**

In `lang/en.json`, inside the `CAMPAIGNRECORD.Warning` block (after `"InlineSaveFailed"`), add:

```json
      "InlineSaveFailed": "Saving your change failed — see the console for details.",
      "SceneNoImage": "This scene has no image to show."
```

(Add a comma after the `InlineSaveFailed` line; `SceneNoImage` is the new last entry in the object.)

- [ ] **Step 2: Import the logic helpers**

In `scripts/sheets/base-record-sheet.mjs`, add to the import block at the top (alongside the existing `../logic/inline-edit.mjs` import):

```js
import { sceneUuidFromContentLink, resolveSceneClickAction } from "../logic/scene-link.mjs";
```

- [ ] **Step 3: Bind the capture-phase listener in `_onRender`**

In `_onRender` (currently lines 84-98), inside the existing `if (this.isView && !this.element.dataset.crFlushBound)` block is NOT the right place (that flag also gates the change/focusout handlers). Add a separate guarded binding at the end of `_onRender`, after the existing block:

```js
  _onRender(context, options) {
    super._onRender(context, options);
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".campaign-record-drop",
      callbacks: { drop: this.#onDrop.bind(this) }
    }).bind(this.element);
    this.#bindInlineProse(context);
    if (this.isView && !this.element.dataset.crFlushBound) {
      this.element.dataset.crFlushBound = "1";
      this.element.addEventListener("focusout", () => {
        setTimeout(() => this.#flushDeferredRender(), 0);
      });
      this.element.addEventListener("change", (event) => this.#onInlineChange(event));
    }
    if (!this.element.dataset.crSceneLinkBound) {
      this.element.dataset.crSceneLinkBound = "1";
      // Capture phase so stopImmediatePropagation pre-empts Foundry's
      // body-delegated (bubble-phase) content-link handler. Delegated on the
      // persistent root, so it survives inner re-renders. Bound only to
      // Campaign Record sheets — ordinary journals keep Foundry's default.
      this.element.addEventListener("click", (event) => {
        const uuid = sceneUuidFromContentLink(event.target);
        if (!uuid) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.#onSceneLinkClick(uuid);
      }, { capture: true });
    }
  }
```

- [ ] **Step 4: Add the `#onSceneLinkClick` handler**

Add this private method to `BaseRecordSheet` (place it near the other private handlers, e.g. after `#onInlineChange`):

```js
  /**
   * Custom activation for scene content links on Campaign Record sheets:
   * load the scene for users who can view it; otherwise pop up its image
   * locally (never shared, so auto-capture never files it as media).
   */
  async #onSceneLinkClick(uuid) {
    const scene = await fromUuid(uuid);
    if (!scene) return; // broken link — nothing to do
    // Prefer Foundry's own viewability getter when the running build exposes
    // it; fall back to an explicit permission check. VERIFY against the live
    // v13 build (see Step 6) — do not assume `canView` exists.
    const canView = game.user.isGM
      || scene.canView === true
      || scene.testUserPermission?.(game.user, "LIMITED") === true;
    const action = resolveSceneClickAction({
      canView,
      backgroundSrc: scene.background?.src,
      thumb: scene.thumb,
      name: scene.name
    });
    if (action.kind === "view") return scene.view();
    if (action.kind === "image") {
      return new foundry.applications.apps.ImagePopout({
        src: action.src,
        window: { title: action.title }
      }).render(true);
    }
    ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Warning.SceneNoImage"));
  }
```

- [ ] **Step 5: Run the full unit suite (nothing should regress)**

Run: `npx vitest run`
Expected: PASS, including `tests/scene-link.test.js` and `tests/i18n-coverage.test.js` (the new key is defined and used).

- [ ] **Step 6: Runtime verification in Foundry (per `foundry-e2e` skill)**

Read the `foundry-e2e` skill first (session locking / symlink ownership). Then, in a running v13 world with the module active, on a Place or Encounter record that links a scene:

1. **As GM:** click the linked-scene content link → the scene loads on your canvas (`scene.view()`), and Foundry's default (opening the scene config sheet) does NOT also fire.
2. **As a player who lacks view permission:** click it → an image popout opens showing the scene background; confirm the scene did NOT load and that **no media entry / gallery page was created** on the timeline (the auto-capture constraint).
3. **As that player, on a scene with no background/thumb:** click it → a "This scene has no image to show." warning appears, nothing else.
4. Confirm scene links typed into a record's description behave the same, and that scene links in an ordinary (non-Campaign-Record) journal are unaffected.

If step 1 shows Foundry's default also firing, the capture-phase stop is not pre-empting core's handler — adjust (e.g. confirm core binds on `document`/`body` in bubble phase) before proceeding. If `scene.canView` is undefined in the build, the fallback permission check already covers it; note the finding.

- [ ] **Step 7: Commit**

```bash
git add scripts/sheets/base-record-sheet.mjs lang/en.json
git commit -m "feat: role-aware click behavior for linked-scene content links"
```

---

## Self-Review

**Spec coverage:**
- "All scene links on Campaign Record sheets; standard journals untouched" → Task 2 Step 3 (delegated listener bound only to `this.element` of record sheets) + Step 6.4 verification.
- "Can view → `scene.view()`" → Task 1 `resolveSceneClickAction` (`view` branch) + Task 2 `#onSceneLinkClick`.
- "Cannot view → local image popout, background→thumb, else notify" → Task 1 (`image`/`notify` branches) + Task 2 (`ImagePopout.render(true)` / `ui.notifications.warn`).
- "No media-entry capture" → Global Constraint + `render(true)` (no `shareImage`) + Step 6.2 verification.
- "Capture-phase interception; no template changes" → Task 2 Step 3.
- "Pure helper in `scripts/logic/` with full vitest branch coverage" → Task 1.
- "Verify `Scene#canView` against the live build" → Task 2 Step 4 comment + Step 6.
- Compendium + world scene UUIDs → Task 1 `SCENE_UUID` regex + tests.

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code; the one non-code task (Step 6) is concrete runtime checks, not a placeholder.

**Type consistency:** `sceneUuidFromContentLink` and `resolveSceneClickAction` names, params (`{ canView, backgroundSrc, thumb, name }`), and return shapes (`{kind:"view"|"image"|"notify", src?, title?}`) are identical between Task 1's definition/tests and Task 2's usage. i18n key `CAMPAIGNRECORD.Warning.SceneNoImage` matches between `lang/en.json` and `#onSceneLinkClick`.
