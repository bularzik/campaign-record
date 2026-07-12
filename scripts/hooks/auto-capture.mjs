import { isGroup } from "../data/groups.mjs";
import { setTargetGroup, getTargetGroup } from "../settings/auto-target.mjs";
import { MODULE_ID, typeId, ENCOUNTER_FLAG, DEPARTED_FLAG } from "../constants.mjs";
import { addTimepoint, attachRecord, getTimepoints } from "../data/timepoints.mjs";
import { matchPlaceForScene, pickLatestTimepoint, collapseParticipants } from "../logic/auto-capture.mjs";

const PLACE_TYPE = typeId("place");

/** Every place page in a group whose scene is set. */
function placesOf(group) {
  return group.pages.filter((p) => p.type === PLACE_TYPE && p.system.scene);
}

/** Live combatants as raw {actorUuid, name} entries. */
function combatParticipants(combat) {
  return combat.combatants.map((c) => ({ actorUuid: c.actor?.uuid ?? null, name: c.name }));
}

/**
 * Ensure the target group has a place for `scene`, returning it plus the
 * timepoint the caller should attach records to. Reuses an existing place;
 * adds a fresh end-of-timeline timepoint when asked (map activation) or when
 * the place has none yet (combat fallback).
 */
export async function ensurePlaceForScene(group, scene, { createTimepoint }) {
  // matchPlaceForScene matches on a top-level `.scene` property; place pages
  // carry it under `.system.scene`, so adapt the shape here and unwrap after.
  const candidates = placesOf(group).map((p) => ({ scene: p.system.scene, page: p }));
  let place = matchPlaceForScene(candidates, scene.uuid)?.page ?? null;
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

/** Register every auto-capture Foundry hook. Call during ready. */
export function registerAutoCapture() {
  // A newly created Campaign Record becomes the auto-capture target. Only the
  // creating user reacts, so the relay fires once.
  Hooks.on("createJournalEntry", (entry, options, userId) => {
    if (userId !== game.user.id) return;
    if (!isGroup(entry)) return;
    setTargetGroup(entry.id);
  });

  // GM activates a map → ensure a Place and add a fresh visit timepoint.
  Hooks.on("updateScene", async (scene, changes) => {
    if (game.user !== game.users.activeGM) return;
    if (changes.active !== true) return;
    const group = getTargetGroup();
    if (!group) return;
    await ensurePlaceForScene(group, scene, { createTimepoint: true });
  });

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
}
