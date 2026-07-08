/** dnd5e-only enrichment; every helper degrades to null / plain fields elsewhere. */
export function isDnd5e() {
  return game.system?.id === "dnd5e";
}

/** Price/rarity/type for an Item dropped onto Shop/Item records. */
export function itemDropDetails(item) {
  if (!isDnd5e() || !item?.system) return null;
  const price = item.system.price;
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
