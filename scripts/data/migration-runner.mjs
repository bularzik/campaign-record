import { MODULE_ID, GROUP_FLAG, SCHEMA_VERSION, SCHEMA_SETTING } from "../constants.mjs";
import { pendingMigrations, isDowngrade } from "../logic/migrations.mjs";
import { getGroups } from "./groups.mjs";

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
    console.log(`campaign-record | migrating world data to schema ${migration.version}`);
    await migration.run();
    await game.settings.set(MODULE_ID, SCHEMA_SETTING, migration.version);
  }
}
