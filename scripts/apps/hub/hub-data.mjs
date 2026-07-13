import { MODULE_ID, recordIcon } from "../../constants.mjs";
import { getGroups } from "../../data/groups.mjs";
import { isRecordVisible } from "../../logic/visibility.mjs";

const TYPE_PREFIX = `${MODULE_ID}.`;

/** Pages the Hub indexes: module record types plus core text pages. */
export function isIndexablePage(page) {
  return page.type.startsWith(TYPE_PREFIX) || page.type === "text";
}

export function getScopedGroups(groupId) {
  const groups = getGroups();
  return groupId === "all" ? groups : groups.filter((g) => g.id === groupId);
}

/** One-line summary shown under a record's name in the index. */
export function recordSubtitle(page) {
  const s = page.system ?? {};
  switch (page.type) {
    case `${TYPE_PREFIX}npc`:
      return [s.role, s.faction].filter(Boolean).join(" — ");
    case `${TYPE_PREFIX}place`:
      return s.placeType ? game.i18n.localize(`CAMPAIGNRECORD.Place.Type.${s.placeType}`) : "";
    case `${TYPE_PREFIX}quest`:
      return s.status ? game.i18n.localize(`CAMPAIGNRECORD.Quest.Status.${s.status}`) : "";
    case `${TYPE_PREFIX}pc`:
      return [s.playerName, s.classLevel].filter(Boolean).join(" — ");
    case `${TYPE_PREFIX}item`:
      return [s.itemType, s.rarity].filter(Boolean).join(" — ");
    case `${TYPE_PREFIX}encounter`:
      return [s.difficulty, s.location].filter(Boolean).join(" — ");
    case `${TYPE_PREFIX}checklist`: {
      const items = s.items ?? [];
      return game.i18n.format("CAMPAIGNRECORD.Checklist.Progress", {
        done: items.filter((i) => i.done).length,
        total: items.length
      });
    }
    case `${TYPE_PREFIX}shop`:
      return [s.shopType, s.location].filter(Boolean).join(" — ");
    case `${TYPE_PREFIX}loot`:
      return game.i18n.format("CAMPAIGNRECORD.Loot.ItemCount", { count: (s.items ?? []).length });
    case `${TYPE_PREFIX}media`:
      return game.i18n.format("CAMPAIGNRECORD.Media.ImageCount", { count: (s.images ?? []).length });
    default:
      return "";
  }
}

function toIndexEntry(group, page) {
  const shortType = page.type.startsWith(TYPE_PREFIX) ? page.type.slice(TYPE_PREFIX.length) : "journal";
  const typeLabel = page.type === "text"
    ? game.i18n.localize("CAMPAIGNRECORD.Hub.JournalPage")
    : game.i18n.localize(`TYPES.JournalEntryPage.${page.type}`);
  return {
    uuid: page.uuid,
    id: page.id,
    groupId: group.id,
    groupName: group.name,
    name: page.name,
    type: page.type,
    shortType,
    icon: recordIcon(shortType),
    typeLabel,
    image: page.system?.image || null,
    tags: [...(page.system?.tags ?? [])],
    subtitle: recordSubtitle(page),
    hidden: page.system?.hidden === true,
    sortTime: page._stats?.modifiedTime ?? 0
  };
}

/** Visible records across the scoped groups for a user. */
export function collectRecords({ groupId = "all", user }) {
  const records = [];
  for (const group of getScopedGroups(groupId)) {
    for (const page of group.pages) {
      if (!isIndexablePage(page)) continue;
      if (!isRecordVisible(user, page)) continue;
      records.push(toIndexEntry(group, page));
    }
  }
  return records;
}

/** Convert a page into the search-index record shape. */
export function toSearchRecord(page) {
  const fields = {};
  const gmFields = {};
  let tags = [];
  if (page.type === "text") {
    fields.text = page.text?.content ?? "";
  } else {
    const s = page.system.toObject();
    const schemaFields = page.system.schema.fields;
    tags = s.tags ?? [];
    for (const [key, value] of Object.entries(s)) {
      // UUID links are noise tokens, not content.
      if (schemaFields[key] instanceof foundry.data.fields.DocumentUUIDField) continue;
      if (typeof value !== "string" || !value || key === "image") continue;
      if (key === "gmNotes") gmFields[key] = value;
      else fields[key] = value;
    }
    // Rows of list fields (combatants, inventory, checklist items, loot items,
    // media captions) contribute their text-ish props under the field's key.
    // Rows are expected to be objects; an ArrayField of primitive strings
    // would yield no text here and be silently unsearchable — add a mapper
    // if such a field ever ships.
    for (const [key, value] of Object.entries(s)) {
      if (key === "tags" || key === "timepoints" || key === "objectives") continue;
      if (!Array.isArray(value)) continue;
      const text = value
        .map((row) =>
          [row?.name, row?.text, row?.caption, row?.price]
            .filter((v) => typeof v === "string" && v)
            .join(" ")
        )
        .filter(Boolean)
        .join(" ");
      if (text) fields[key] = text;
    }
    if (Array.isArray(s.objectives)) {
      const open = s.objectives.filter((o) => !o.gmOnly).map((o) => o.text).join(" ");
      const gm = s.objectives.filter((o) => o.gmOnly).map((o) => o.text).join(" ");
      if (open) fields.objectives = open;
      if (gm) gmFields.gmObjectives = gm;
    }
  }
  return { uuid: page.uuid, name: page.name, type: page.type, tags, fields, gmFields };
}
