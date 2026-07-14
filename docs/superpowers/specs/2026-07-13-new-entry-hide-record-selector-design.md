# New Entry dialog: hide the record selector when the hub is scoped to one group

**Date:** 2026-07-13
**Status:** Approved design

## Problem

When the campaign hub is scoped to a single campaign record (group), the "New Entry"
dialog still shows a redundant campaign-record selector (`<select name="group">`).
The user has already established which group they are working in, so the selector adds a
needless choice and invites picking the wrong group. The new entry should simply land in
the group the hub is already scoped to.

## Behavior

- **Hub scoped to a concrete group** — the New Entry dialog shows only **Name** and
  **Type**. The record selector is omitted, and the created entry lands in the scoped
  group automatically. This covers both:
  - `GroupHubSheet` (the hub rendered as a specific group's own sheet; hard-locked to
    `this.document.id`), and
  - the standalone `CampaignHub` when its group filter is set to a specific group.
- **Standalone hub scoped to "all"** — unchanged. The record selector is still shown so
  the user can choose the destination group.

## Implementation

Single file: `scripts/apps/hub/hub-mixin.mjs`, static handler `#onNewRecord`
(currently lines 339–375). No other files change.

### 1. Determine whether the hub is scoped to a concrete group

After `const current = this.groupScopeId;`, add:

```js
const scoped = groups.some((g) => g.id === current);
```

`scoped` is `true` when `current` is a real group present in the list — the
`GroupHubSheet` case (`this.document.id`) and the standalone-hub-filtered case. It is
`false` for the `"all"` sentinel and for any stale/unknown id, which safely falls back to
showing the selector.

### 2. Render the group form-group conditionally

The group `<div class="form-group">…<select name="group">${groupOptions}</select></div>`
block is included only when `!scoped`. When `scoped`, it is omitted entirely so the dialog
shows only Name and Type. The existing pre-selection logic in `groupOptions`
(`g.id === current ? "selected"`) is retained for the unscoped rendering path.

### 3. Resolve the group id in the ok callback

The `ok.callback` is an arrow function, so `this` is the hub instance. Resolve the group
from either the select (when shown) or the scoped id (when hidden):

```js
groupId: button.form.elements.group?.value ?? this.groupScopeId
```

When the selector is omitted there is no `group` element, so `?.value` is `undefined` and
the expression falls back to `this.groupScopeId` — a single source of truth, no hidden
input required. Downstream `game.journal.get(result.groupId)` and page creation are
unchanged.

## Edge cases

- **`current` not in `groups`** (e.g. `"all"` sentinel, or a scope pointing at a
  non-group / deleted document): `scoped` is `false`, selector is shown — current
  behavior preserved.
- **Empty group list**: unchanged — the handler already returns early with a warning
  before this logic.

## Testing

Add/extend a unit test around `#onNewRecord` covering both branches:

- **Scoped**: dialog content omits the `name="group"` select, and the resulting
  `groupId` equals the scoped group id.
- **Unscoped ("all")**: the `name="group"` select is present, and the chosen value is
  used as `groupId`.

Confirm and follow the existing test patterns for the hub handlers when writing the
implementation plan.

## Out of scope

- No change to the standalone hub's group-filter dropdown itself.
- No change to how groups are created, listed, or scoped elsewhere.
- No change to the auto-target-group world setting (unrelated to this dialog).
