# Checklist Actor Assignee — Design

**Date:** 2026-07-18
**Status:** Approved

## Summary

Checklist items are currently assignable to Foundry **users** (`assignee` stores a
user ID; the edit dropdown lists `game.users`). Assignment should instead target
**player characters**: the dropdown lists all character-type actors, and the view
mode shows the character's name as a link that opens the actor sheet.

## Decisions

- **Assignable set:** all world actors with `type === "character"`, sorted by
  name. No player-ownership filter, no fallback to users.
- **Storage:** reuse the existing `assignee` `StringField`; it now holds an
  Actor ID (or `""`). No schema shape change, no UUIDs.
- **Migration:** world migration maps each stored user ID to that user's
  assigned character (`user.character.id`); users with no character are cleared
  to `""`.
- **View display:** the assignee renders as the actor's name, clickable to open
  the actor sheet when the viewing user has at least LIMITED permission on the
  actor; plain text otherwise.

## Changes by file

### `scripts/data/checklist.mjs`

Unchanged. `assignee` remains a plain `StringField` whose value is now an Actor
ID.

### `scripts/sheets/checklist-sheet.mjs`

- `_prepareContext`:
  - Replace `userOptions` with `actorOptions`: entries from
    `game.actors.filter(a => a.type === "character")`, sorted by name,
    `{id: name}`.
  - Resolve `assigneeName` via `game.actors.get(item.assignee)?.name ?? ""`.
  - Add `assigneeVisible` per item:
    `actor?.testUserPermission(game.user, "LIMITED") ?? false`.
- New static action `openAssignee`: reads the row's assignee ID from the
  clicked element's row, `game.actors.get(id)?.sheet.render(true)`. Missing
  actor → silent no-op.

### `templates/partials/checklist-items.hbs` (edit mode)

The assignee `<select>` sources `@root.actorOptions` instead of
`@root.userOptions`.

### `templates/checklist/view.hbs`

The assignee span becomes
`<a data-action="openAssignee">{{name}}</a>` when `assigneeVisible`, otherwise
the existing plain `<span class="assignee">`.

### `scripts/constants.mjs` / `scripts/data/migration-runner.mjs`

- Bump `SCHEMA_VERSION` to 5.
- Migration `version: 5`: for each group, for each checklist-type page, for
  each item whose `assignee` matches a known user ID
  (`game.users.get(id)` truthy), replace it with
  `game.users.get(id).character?.id ?? ""`. Batch page updates per group via
  `updateEmbeddedDocuments`. Items with empty assignees or values that are not
  user IDs are untouched, so the migration is idempotent.
- Pure mapping logic (assignee value + user lookup → replacement value) lives
  in `scripts/logic/migrations.mjs` so it is unit-testable without Foundry
  globals.

## Error handling

- Unknown or deleted actor IDs resolve to `assigneeName === ""` and render as
  unassigned — same graceful fallback as today.
- `openAssignee` on a missing actor does nothing.
- Players without LIMITED permission on the assigned actor see the name as
  plain text (no dead link, no permission error notification).

## Testing

- **Unit:** pure migration mapping — user with character → character ID, user
  without character → `""`, non-user value untouched, empty untouched.
- **E2E** (`tests/e2e/11-checklist.spec.mjs`): create a character-type actor,
  assign it to a checklist item in edit mode, verify the name renders in view
  mode, click it and verify the actor sheet opens. Clean up the actor.
- World B must contain (or the spec must create) at least one character-type
  actor.
