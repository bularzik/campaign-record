# libWrapper-Aware shareImage Capture — Design

**Date:** 2026-07-21
**Status:** Approved

## Problem

On world load with both Campaign Record and Monk's Common Display active, libWrapper
emits a conflict warning (console + UI notification — one warning, two deliveries):

> Detected non-libWrapper wrapping of
> 'foundry.applications.apps.ImagePopout.prototype.shareImage' by module
> campaign-record. This will potentially lead to conflicts.

Cause: `registerAutoCapture()` (`scripts/hooks/auto-capture.mjs:319-329`) monkey-patches
`ImagePopout.prototype.shareImage` directly to capture "Show Players" media onto the
newest timepoint (the method fires no hook, and the socket emit doesn't echo to the
sending GM). Monk's Common Display wraps the same method via libWrapper, so libWrapper
flags the classic patch on every world load for any user running both.

Behavior today is actually correct — the patch calls the original and preserves its
return value — but the warning names Campaign Record explicitly and will generate
support noise.

Also observed in the same load log: a `DocumentSheetConfig` global-access deprecation
from a file named `hooks.js`. **Not Campaign Record** — this module only uses the
namespaced `foundry.applications.apps.DocumentSheetConfig`
(`scripts/sheets/registration.mjs:15`) and ships no `hooks.js`. Out of scope; belongs
to whichever other module serves that file.

## Decision (user-approved 2026-07-21)

**Optional libWrapper integration with manual fallback.** Register through libWrapper
when the `lib-wrapper` module is active; otherwise keep the existing manual prototype
patch. No hard dependency. Not vendoring the official libWrapper shim (~200 lines to
serve one wrap site — a two-branch conditional is smaller; revisit if a second wrap
site ever appears).

## Design

All changes inside `registerAutoCapture()` in `scripts/hooks/auto-capture.mjs`, which
runs on the `setup` hook — libWrapper initializes at `init`, so its API is available
by then.

- Extract the capture body into one shared function used by both paths:
  GM check (`game.user.isGM`), `src` resolution (`options.image ?? this.options?.src`),
  `caption` resolution (existing fallback chain), then `captureSharedMedia(src, caption)`.
- **libWrapper path:** if `game.modules.get("lib-wrapper")?.active`, call
  `libWrapper.register(MODULE_ID,
  "foundry.applications.apps.ImagePopout.prototype.shareImage",
  function (wrapped, options = {}) { const result = wrapped(options); <capture>; return result; },
  "WRAPPER")` — `WRAPPER` type because we always call through and never alter behavior.
- **Fallback path:** the existing manual prototype patch, verbatim, now calling the
  shared capture function.
- **Error handling:** wrap `libWrapper.register` in try/catch; on throw, log a module
  warning and fall through to the manual patch so capture never silently disappears.
- `module.json`: add `relationships.recommends` entry for `lib-wrapper` so Foundry
  surfaces it as a suggestion without forcing installation.

## Not in scope

- The `DocumentSheetConfig` deprecation warning (other module's bug).
- Vendoring the libWrapper shim library.
- Any change to `captureSharedMedia` or timepoint filing logic.

## Testing

Per the test-tier policy (2026-07-18): smoke + affected specs only during
development; the full suite runs at the next publish gate.

- **Unit (vitest):** the extracted capture function — GM captures, non-GM doesn't;
  `options.image` takes precedence over `this.options.src`; caption fallback chain.
  Extend/adapt existing auto-capture tests to call through the new function. The
  libWrapper registration branch can't run under the unit harness (no libWrapper);
  cover the branch-selection logic (active → libWrapper path, inactive/missing/throw
  → manual patch) with a mocked `libWrapper` global.
- **E2E (affected specs):** existing Show-Players capture spec stays green. World B
  has lib-wrapper enabled (verified in its settings DB), so e2e exercises the new
  libWrapper registration path end-to-end; the manual-patch fallback is today's code
  verbatim and is covered at the unit level via branch-selection tests.
- **Manual checklist:** in a world with lib-wrapper + Monk's Common Display active,
  no libWrapper conflict warning on load, and Show Players still files media onto
  the newest timepoint.
