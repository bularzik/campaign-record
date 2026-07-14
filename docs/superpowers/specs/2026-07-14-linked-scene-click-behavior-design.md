# Linked-scene click behavior on Campaign Record sheets

**Date:** 2026-07-14
**Status:** Design approved, pending spec review

## Problem

On Campaign Record entry sheets, a linked scene is rendered as a Foundry
`@UUID[Scene.…]` content link. Clicking it falls through to Foundry's default
content-link handling, which is permission-gated and not useful to players who
cannot open the Scene sheet. We want a deliberate, role-aware click behavior:

- A user who **can view** the scene loads it onto their canvas.
- A user who **cannot** view it gets a look at the scene's image instead —
  without that image being filed into a media entry.

## Scope

- Applies to **every scene content link** on Campaign Record entry sheets —
  both the dedicated "Scene" field (`system.scene`) and any scene mention typed
  into a record's description prose.
- Applies to **Place** and **Encounter** sheets today; both render scene links
  through `BaseRecordSheet`, so the change is centralized there and any future
  record type that links a scene inherits it.
- **Standard Foundry journals and every non-Campaign-Record sheet are left
  untouched.** The interception is bound only to Campaign Record sheet elements,
  so scene links elsewhere keep Foundry's default behavior.

## Behavior

When a scene content link on a Campaign Record sheet is clicked:

1. Resolve the linked scene from the link's `data-uuid`.
2. **If the user can view the scene** (`scene.canView` — true for GMs and for
   players with sufficient permission, including an owning player) → call
   `scene.view()` to load it onto their canvas.
3. **Otherwise, show the scene's image** in a local image popout:
   - source = `scene.background?.src`, falling back to `scene.thumb`;
   - if a source exists → `new foundry.applications.apps.ImagePopout({ src,
     window: { title: scene.name } }).render(true)`;
   - if neither exists → `ui.notifications.warn(...)` ("this scene has no
     image") and do nothing else.

> Implementation note: verify `Scene#canView` exists in Foundry v13 before
> relying on it. If it is unavailable, use the equivalent permission check
> (`game.user.isGM || scene.testUserPermission(game.user, "LIMITED")`) — do not
> assume the API without confirming against the running Foundry build.

### No media-entry capture

The image popout is rendered **locally** via `render(true)`. It never calls
`ImagePopout.prototype.shareImage`. Auto-capture (`scripts/hooks/auto-capture.mjs`)
only files media when `shareImage` runs, so showing the background image here
never creates or appends to a media entry. The constraint holds by construction,
and it reuses the exact pattern already at `hub-mixin.mjs:471-483`.

## Mechanism

- **Keep** the existing `@UUID[Scene.…]` enrichment in the Place and Encounter
  view templates. This preserves the content link's icon, scene name, and
  broken-link handling. **No template changes are required.**
- In `BaseRecordSheet._onRender`, register a **capture-phase** `click` listener
  on `this.element`:
  - Match `event.target.closest("a.content-link[data-uuid]")`.
  - If the link's document is a **Scene** (uuid begins with `Scene.` or the
    resolved document's `documentName === "Scene"`), call `event.preventDefault()`
    and `event.stopImmediatePropagation()`, then run the handler. Capture-phase
    `stopImmediatePropagation` prevents Foundry's body-delegated (bubble-phase)
    content-link handler from also firing.
  - Any non-scene content link is ignored and passes through to Foundry.
  - Guard against double-binding on re-render (follow the existing
    `dataset.crFlushBound` pattern in `_onRender`).

Because the listener is attached only to Campaign Record sheet elements,
ordinary journals and other applications are unaffected without any extra
scoping.

## Structure and testing

- Extract the branch decision into a **pure, Foundry-free** helper in
  `scripts/logic/scene-link.mjs`, mirroring the existing `logic/` style
  (e.g. `auto-capture.mjs`):

  ```js
  // Returns one of:
  //   { kind: "view" }
  //   { kind: "image", src, title }
  //   { kind: "notify" }
  export function resolveSceneClickAction({ canView, backgroundSrc, thumb, name }) { … }
  ```

  The sheet reads `canView`, `background?.src`, `thumb`, and `name` off the
  resolved scene, calls the helper, and performs the resulting Foundry action.

- **Unit tests (vitest):** cover every branch of `resolveSceneClickAction` —
  can-view → `view`; cannot-view with background → `image` (background src);
  cannot-view without background but with thumb → `image` (thumb); cannot-view
  with neither → `notify`.

- **E2e (Playwright / Foundry harness):** optional follow-up. The branch logic
  is fully covered by unit tests; the DOM wiring is thin.

## Non-goals

- No change to how scenes are linked, dropped, or unlinked.
- No change to `shareImage` / auto-capture behavior.
- No change to Foundry's default behavior for scene links outside Campaign
  Record sheets.
