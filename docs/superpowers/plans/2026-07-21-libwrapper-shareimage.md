# libWrapper-Aware shareImage Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Silence the libWrapper conflict warning by registering Campaign Record's `ImagePopout.prototype.shareImage` wrap through libWrapper when the `lib-wrapper` module is active, keeping the existing manual prototype patch as the fallback.

**Architecture:** The branch selection and share-payload resolution become pure, dependency-injected functions in `scripts/logic/auto-capture.mjs` (the codebase's pure-logic layer, fully unit-testable with no Foundry globals). `scripts/hooks/auto-capture.mjs` becomes thin glue: it builds the wrapper/manual-patch closures and hands them to the pure installer. `module.json` gains a `relationships.recommends` entry for `lib-wrapper`.

**Tech Stack:** Foundry VTT v13 module (ES modules), vitest for unit tests, Playwright for e2e.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-libwrapper-shareimage-design.md` (approved 2026-07-21).
- libWrapper registration type must be `"WRAPPER"` (we always call through, never alter behavior).
- No hard dependency on lib-wrapper — `relationships.recommends` only, never `requires`.
- If `libWrapper.register` throws, fall back to the manual patch (capture must never silently disappear).
- Behavior of the manual-patch fallback must be byte-for-byte today's behavior (same src/caption resolution, same GM gating).
- Test tier policy (2026-07-18): during development run unit tests + affected e2e specs + `npm run e2e:smoke` only; the full e2e suite runs at the publish gate.
- Before any e2e run or Foundry server interaction, read and follow the project skill `.claude/skills/foundry-e2e/SKILL.md` (session locking, symlink ownership, unlock rules).
- Console warnings use the existing prefix style: `console.warn("campaign-record | ...", error)`.

---

### Task 1: Pure logic — share resolution and wrap installer

**Files:**
- Modify: `scripts/logic/auto-capture.mjs` (append two exported functions at end of file)
- Test: `tests/auto-capture.test.js` (append two `describe` blocks at end of file)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (Task 2 imports both from `../logic/auto-capture.mjs`):
  - `resolveSharedMediaShare({ isGM, options, appOptions })` → `{src: string|undefined, caption: string} | null` (null when not GM)
  - `installShareImageWrap({ libWrapperModule, libWrapper, moduleId, target, wrapper, registerManual, warn })` → `"libwrapper" | "manual"`

- [ ] **Step 1: Write the failing tests**

Append to `tests/auto-capture.test.js` (the file's existing top import already imports from `../scripts/logic/auto-capture.mjs`; extend that import list with `resolveSharedMediaShare, installShareImageWrap`):

```js
describe("resolveSharedMediaShare", () => {
  it("returns null for non-GM users", () => {
    expect(resolveSharedMediaShare({ isGM: false, options: { image: "a.png" }, appOptions: {} })).toBe(null);
  });
  it("prefers options.image over appOptions.src", () => {
    const r = resolveSharedMediaShare({ isGM: true, options: { image: "a.png" }, appOptions: { src: "b.png" } });
    expect(r.src).toBe("a.png");
  });
  it("falls back to appOptions.src when options.image is absent", () => {
    const r = resolveSharedMediaShare({ isGM: true, options: {}, appOptions: { src: "b.png" } });
    expect(r.src).toBe("b.png");
  });
  it("resolves caption through the fallback chain", () => {
    expect(resolveSharedMediaShare({ isGM: true, options: { caption: "c1" }, appOptions: { caption: "c2" } }).caption).toBe("c1");
    expect(resolveSharedMediaShare({ isGM: true, options: {}, appOptions: { caption: "c2" } }).caption).toBe("c2");
    expect(resolveSharedMediaShare({ isGM: true, options: { title: "t1" }, appOptions: {} }).caption).toBe("t1");
    expect(resolveSharedMediaShare({ isGM: true, options: {}, appOptions: { window: { title: "wt" } } }).caption).toBe("wt");
    expect(resolveSharedMediaShare({ isGM: true, options: {}, appOptions: {} }).caption).toBe("");
  });
  it("tolerates missing options and appOptions", () => {
    const r = resolveSharedMediaShare({ isGM: true });
    expect(r).toEqual({ src: undefined, caption: "" });
  });
});

describe("installShareImageWrap", () => {
  const base = () => ({
    moduleId: "campaign-record",
    target: "foundry.applications.apps.ImagePopout.prototype.shareImage",
    wrapper: () => {},
    registerManual: vi.fn(),
    warn: vi.fn()
  });

  it("registers through libWrapper when the module is active", () => {
    const deps = base();
    const register = vi.fn();
    const mode = installShareImageWrap({
      ...deps,
      libWrapperModule: { active: true },
      libWrapper: { register }
    });
    expect(mode).toBe("libwrapper");
    expect(register).toHaveBeenCalledWith(deps.moduleId, deps.target, deps.wrapper, "WRAPPER");
    expect(deps.registerManual).not.toHaveBeenCalled();
  });

  it("uses the manual patch when the module is inactive", () => {
    const deps = base();
    const mode = installShareImageWrap({
      ...deps,
      libWrapperModule: { active: false },
      libWrapper: { register: vi.fn() }
    });
    expect(mode).toBe("manual");
    expect(deps.registerManual).toHaveBeenCalledOnce();
  });

  it("uses the manual patch when the module is missing", () => {
    const deps = base();
    const mode = installShareImageWrap({ ...deps, libWrapperModule: undefined, libWrapper: undefined });
    expect(mode).toBe("manual");
    expect(deps.registerManual).toHaveBeenCalledOnce();
  });

  it("falls back to the manual patch and warns when libWrapper.register throws", () => {
    const deps = base();
    const boom = new Error("boom");
    const mode = installShareImageWrap({
      ...deps,
      libWrapperModule: { active: true },
      libWrapper: { register: vi.fn(() => { throw boom; }) }
    });
    expect(mode).toBe("manual");
    expect(deps.warn).toHaveBeenCalledWith(boom);
    expect(deps.registerManual).toHaveBeenCalledOnce();
  });
});
```

Also extend the vitest import at the top of the file: `import { describe, it, expect, vi } from "vitest";` (currently it imports only `describe, it, expect`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/auto-capture.test.js`
Expected: FAIL — `resolveSharedMediaShare` / `installShareImageWrap` are not exported (SyntaxError on import).

- [ ] **Step 3: Implement the two functions**

Append to `scripts/logic/auto-capture.mjs`:

```js
/**
 * Resolve what a GM's "Show Players" share should file as media, or null when
 * the current user isn't the sharing GM. `options` is the shareImage() call's
 * argument; `appOptions` is the ImagePopout application's options.
 * @returns {{src:string|undefined, caption:string}|null}
 */
export function resolveSharedMediaShare({ isGM, options = {}, appOptions = {} }) {
  if (!isGM) return null;
  return {
    src: options.image ?? appOptions?.src,
    caption: options.caption || appOptions?.caption || options.title || appOptions?.window?.title || ""
  };
}

/**
 * Install the shareImage capture wrap, preferring libWrapper when the
 * lib-wrapper module is active and falling back to `registerManual` (the
 * classic prototype patch) when it's inactive, missing, or registration
 * throws. Returns which path was taken ("libwrapper" | "manual").
 */
export function installShareImageWrap({ libWrapperModule, libWrapper, moduleId, target, wrapper, registerManual, warn }) {
  if (libWrapperModule?.active) {
    try {
      libWrapper.register(moduleId, target, wrapper, "WRAPPER");
      return "libwrapper";
    } catch (error) {
      warn(error);
    }
  }
  registerManual();
  return "manual";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/auto-capture.test.js`
Expected: PASS (all blocks, including the pre-existing ones).

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: PASS — no other suite touches these exports yet.

- [ ] **Step 6: Commit**

```bash
git add scripts/logic/auto-capture.mjs tests/auto-capture.test.js
git commit -m "feat: pure share-resolution and libWrapper-or-manual wrap installer"
```

---

### Task 2: Wire the installer into registerAutoCapture + module.json recommends

**Files:**
- Modify: `scripts/hooks/auto-capture.mjs:5` (extend logic import) and `scripts/hooks/auto-capture.mjs:314-329` (replace manual patch)
- Modify: `module.json` (add `relationships`)
- Modify: `docs/manual-test-checklist.md` (one line under "## Manual (before each release)")
- Test: existing `tests/e2e/26-shared-media-capture.spec.mjs` (no changes — must stay green)

**Interfaces:**
- Consumes from Task 1 (both exported from `scripts/logic/auto-capture.mjs`):
  - `resolveSharedMediaShare({ isGM, options, appOptions })` → `{src, caption} | null`
  - `installShareImageWrap({ libWrapperModule, libWrapper, moduleId, target, wrapper, registerManual, warn })` → `"libwrapper" | "manual"`
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Extend the logic import in the hooks file**

In `scripts/hooks/auto-capture.mjs` line 5, add the two new names to the existing import:

```js
import { matchPlaceForScene, pickLatestTimepoint, pickNewestTimepoint, collapseParticipants, mergeParticipants, summarizeOutcome, appendGalleryImage, mergeGalleryImages, resolveSharedMediaShare, installShareImageWrap } from "../logic/auto-capture.mjs";
```

- [ ] **Step 2: Replace the manual prototype patch**

In `scripts/hooks/auto-capture.mjs`, replace the block at lines 314-329 (from the `// GM shows players an image/video…` comment through the closing `};` of the prototype assignment) with:

```js
  // GM shows players an image/video via Foundry's native "Show Players" →
  // file it onto the newest timepoint. shareImage fires no hook and the
  // socket emit doesn't echo to the sender, so wrap the prototype method
  // (the button calls `this.shareImage()` with no args); the sharing GM
  // captures on their own client (single-writer, no relay). Registered via
  // libWrapper when available so wraps coexist with other modules' (e.g.
  // Monk's Common Display); classic patch otherwise.
  const ImagePopout = foundry.applications.apps.ImagePopout;
  const captureShare = (app, options) => {
    const share = resolveSharedMediaShare({ isGM: game.user.isGM, options, appOptions: app.options });
    if (share) captureSharedMedia(share.src, share.caption);
  };
  installShareImageWrap({
    libWrapperModule: game.modules.get("lib-wrapper"),
    libWrapper: globalThis.libWrapper,
    moduleId: MODULE_ID,
    target: "foundry.applications.apps.ImagePopout.prototype.shareImage",
    wrapper: function (wrapped, options = {}) {
      const result = wrapped(options);
      captureShare(this, options);
      return result;
    },
    registerManual: () => {
      const originalShareImage = ImagePopout.prototype.shareImage;
      ImagePopout.prototype.shareImage = function (options = {}) {
        const result = originalShareImage.call(this, options);
        captureShare(this, options);
        return result;
      };
    },
    warn: (error) => console.warn("campaign-record | libWrapper.register failed; falling back to manual shareImage patch", error)
  });
```

Note: in both the libWrapper wrapper and the manual patch, `this` is the ImagePopout application instance — libWrapper invokes wrappers with the original `this`, matching the classic patch. The capture runs after the original call in both paths, exactly as today.

- [ ] **Step 3: Add the recommends relationship to module.json**

In `module.json`, after the `"socket"` key (order is cosmetic; anywhere top-level works), add:

```json
  "relationships": {
    "recommends": [
      {
        "id": "lib-wrapper",
        "type": "module",
        "reason": "Coordinates Campaign Record's Show-Players media capture wrap with other modules that wrap the same method."
      }
    ]
  },
```

- [ ] **Step 4: Add the manual-checklist line**

In `docs/manual-test-checklist.md`, under the `## Manual (before each release)` section, append:

```markdown
- [ ] In a world with lib-wrapper and Monk's Common Display active, no
      libWrapper conflict warning names campaign-record on world load, and
      "Show Players" still files the image onto the newest timepoint.
```

- [ ] **Step 5: Run the unit suite**

Run: `npm test`
Expected: PASS (deploy/manifest tests must not object to the new `relationships` key; if one asserts on module.json keys, update its expectation in the same commit).

- [ ] **Step 6: Run affected e2e + smoke**

First read `.claude/skills/foundry-e2e/SKILL.md` and follow its session-lock contract, then:

Run: `npx playwright test tests/e2e/26-shared-media-capture.spec.mjs`
Expected: PASS — World B has lib-wrapper enabled, so this exercises the new libWrapper registration path end-to-end.

Run: `npm run e2e:smoke`
Expected: PASS (3 spec files).

- [ ] **Step 7: Commit**

```bash
git add scripts/hooks/auto-capture.mjs module.json docs/manual-test-checklist.md
git commit -m "feat: register shareImage capture via libWrapper when active"
```
