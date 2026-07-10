import { hasGroupFlag } from "../logic/visibility.mjs";

/** dnd5e-only enrichment; every helper degrades to null / plain fields elsewhere. */
export function isDnd5e() {
  return game.system?.id === "dnd5e";
}

/**
 * dnd5e themes journal page sheets only when the parent journal's sheet is the
 * system's JournalEntrySheet5e. Campaign groups use GroupHubSheet, so restore
 * the same styling classes for pages inside groups.
 */
export function registerJournalPageStyling() {
  Hooks.on("renderJournalEntryPageSheet", (app, element) => {
    if (!isDnd5e()) return;
    if (!hasGroupFlag(app.document?.parent?.flags)) return;
    element.classList.add("dnd5e2", "dnd5e2-journal", "titlebar", "dialog-lg");
  });
}

/** Price/rarity/type for an Item dropped onto Shop/Item records. */
export function itemDropDetails(item) {
  if (!isDnd5e() || !item?.system) return null;
  const price = item.system.price;
  // dnd5e stores price.value 0 on unpriced items (features, homebrew), so a
  // falsy value deliberately yields a blank price for the GM to fill in.
  const priceText = price?.value ? `${price.value} ${price.denomination ?? "gp"}` : "";
  const rarityKey = item.system.rarity ?? "";
  const rarity = rarityKey ? (CONFIG.DND5E?.itemRarity?.[rarityKey] ?? rarityKey) : "";
  const itemTypeLabel = game.i18n.localize(`TYPES.Item.${item.type}`);
  return { priceText, rarity, itemTypeLabel };
}

/** Portrait + basic stats for a linked actor; name/img only off-5e. */
export function actorSummary(actor) {
  if (!actor) return null;
  const info = { name: actor.name, img: actor.img };
  if (isDnd5e()) {
    const attrs = actor.system?.attributes;
    if (attrs?.ac?.value != null) info.ac = attrs.ac.value;
    if (attrs?.hp) info.hp = `${attrs.hp.value ?? 0}/${attrs.hp.max ?? 0}`;
  }
  return info;
}
