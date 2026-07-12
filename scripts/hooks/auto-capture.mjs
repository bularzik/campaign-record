import { isGroup } from "../data/groups.mjs";
import { setTargetGroup, getTargetGroup } from "../settings/auto-target.mjs";
import { MODULE_ID, typeId, ENCOUNTER_FLAG, DEPARTED_FLAG } from "../constants.mjs";
import { addTimepoint, attachRecord, getTimepoints } from "../data/timepoints.mjs";
import { matchPlaceForScene, pickLatestTimepoint, collapseParticipants, mergeParticipants, summarizeOutcome } from "../logic/auto-capture.mjs";

const PLACE_TYPE = typeId("place");

/** Every place page in a group whose scene is set. */
function placesOf(group) {
  return group.pages.filter((p) => p.type === PLACE_TYPE && p.system.scene);
}

/** Live combatants as raw {actorUuid, name} entries. */
function combatParticipants(combat) {
  return combat.combatants.map((c) => ({ actorUuid: c.actor?.uuid ?? null, name: c.name }));
}

/** Best-effort current/max HP for an actor, or null when the system hides it. */
function actorHp(actor) {
  const hp = actor?.system?.attributes?.hp;
  return hp && typeof hp.value === "number" && typeof hp.max === "number"
    ? { value: hp.value, max: hp.max }
    : null;
}

/** The Encounter page linked to a combat, or null. */
async function linkedEncounter(combat) {
  const uuid = combat.getFlag(MODULE_ID, ENCOUNTER_FLAG);
  return uuid ? fromUuid(uuid) : null;
}

/** Additively merge the live roster into the linked Encounter (never shrinks). */
async function syncEncounterRoster(combat) {
  const encounter = await linkedEncounter(combat);
  if (!encounter) return;
  const merged = mergeParticipants(
    encounter.system.combatants.map((c) => c.toObject?.() ?? { ...c }),
    collapseParticipants(combatParticipants(combat))
  );
  await encounter.update({ "system.combatants": merged });
}

/** Note a departing combatant (with its defeated state) for the end summary. */
async function recordDeparture(combat, combatant) {
  if (!combat.getFlag(MODULE_ID, ENCOUNTER_FLAG)) return;
  const departed = [...(combat.getFlag(MODULE_ID, DEPARTED_FLAG) ?? [])];
  departed.push({ actorUuid: combatant.actor?.uuid ?? null, name: combatant.name, defeated: combatant.isDefeated === true });
  await combat.setFlag(MODULE_ID, DEPARTED_FLAG, departed);
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

  // Roster grows/changes → additively sync the Encounter's participants.
  const onRosterChange = (combatant) => {
    if (game.user !== game.users.activeGM) return;
    syncEncounterRoster(combatant.combat);
  };
  Hooks.on("createCombatant", onRosterChange);
  Hooks.on("updateCombatant", onRosterChange);
  // Removal doesn't shrink the record; note who left (and whether defeated).
  Hooks.on("deleteCombatant", (combatant) => {
    if (game.user !== game.users.activeGM) return;
    recordDeparture(combatant.combat, combatant);
  });

  // Combat ends → summarize deaths, injuries, and flights onto the Encounter.
  Hooks.on("deleteCombat", async (combat) => {
    if (game.user !== game.users.activeGM) return;
    const encounter = await linkedEncounter(combat);
    if (!encounter) return;
    const present = combat.combatants.map((c) => ({
      name: c.name, defeated: c.isDefeated === true, hp: actorHp(c.actor)
    }));
    const departed = combat.getFlag(MODULE_ID, DEPARTED_FLAG) ?? [];
    const outcome = summarizeOutcome({ present, departed }, {
      died: game.i18n.localize("CAMPAIGNRECORD.AutoCapture.Died"),
      injured: game.i18n.localize("CAMPAIGNRECORD.AutoCapture.Injured"),
      fled: game.i18n.localize("CAMPAIGNRECORD.AutoCapture.Fled"),
      none: game.i18n.localize("CAMPAIGNRECORD.AutoCapture.NoCasualties")
    });
    await encounter.update({ "system.outcome": outcome });
  });
}
