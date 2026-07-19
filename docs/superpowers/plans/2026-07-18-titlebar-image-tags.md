# Title-Bar Image & Tags + New Entry Relocation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move record image and tag editing into the hub's record pane header (image = thumbnail button → FilePicker/ImagePopout; tags = badged button → popover editor), and relocate the New Entry button to the bottom of the left index pane.

**Architecture:** All new UI lives in the hub's own template parts (`record.hbs`, `index.hbs`) and is handled by new actions in `hub-mixin.mjs` — the pane header belongs to the hub app, not the mounted sub-sheet. Decisions (which buttons render, tag normalization) are pure functions in a new `scripts/logic/record-header.mjs` with vitest coverage. The old body `formGroup` controls for image/tags are removed; the body hero image stays, finally styled.

**Tech Stack:** Foundry VTT v13 AppV2/Handlebars, vanilla CSS, vitest (unit), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-07-18-titlebar-image-tags-design.md`

## Global Constraints

- Branch `feature/titlebar-image-tags`, worktree `.claude/worktrees/titlebar-image-tags`. Never commit to main.
- **Test-tier policy** (`.claude/skills/foundry-e2e/SKILL.md`, "Test tiers"): run only the spec files your task touches, plus `npm run e2e:smoke` in the final task. Do NOT run the full Playwright suite — it runs at the publish gate, not on this branch.
- Every e2e run follows the foundry-e2e skill contract: harness only, foreground waits, single-spec iteration, never steal the lock (`npm run e2e:unlock` is the user's command). All test world data uses the `E2E ` name prefix.
- Every template `{{localize}}`/`data-tooltip` key must exist in `lang/en.json` — `tests/i18n-coverage.test.js` enforces this.
- No schema changes, no migration, no new settings.
- The core journal "text" page (`type === "text"`) has no `system.image`/`system.tags`; header image/tag buttons must not render for it.
- Only the hub header hosts the new controls; the mounted sub-sheet templates lose their image/tags `formGroup` rows entirely.

---

### Task 1: Pure header-decision + tag logic

**Files:**
- Create: `scripts/logic/record-header.mjs`
- Test: `tests/record-header.test.js`

**Interfaces:**
- Produces (consumed by Tasks 3–4 in `hub-mixin.mjs`):
  - `buildHeaderActions({ isRecord, canEdit, hasImage, tagCount })` → `{ showImageButton, imageClickMode, showTagButton }` where `imageClickMode` is `"pick" | "popout" | null`
  - `normalizeTagAdd(tags, raw)` → new `string[]` to save, or `null` for a no-op (blank/duplicate)
  - `removeTag(tags, tag)` → new `string[]` without `tag` (exact match)

- [ ] **Step 1: Write the failing tests**

Create `tests/record-header.test.js`:

```js
import { describe, it, expect } from "vitest";
import { buildHeaderActions, normalizeTagAdd, removeTag } from "../scripts/logic/record-header.mjs";

describe("buildHeaderActions", () => {
  it("gives editors a pick-mode image button even with no image", () => {
    expect(buildHeaderActions({ isRecord: true, canEdit: true, hasImage: false, tagCount: 0 }))
      .toEqual({ showImageButton: true, imageClickMode: "pick", showTagButton: true });
  });
  it("gives non-editors a popout-mode button only when an image exists", () => {
    expect(buildHeaderActions({ isRecord: true, canEdit: false, hasImage: true, tagCount: 0 }).imageClickMode)
      .toBe("popout");
    expect(buildHeaderActions({ isRecord: true, canEdit: false, hasImage: false, tagCount: 0 }))
      .toEqual({ showImageButton: false, imageClickMode: null, showTagButton: false });
  });
  it("shows non-editors the tag button only when tags exist", () => {
    expect(buildHeaderActions({ isRecord: true, canEdit: false, hasImage: false, tagCount: 2 }).showTagButton)
      .toBe(true);
  });
  it("renders nothing for non-record (text) pages regardless of permissions", () => {
    expect(buildHeaderActions({ isRecord: false, canEdit: true, hasImage: true, tagCount: 3 }))
      .toEqual({ showImageButton: false, imageClickMode: null, showTagButton: false });
  });
});

describe("normalizeTagAdd", () => {
  it("trims and appends a new tag", () => {
    expect(normalizeTagAdd(["ally"], "  city ")).toEqual(["ally", "city"]);
  });
  it("returns null for blank input", () => {
    expect(normalizeTagAdd(["ally"], "   ")).toBeNull();
    expect(normalizeTagAdd([], null)).toBeNull();
  });
  it("returns null for a case-insensitive duplicate, preserving existing casing", () => {
    expect(normalizeTagAdd(["Ally"], "ally")).toBeNull();
  });
});

describe("removeTag", () => {
  it("removes exactly the named tag", () => {
    expect(removeTag(["ally", "city"], "ally")).toEqual(["city"]);
  });
  it("is a no-op for an unknown tag", () => {
    expect(removeTag(["ally"], "ghost")).toEqual(["ally"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/record-header.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/record-header.mjs`.

- [ ] **Step 3: Implement**

Create `scripts/logic/record-header.mjs`:

```js
/** Pure decisions for the hub record-pane header's image/tag controls. */

/**
 * Which header controls render, and what the image button does on click.
 * Non-record (core text) pages have no system.image/tags → nothing renders.
 * Editors always get the image button (pick mode); viewers get it only when
 * an image exists (popout mode). The tag button mirrors that: editors always,
 * viewers only when there are tags to read.
 */
export function buildHeaderActions({ isRecord, canEdit, hasImage, tagCount }) {
  const showImageButton = Boolean(isRecord && (canEdit || hasImage));
  return {
    showImageButton,
    imageClickMode: showImageButton ? (canEdit ? "pick" : "popout") : null,
    showTagButton: Boolean(isRecord && (canEdit || tagCount > 0))
  };
}

/**
 * Tags to save after adding `raw`, or null when nothing should change
 * (blank input, or a case-insensitive duplicate — first-seen casing wins).
 */
export function normalizeTagAdd(tags, raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) return null;
  return [...tags, value];
}

/** Tags to save after removing `tag` (exact match). */
export function removeTag(tags, tag) {
  return tags.filter((t) => t !== tag);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/record-header.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/record-header.mjs tests/record-header.test.js
git commit -m "feat: pure header-action and tag-normalization logic"
```

---

### Task 2: New Entry moves to the bottom of the left pane

**Files:**
- Modify: `templates/hub/index.hbs` (append footer before `</section>`)
- Modify: `templates/hub/timeline.hbs:4-7` (remove button)
- Modify: `templates/hub/record.hbs:11-14` (remove button)
- Modify: `styles/campaign-record.css` (add `.index-footer` rules)
- Test: `tests/e2e/05-hub.spec.mjs`, `tests/e2e/21-hub-record-pane.spec.mjs`, `tests/e2e/22-group-hub-sheet.spec.mjs`

**Interfaces:**
- Consumes: existing `newRecord` action (`hub-mixin.mjs:59`, handler `#onNewRecord` — unchanged).
- Produces: the ONLY New Entry button now lives at `.hub-index .index-footer [data-action="newRecord"]` — Tasks 3–4 and all e2e specs rely on the timeline/pane-header copies being gone.

- [ ] **Step 1: Update the e2e assertions first (they are the failing tests)**

In `tests/e2e/05-hub.spec.mjs`, rewrite the test at line 52. New title and assertions:

```js
test("New Entry sits at the bottom of the index; typed entries show no edit-toggle", async ({ page }) => {
  await login(page, "Gamemaster");
  await createGroupWithPage(page, "E2E Hub Nav Group", "E2E Hub Nav Npc", "campaign-record.npc");
  await page.evaluate(async () => {
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    CampaignHub.open();
  });
  const hub = page.locator("#campaign-hub");
  await hub.waitFor({ timeout: 15_000 });

  await expect(hub.locator('.hub-index .index-footer [data-action="newRecord"]')).toBeVisible();
  await expect(hub.locator('.hub-timeline [data-action="newRecord"]')).toHaveCount(0);

  await hub.locator(".record-row", { hasText: "E2E Hub Nav Npc" }).click();
  const header = hub.locator(".hub-record.active .record-pane-header");
  await expect(header.locator('[data-action="newRecord"]')).toHaveCount(0);
  // A typed entry is inline-editable (default), so no manual edit-toggle is shown.
  await expect(header.locator('[data-action="toggleEditMode"]')).toHaveCount(0);

  await deleteGroupsByPrefix(page, "E2E Hub Nav");
});
```

In `tests/e2e/21-hub-record-pane.spec.mjs:246` and `tests/e2e/22-group-hub-sheet.spec.mjs:77`, replace the click selector and delete the now-stale two-line comment above each ("The shared right-pane nav also renders…"):

```js
await hub.locator('.hub-index [data-action="newRecord"]').click();     // 21 (hub locator)
await sheet.locator('.hub-index [data-action="newRecord"]').click();   // 22 (sheet locator)
```

Then sweep for stragglers: `grep -rn 'newRecord' tests/e2e/` — update any other `.hub-timeline`/`.record-pane-header` newRecord selector the same way (expected: none beyond these three files).

- [ ] **Step 2: Run one updated spec to verify it fails against current templates**

Run: `npx playwright test tests/e2e/05-hub.spec.mjs` (foreground)
Expected: the rewritten test FAILS (`.index-footer` doesn't exist yet); other tests in the file pass.

- [ ] **Step 3: Move the button in the templates**

`templates/hub/index.hbs` — insert before the closing `</section>` (after the `</ol>` at line 72):

```hbs
  <div class="index-footer">
    <button type="button" class="new-record" data-action="newRecord">
      <i class="fa-solid fa-plus"></i> {{localize "CAMPAIGNRECORD.Hub.NewRecord"}}
    </button>
  </div>
```

`templates/hub/timeline.hbs` — delete lines 4-7 (the `<button class="new-record" …>` block); keep the `.timeline-tools` div and nav partial.

`templates/hub/record.hbs` — delete lines 11-14 (the `<button class="new-record" …>` block); Tasks 3-4 will fill this slot.

- [ ] **Step 4: Pin the footer with CSS**

In `styles/campaign-record.css`, after the `.campaign-hub .hub-index` block (ends line ~662):

```css
/* New Entry pinned to the bottom of the index; sticky so it stays visible
   while the (scrolling) index is scrolled. Hidden with the rest of the rail
   when collapsed via the existing .rail-collapsed rule. */
.campaign-hub .hub-index .index-footer {
  margin-top: auto;
  position: sticky;
  bottom: 0;
  padding: 0.25rem 0;
  background: var(--color-bg, var(--color-cool-5, #23221d));
}
.campaign-hub .hub-index .index-footer .new-record {
  width: 100%;
}
```

- [ ] **Step 5: Run the three affected specs**

Run: `npx playwright test tests/e2e/05-hub.spec.mjs tests/e2e/21-hub-record-pane.spec.mjs tests/e2e/22-group-hub-sheet.spec.mjs` (foreground)
Expected: PASS (all tests in the three files).

- [ ] **Step 6: Commit**

```bash
git add templates/hub/index.hbs templates/hub/timeline.hbs templates/hub/record.hbs styles/campaign-record.css tests/e2e/05-hub.spec.mjs tests/e2e/21-hub-record-pane.spec.mjs tests/e2e/22-group-hub-sheet.spec.mjs
git commit -m "feat: New Entry moves to the bottom of the left index pane"
```

---

### Task 3: Image thumbnail button in the record pane header

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs` (action registration ~line 57, view context ~line 860, new handler near `#onOpenLink` ~line 563)
- Modify: `templates/hub/record.hbs` (header, in the slot Task 2 vacated)
- Modify: `templates/partials/common-view.hbs:3` and `templates/partials/common-edit.hbs:1` (remove image `formGroup`)
- Modify: `styles/campaign-record.css` (header button + body `.record-image`)
- Modify: `lang/en.json` (Hub keys)
- Test: create `tests/e2e/31-record-header.spec.mjs`

**Interfaces:**
- Consumes: `buildHeaderActions` from Task 1; `#resolveViewedPage()` (`hub-mixin.mjs:97`); FilePicker idiom from `scripts/sheets/media-sheet.mjs:33` (`foundry.applications.apps.FilePicker.implementation`); ImagePopout idiom from `hub-mixin.mjs:567`.
- Produces: `context.view.headerActions`, `context.view.image`, `context.view.tags`, `context.view.tagCount`, `context.view.isRecord` — Task 4's template blocks reuse these. Action name `pickRecordImage`.

- [ ] **Step 1: Extend the view context in `hub-mixin.mjs`**

Add to the imports at the top of the file:

```js
import { buildHeaderActions } from "../../logic/record-header.mjs";
```

(Match the exact relative path style of the existing `inline-edit.mjs` import in this file.)

Inside `_prepareContext` where `context.view` is built (line ~870), extend the object:

```js
const isRecord = typeof viewedPage.type === "string" && viewedPage.type.startsWith("campaign-record.");
const tags = Array.from(viewedPage.system?.tags ?? []);
context.view = {
  name: viewedPage.name,
  editing,
  canEdit,
  isRecord,
  image: viewedPage.system?.image || "",
  tags,
  tagCount: tags.length,
  headerActions: buildHeaderActions({
    isRecord,
    canEdit,
    hasImage: Boolean(viewedPage.system?.image),
    tagCount: tags.length
  }),
  nameEditable: isNameEditable({ canEdit, editing, inlineEditable: inlineEditableView }),
  showEditToggle: shouldShowEditToggle({
    canEdit,
    inViewMode: this.state.view.mode !== "edit",
    inlineEditableView
  })
};
```

- [ ] **Step 2: Register and implement the action**

In `DEFAULT_OPTIONS.actions` (line ~57) add:

```js
pickRecordImage: HubBase.#onPickRecordImage,
```

Add the handler beside `#onOpenLink` (~line 563):

```js
/** Header thumbnail: editors pick a new image; viewers get a full-size popout. */
static async #onPickRecordImage() {
  const page = this.#resolveViewedPage();
  if (!page) return;
  if (!page.canUserModify(game.user, "update")) {
    const src = page.system?.image;
    if (src) new foundry.applications.apps.ImagePopout({ src, window: { title: page.name } }).render(true);
    return;
  }
  const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
  new FilePickerImpl({
    type: "image",
    current: page.system?.image || "",
    callback: (path) => page.update({ "system.image": path })
  }).render(true);
}
```

- [ ] **Step 3: Render the button in `templates/hub/record.hbs`**

In the slot after the title (where New Entry was, before the edit-toggle block):

```hbs
    {{#if view.headerActions.showImageButton}}
    <button type="button" class="record-image-button" data-action="pickRecordImage"
            data-tooltip="CAMPAIGNRECORD.Hub.RecordImage"
            aria-label="{{localize "CAMPAIGNRECORD.Hub.RecordImage"}}">
      {{#if view.image}}<img src="{{view.image}}" alt="">{{else}}<i class="fa-solid fa-image"></i>{{/if}}
    </button>
    {{/if}}
```

- [ ] **Step 4: Remove the body image control; style the hero image**

- `templates/partials/common-view.hbs`: delete line 3 (`{{formGroup systemFields.image …}}`). Keep the `<img class="record-image">` on line 2 and in the non-inline branch.
- `templates/partials/common-edit.hbs`: delete line 1 (`{{formGroup systemFields.image …}}`).
- `styles/campaign-record.css` — add near the `.record-pane-mount` rules (~line 739):

```css
/* Hero image in the record body: capped and contained (was unstyled). */
.record-pane-mount .record-image {
  display: block;
  max-width: 100%;
  max-height: 300px;
  object-fit: contain;
  margin: 0 auto 0.5rem;
  border: none;
}
/* Header thumbnail button. */
.record-pane-header .record-image-button {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  padding: 0;
  overflow: hidden;
}
.record-pane-header .record-image-button img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border: none;
  border-radius: 3px;
}
```

- [ ] **Step 5: Add i18n keys**

In `lang/en.json`, inside the `Hub` object (after `"NewRecord": "New Entry",` line 43):

```json
"RecordImage": "Entry image",
```

- [ ] **Step 6: Unit tests still green (i18n coverage picks up the new key)**

Run: `npx vitest run tests/i18n-coverage.test.js tests/record-header.test.js`
Expected: PASS.

- [ ] **Step 7: New e2e spec — image behaviors**

Create `tests/e2e/31-record-header.spec.mjs` (model imports/setup on `tests/e2e/05-hub.spec.mjs`):

```js
import { test, expect } from "@playwright/test";
import { login, createGroupWithPage, deleteGroupsByPrefix } from "./helpers/foundry.mjs";

test.describe("record pane header: image & tags", () => {
  test("GM sees the thumbnail button; picking an image updates header and index", async ({ page }) => {
    await login(page, "Gamemaster");
    const a = await createGroupWithPage(page, "E2E Header Group", "E2E Header Npc", "campaign-record.npc");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    await hub.locator(".record-row", { hasText: "E2E Header Npc" }).click();

    const button = hub.locator('.record-pane-header [data-action="pickRecordImage"]');
    await expect(button).toBeVisible();
    await expect(button.locator("i.fa-image")).toBeVisible(); // placeholder icon, no image yet

    // FilePicker's file browser is not e2e-driven (tier policy / no fixture
    // files): set the image through the same update path the picker callback
    // uses, then assert every surface reflects it.
    await page.evaluate(async ({ a }) => {
      const group = game.journal.get(a.groupId);
      const p = group.pages.find((x) => x.name === "E2E Header Npc");
      await p.update({ "system.image": "icons/svg/mystery-man.svg" });
    }, { a });
    await expect(button.locator("img")).toHaveAttribute("src", "icons/svg/mystery-man.svg");
    await expect(
      hub.locator(".record-row", { hasText: "E2E Header Npc" }).locator("img.record-thumb")
    ).toHaveAttribute("src", "icons/svg/mystery-man.svg");

    await deleteGroupsByPrefix(page, "E2E Header");
  });

  test("no image/tag buttons on a core text page", async ({ page }) => {
    await login(page, "Gamemaster");
    await createGroupWithPage(page, "E2E Header Text Group", "E2E Header Text", "text");
    await page.evaluate(async () => {
      const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
      CampaignHub.open();
    });
    const hub = page.locator("#campaign-hub");
    await hub.waitFor({ timeout: 15_000 });
    await hub.locator(".record-row", { hasText: "E2E Header Text" }).click();
    await expect(hub.locator(".hub-record.active .record-pane-mount")).toBeVisible();
    await expect(hub.locator('.record-pane-header [data-action="pickRecordImage"]')).toHaveCount(0);
    await expect(hub.locator('.record-pane-header [data-action="toggleTagPopover"]')).toHaveCount(0);
    await deleteGroupsByPrefix(page, "E2E Header Text");
  });
});
```

(If `createGroupWithPage` rejects type `"text"`, create the group with an npc page and add a text page via `page.evaluate` — check the helper's signature in `tests/e2e/helpers/foundry.mjs` first.)

- [ ] **Step 8: Run the new spec**

Run: `npx playwright test tests/e2e/31-record-header.spec.mjs` (foreground)
Expected: PASS. (The `toggleTagPopover` zero-count assertion passes trivially — the action ships in Task 4.)

- [ ] **Step 9: Commit**

```bash
git add scripts/apps/hub/hub-mixin.mjs templates/hub/record.hbs templates/partials/common-view.hbs templates/partials/common-edit.hbs styles/campaign-record.css lang/en.json tests/e2e/31-record-header.spec.mjs
git commit -m "feat: image thumbnail button in the record pane header"
```

---

### Task 4: Tag button + popover editor

**Files:**
- Modify: `scripts/apps/hub/hub-mixin.mjs` (actions, `state` line ~88, handlers, `_onRender` bindings near line ~995)
- Modify: `templates/hub/record.hbs` (after the image button)
- Modify: `templates/partials/common-view.hbs:4` and `templates/partials/common-edit.hbs:2` (remove tags `formGroup` — note: after Task 3's deletions these are now line 3 / line 1)
- Modify: `styles/campaign-record.css`, `lang/en.json`
- Test: extend `tests/e2e/31-record-header.spec.mjs`

**Interfaces:**
- Consumes: `normalizeTagAdd`, `removeTag` from Task 1 (extend the existing `record-header.mjs` import); `context.view.tags`/`tagCount`/`canEdit`/`headerActions.showTagButton` from Task 3; the doctype-menu open/close + focus-restore patterns at `hub-mixin.mjs:995-1019`.
- Produces: actions `toggleTagPopover`, `removeTag`; input `input[name="tag-add"]`; markup `.record-tags` / `.tag-popover` / `.tag-chip[data-tag]`.

- [ ] **Step 1: State, actions, handlers in `hub-mixin.mjs`**

Extend the Task 3 import line: `import { buildHeaderActions, normalizeTagAdd, removeTag } from "../../logic/record-header.mjs";`

Add `tagMenuOpen: false` to the `state` initializer (line ~90). In `_prepareContext`, alongside the other menu flags (line ~829), add `context.tagMenuOpen = this.state.tagMenuOpen;` — and when `context.view` comes out null, also reset `this.state.tagMenuOpen = false`.

Register actions:

```js
toggleTagPopover: HubBase.#onToggleTagPopover,
removeTag: HubBase.#onRemoveTag,
```

Handlers (beside `#onPickRecordImage`):

```js
static #onToggleTagPopover() {
  this.state.tagMenuOpen = !this.state.tagMenuOpen;
  this.render({ parts: ["record"] });
}

static async #onRemoveTag(event, target) {
  const page = this.#resolveViewedPage();
  if (!page?.canUserModify(game.user, "update")) return;
  const tag = target.closest("[data-tag]").dataset.tag;
  await page.update({ "system.tags": removeTag(Array.from(page.system?.tags ?? []), tag) });
}
```

- [ ] **Step 2: Popover open/close + add-input bindings in `_onRender`**

Add a `crTagsBound` block following the `crTypeBound` pattern (line ~995):

```js
if (!this.element.dataset.crTagsBound) {
  this.element.dataset.crTagsBound = "1";
  // Close the popover on any click outside it (its own buttons re-render anyway).
  this.element.addEventListener("click", (event) => {
    if (this.state.tagMenuOpen && !event.target.closest(".record-tags")) {
      this.state.tagMenuOpen = false;
      this.render({ parts: ["record"] });
    }
  });
  this.element.addEventListener("keydown", async (event) => {
    if (event.key === "Escape" && this.state.tagMenuOpen) {
      this.state.tagMenuOpen = false;
      return this.render({ parts: ["record"] });
    }
    if (event.key !== "Enter") return;
    const input = event.target.closest?.('input[name="tag-add"]');
    if (!input) return;
    event.preventDefault();
    const page = this.#resolveViewedPage();
    if (!page?.canUserModify(game.user, "update")) return;
    const next = normalizeTagAdd(Array.from(page.system?.tags ?? []), input.value);
    if (!next) { input.value = ""; return; }
    await page.update({ "system.tags": next });
    // The update's hook re-render may be deferred while this input holds
    // focus (hasActiveEditorFocus guard) — render the part explicitly and
    // restore focus, mirroring the doctype-check pattern above.
    await this.render({ parts: ["record"] });
    this.element.querySelector('input[name="tag-add"]')?.focus();
  });
}
```

- [ ] **Step 3: Popover markup in `templates/hub/record.hbs`**

Directly after the Task 3 image-button block:

```hbs
    {{#if view.headerActions.showTagButton}}
    <div class="record-tags">
      <button type="button" class="record-tags-button" data-action="toggleTagPopover"
              data-tooltip="CAMPAIGNRECORD.Hub.RecordTags"
              aria-label="{{localize "CAMPAIGNRECORD.Hub.RecordTags"}}"
              aria-haspopup="true" aria-expanded="{{#if tagMenuOpen}}true{{else}}false{{/if}}">
        <i class="fa-solid fa-tags"></i>{{#if view.tagCount}}<span class="tag-count">{{view.tagCount}}</span>{{/if}}
      </button>
      {{#if tagMenuOpen}}
      <div class="tag-popover">
        {{#each view.tags}}
        <span class="tag-chip" data-tag="{{this}}">{{this}}{{#if @root.view.canEdit}}<a data-action="removeTag"
              aria-label="{{localize "CAMPAIGNRECORD.Hub.RemoveTag"}}"><i class="fa-solid fa-xmark"></i></a>{{/if}}</span>
        {{/each}}
        {{#if view.canEdit}}
        <input type="text" name="tag-add" placeholder="{{localize "CAMPAIGNRECORD.Hub.AddTag"}}" autocomplete="off">
        {{/if}}
      </div>
      {{/if}}
    </div>
    {{/if}}
```

- [ ] **Step 4: Remove the body tags control; CSS; i18n**

- Delete the `{{formGroup systemFields.tags …}}` line from both `templates/partials/common-view.hbs` and `templates/partials/common-edit.hbs` (the last remaining `formGroup` in each).
- `styles/campaign-record.css`, after the Task 3 header rules:

```css
.record-pane-header .record-tags { position: relative; flex: 0 0 auto; }
.record-pane-header .record-tags-button .tag-count {
  font-size: var(--font-size-11, 0.75rem);
  margin-left: 2px;
}
.record-pane-header .tag-popover {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 5;
  min-width: 200px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0.5rem;
  background: var(--color-bg-option, var(--color-cool-5, #23221d));
  border: 1px solid var(--color-border-dark, #000);
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}
.tag-popover .tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border: 1px solid var(--color-border-light-tertiary, #7a7971);
  border-radius: 3px;
  font-size: var(--font-size-12, 0.8rem);
}
.tag-popover .tag-chip a { cursor: pointer; }
.tag-popover input[name="tag-add"] { flex: 1 1 100%; min-width: 120px; }
```

- `lang/en.json`, next to Task 3's `RecordImage` key:

```json
"RecordTags": "Tags",
"AddTag": "Add tag…",
"RemoveTag": "Remove tag",
```

- [ ] **Step 5: Unit + i18n check**

Run: `npx vitest run tests/i18n-coverage.test.js tests/record-header.test.js`
Expected: PASS.

- [ ] **Step 6: Extend `tests/e2e/31-record-header.spec.mjs` with tag tests**

Append inside the describe block:

```js
test("GM adds and removes tags via the popover; badge tracks the count", async ({ page }) => {
  await login(page, "Gamemaster");
  await createGroupWithPage(page, "E2E Tag Group", "E2E Tag Npc", "campaign-record.npc");
  await page.evaluate(async () => {
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    CampaignHub.open();
  });
  const hub = page.locator("#campaign-hub");
  await hub.waitFor({ timeout: 15_000 });
  await hub.locator(".record-row", { hasText: "E2E Tag Npc" }).click();

  const tagButton = hub.locator('.record-pane-header [data-action="toggleTagPopover"]');
  await tagButton.click();
  const popover = hub.locator(".tag-popover");
  await popover.locator('input[name="tag-add"]').fill("ally");
  await popover.locator('input[name="tag-add"]').press("Enter");
  await expect(hub.locator('.tag-chip[data-tag="ally"]')).toBeVisible();
  await expect(tagButton.locator(".tag-count")).toHaveText("1");

  // Duplicate (case-insensitive) is a no-op.
  await hub.locator('.tag-popover input[name="tag-add"]').fill("ALLY");
  await hub.locator('.tag-popover input[name="tag-add"]').press("Enter");
  await expect(hub.locator(".tag-chip")).toHaveCount(1);

  await hub.locator('.tag-chip[data-tag="ally"] [data-action="removeTag"]').click();
  await expect(hub.locator(".tag-chip")).toHaveCount(0);
  await expect(tagButton.locator(".tag-count")).toHaveCount(0);

  // Outside click closes the popover.
  await hub.locator(".record-pane-title").click();
  await expect(hub.locator(".tag-popover")).toHaveCount(0);

  await deleteGroupsByPrefix(page, "E2E Tag");
});

test("a player sees tags read-only: no remove links, no add input", async ({ browser, page }) => {
  await login(page, "Gamemaster");
  const a = await createGroupWithPage(page, "E2E Tag RO Group", "E2E Tag RO Npc", "campaign-record.npc");
  await page.evaluate(async ({ a }) => {
    const group = game.journal.get(a.groupId);
    await group.update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER } });
    const p = group.pages.find((x) => x.name === "E2E Tag RO Npc");
    await p.update({ "system.tags": ["ally", "city"] });
  }, { a });

  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await login(playerPage, "User 1");
  await playerPage.evaluate(async () => {
    const { CampaignHub } = await import("/modules/campaign-record/scripts/apps/hub/campaign-hub.mjs");
    CampaignHub.open();
  });
  const hub = playerPage.locator("#campaign-hub");
  await hub.waitFor({ timeout: 15_000 });
  await hub.locator(".record-row", { hasText: "E2E Tag RO Npc" }).click();
  await hub.locator('.record-pane-header [data-action="toggleTagPopover"]').click();
  await expect(hub.locator(".tag-chip")).toHaveCount(2);
  await expect(hub.locator('.tag-popover [data-action="removeTag"]')).toHaveCount(0);
  await expect(hub.locator('.tag-popover input[name="tag-add"]')).toHaveCount(0);
  // No image on this record and no update permission → no image button either.
  await expect(hub.locator('.record-pane-header [data-action="pickRecordImage"]')).toHaveCount(0);
  await playerContext.close();

  await deleteGroupsByPrefix(page, "E2E Tag RO");
});
```

(Model the second browser context on `tests/e2e/04-collaboration-secrecy.spec.mjs` if its setup differs — that spec is the project's canonical GM+player pattern.)

- [ ] **Step 7: Run the spec**

Run: `npx playwright test tests/e2e/31-record-header.spec.mjs` (foreground)
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add scripts/apps/hub/hub-mixin.mjs templates/hub/record.hbs templates/partials/common-view.hbs templates/partials/common-edit.hbs styles/campaign-record.css lang/en.json tests/e2e/31-record-header.spec.mjs
git commit -m "feat: tag button and popover editor in the record pane header"
```

---

### Task 5: Verification sweep (tier policy — no full suite)

**Files:**
- Test only; no source changes expected.

- [ ] **Step 1: Full unit suite**

Run: `npx vitest run`
Expected: all green (371 existing + Task 1's 8 + any i18n additions counted within).

- [ ] **Step 2: Smoke + all touched e2e specs, one foreground run**

Run: `npm run e2e:smoke && npx playwright test tests/e2e/05-hub.spec.mjs tests/e2e/18-inline-edit.spec.mjs tests/e2e/21-hub-record-pane.spec.mjs tests/e2e/22-group-hub-sheet.spec.mjs tests/e2e/31-record-header.spec.mjs`
Expected: PASS. (`18-inline-edit` is included because Tasks 3-4 edited `common-view.hbs`/`common-edit.hbs`, which its prose-editor tests render.) Per the test-tier policy, the FULL suite is NOT run on this branch — it runs at the next publish gate.

- [ ] **Step 3: Fix anything that surfaced; commit any fixes**

```bash
git add -A && git commit -m "fix: verification-sweep fallout"   # only if changes exist
```

