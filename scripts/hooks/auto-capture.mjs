import { isGroup } from "../data/groups.mjs";
import { setTargetGroup, getTargetGroup } from "../settings/auto-target.mjs";
import { MODULE_ID, typeId, ENCOUNTER_FLAG, DEPARTED_FLAG, AUTO_MEDIA_FLAG, MEDIA_CAPTURE_SETTING } from "../constants.mjs";
import { addTimepoint, addLink, getTimepoints, timepointsForRecord } from "../data/timepoints.mjs";
import { matchPlaceForScene, pickLatestTimepoint, pickNewestTimepoint, collapseParticipants, mergeParticipants, summarizeOutcome, appendGalleryImage } from "../logic/auto-capture.mjs";

const PLACE_TYPE = typeId("place");
const MEDIA_TYPE = typeId("media");

/** The auto-created gallery page for a timepoint in this group, or null. */
function findAutoGallery(group, timepointId) {
  return group.pages.find(
    (p) => p.type === MEDIA_TYPE && p.getFlag(MODULE_ID, AUTO_MEDIA_FLAG) === timepointId
  ) ?? null;
}

/**
 * File a GM-shared image/video into the target group's newest-timepoint
 * gallery. Creates a first timepoint on an empty timeline, and creates the
 * gallery (with a single timeline link) the first time media lands on a
 * timepoint; later shares append to that gallery, deduped by src.
 */
async function doCaptureSharedMedia(src, caption) {
  if (!src) return;
  if (!game.settings.get(MODULE_ID, MEDIA_CAPTURE_SETTING)) return;
  const group = getTargetGroup();
  if (!group) return;

  let tp = pickNewestTimepoint(getTimepoints(group));
  if (!tp) tp = await addTimepoint(group, new Date().toLocaleDateString());

  const entry = { id: foundry.utils.randomID(), src, caption: caption ?? "" };
  const gallery = findAutoGallery(group, tp.id);
  if (gallery) {
    const { images, added } = appendGalleryImage(gallery.system.toObject().images, entry);
    if (added) await gallery.update({ "system.images": images });
    return;
  }

  const name = game.i18n.format("CAMPAIGNRECORD.AutoCapture.SharedMediaName", { label: tp.label });
  const [page] = await group.createEmbeddedDocuments("JournalEntryPage", [
    {
      name,
      type: MEDIA_TYPE,
      system: { images: [entry] },
      flags: { [MODULE_ID]: { [AUTO_MEDIA_FLAG]: tp.id } }
    }
  ]);
  await addLink(group, tp.id, { uuid: page.uuid, name: page.name, type: "JournalEntryPage" });
}

// Serializes captures per client so rapid back-to-back shares can't race
// findAutoGallery against a still-pending gallery create for the same
// timepoint (which would otherwise produce duplicate galleries/links).
let captureQueue = Promise.resolve();

/** Queue a shared-media capture so it never overlaps a prior in-flight one. */
export function captureSharedMedia(src, caption) {
  captureQueue = captureQueue
    .then(() => doCaptureSharedMedia(src, caption))
    .catch((err) => console.error("campaign-record | shared-media capture failed", err));
  return captureQueue;
}

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
  const attached = timepointsForRecord(group, place.uuid);
  let timepointId = createTimepoint ? null : pickLatestTimepoint(attached, getTimepoints(group));
  if (!timepointId) {
    const tp = await addTimepoint(group, scene.name);
    await addLink(group, tp.id, { uuid: place.uuid, name: place.name, type: "JournalEntryPage" });
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

  // GM begins combat → create an Encounter and attach it to a timepoint.
  Hooks.on("combatStart", async (combat) => {
    if (game.user !== game.users.activeGM) return;
    const group = getTargetGroup();
    if (!group) return;
    // Foundry v13 creates combats UNLINKED (combat.scene === null) by default;
    // the tracker only links a combat to a scene via an explicit menu toggle.
    // Fall back to the active scene — the scene the map-activation flow keyed
    // the Place/timepoint to. With no scene at all (theater of the mind), file
    // the Encounter onto a fresh dated timepoint instead.
    const scene = combat.scene ?? game.scenes?.active ?? null;
    const combatants = collapseParticipants(combatParticipants(combat));

    let timepointId;
    let name;
    let system;
    if (scene) {
      ({ timepointId } = await ensurePlaceForScene(group, scene, { createTimepoint: false }));
      name = game.i18n.format("CAMPAIGNRECORD.AutoCapture.EncounterName", { scene: scene.name });
      system = { scene: scene.uuid, combatants };
    } else {
      name = game.i18n.format("CAMPAIGNRECORD.AutoCapture.EncounterNameNoScene", {
        date: new Date().toLocaleDateString()
      });
      timepointId = (await addTimepoint(group, name)).id;
      system = { combatants };
    }

    const [encounter] = await group.createEmbeddedDocuments("JournalEntryPage", [
      { name, type: typeId("encounter"), system }
    ]);
    await addLink(group, timepointId, { uuid: encounter.uuid, name: encounter.name, type: "JournalEntryPage" });
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

  // GM shows players an image/video via Foundry's native "Show Players" →
  // file it onto the newest timepoint. shareImage fires no hook and the
  // socket emit doesn't echo to the sender, so wrap the prototype method
  // (the button calls `this.shareImage()` with no args); the sharing GM
  // captures on their own client (single-writer, no relay).
  const ImagePopout = foundry.applications.apps.ImagePopout;
  const originalShareImage = ImagePopout.prototype.shareImage;
  ImagePopout.prototype.shareImage = function (options = {}) {
    const result = originalShareImage.call(this, options);
    if (game.user.isGM) {
      const src = options.image ?? this.options?.src;
      const caption = options.caption || this.options?.caption || options.title || this.options?.window?.title || "";
      captureSharedMedia(src, caption);
    }
    return result;
  };
}
