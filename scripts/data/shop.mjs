import { BaseRecordModel } from "./base-record.mjs";

const { StringField, NumberField, ArrayField, SchemaField, DocumentUUIDField } =
  foundry.data.fields;

export class ShopModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Shop"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      shopType: new StringField(),
      location: new StringField(),
      owner: new StringField(),
      inventory: new ArrayField(
        new SchemaField({
          id: new StringField({ required: true, blank: false }),
          name: new StringField(),
          price: new StringField(),
          quantity: new NumberField({ required: true, integer: true, min: 0, initial: 1 }),
          item: new DocumentUUIDField({ type: "Item" })
        })
      )
    };
  }
}
