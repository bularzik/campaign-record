import { MODULE_ID, GROUP_FLAG, SCHEMA_VERSION, SCHEMA_SETTING, GROUP_SHEET_CLASS, typeId } from "../constants.mjs";
import { pendingMigrations, isDowngrade, checklistAssigneeUpdates, needsSheetClassRewrite } from "../logic/migrations.mjs";
import { getGroups } from "./groups.mjs";
import { addLink } from "./timepoints.mjs";
import { recordLinkMigrationEntries } from "../logic/timeline-links.mjs";

let readOnly = false;

/** True when the world's schema is newer than this module: block module writes. */
export function isModuleReadOnly() {
  return readOnly;
}

/** Ascending structural migrations. Each moves the world TO `version`. */
export const MIGRATIONS = [
  {
    version: 1,
    // Dev-era worlds may carry a truthy-but-malformed group flag; normalize to
    // the {timepoints: []} shape the timeline relies on.
    async run() {
      for (const group of getGroups()) {
        const flag = group.getFlag(MODULE_ID, GROUP_FLAG);
        if (!Array.isArray(flag?.timepoints)) {
          await group.setFlag(MODULE_ID, GROUP_FLAG, { timepoints: [] });
        }
      }
    }
  },
  {
    version: 2,
    // Pre-existing groups open in the core journal sheet; point them at the
    // hub sheet unless the user manually chose a different sheet.
    async run() {
      for (const group of getGroups()) {
        if (group.flags?.core?.sheetClass) continue;
        await group.update({ "flags.core.sheetClass": GROUP_SHEET_CLASS });
      }
    }
  }
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
  ,{
    version: 4,
    // Timepoints gained a real-world createdAt and an in-world campaignDate.
    // True creation time is unrecoverable, so stamp existing timepoints with
    // the migration time; campaignDate stays unset. Idempotent: a group whose
    // timepoints all already carry createdAt is skipped.
    async run() {
      const now = Date.now();
      for (const group of getGroups()) {
        const flag = group.getFlag(MODULE_ID, GROUP_FLAG);
        const tps = flag?.timepoints;
        if (!Array.isArray(tps) || !tps.length) continue;
        if (tps.every((t) => Number.isFinite(t.createdAt))) continue;
        const stamped = tps.map((t) =>
          Number.isFinite(t.createdAt) ? t : { ...t, createdAt: now });
        await group.setFlag(MODULE_ID, GROUP_FLAG, { ...flag, timepoints: stamped });
      }
    }
  }
  ,{
    version: 5,
    // Checklist assignees moved from user IDs to character actor IDs. Map
    // each stored user ID to that user's assigned character; users without
    // a character are cleared. Values that are not known user IDs (empty,
    // already actor IDs) pass through, so re-running is a no-op.
    async run() {
      const userCharacters = new Map(
        game.users.map((u) => [u.id, u.character?.id ?? null])
      );
      for (const group of getGroups()) {
        const pages = group.pages
          .filter((p) => p.type === typeId("checklist"))
          .map((p) => ({ id: p.id, items: p.system.toObject().items }));
        const updates = checklistAssigneeUpdates(pages, userCharacters);
        if (updates.length) await group.updateEmbeddedDocuments("JournalEntryPage", updates);
      }
    }
  }
  ,{
    version: 6,
    // v1.1.0 renamed the pinned group sheet CampaignGroupSheet → GroupHubSheet,
    // but migration 2 skips groups whose flag is already set, so pre-v1.1.0
    // groups kept the stale class: they open in the system journal sheet and
    // fail every inGroup check (no inline editing). Rewrite exactly the
    // legacy value; current or user-chosen foreign sheets pass through.
    async run() {
      for (const group of getGroups()) {
        if (!needsSheetClassRewrite(group.flags?.core?.sheetClass)) continue;
        await group.update({ "flags.core.sheetClass": GROUP_SHEET_CLASS });
      }
    }
  }
];

export function registerSchemaSetting() {
  game.settings.register(MODULE_ID, SCHEMA_SETTING, {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
}

/** Run at ready: every client checks for downgrade; only the GM migrates. */
export async function runMigrations() {
  const stored = game.settings.get(MODULE_ID, SCHEMA_SETTING);
  if (isDowngrade(stored, SCHEMA_VERSION)) {
    readOnly = true;
    ui.notifications.warn(
      game.i18n.format("CAMPAIGNRECORD.Warning.SchemaNewer", {
        stored,
        current: SCHEMA_VERSION
      }),
      { permanent: true }
    );
    return;
  }
  if (!game.user.isGM || stored >= SCHEMA_VERSION) return;
  for (const migration of pendingMigrations(MIGRATIONS, stored, SCHEMA_VERSION)) {
    try {
      console.log(`campaign-record | migrating world data to schema ${migration.version}`);
      await migration.run();
      await game.settings.set(MODULE_ID, SCHEMA_SETTING, migration.version);
    } catch (error) {
      console.error(`campaign-record | migration to schema ${migration.version} failed`, error);
      ui.notifications.error(
        game.i18n.format("CAMPAIGNRECORD.Warning.MigrationFailed", { version: migration.version }),
        { permanent: true }
      );
      return; // stop at the failed step; remaining migrations wait for the next attempt
    }
  }
}
