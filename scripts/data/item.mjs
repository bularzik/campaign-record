import { BaseRecordModel } from "./base-record.mjs";

const { StringField, DocumentUUIDField } = foundry.data.fields;

export class ItemRecordModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Item"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      itemType: new StringField(),
      rarity: new StringField(),
      attunement: new StringField(),
      item: new DocumentUUIDField({ type: "Item" })
    };
  }
}
