import { BaseRecordModel } from "./base-record.mjs";

const { StringField, NumberField, HTMLField, ArrayField, SchemaField, DocumentUUIDField } =
  foundry.data.fields;

const coin = () => new NumberField({ required: true, integer: true, min: 0, initial: 0 });

export class LootModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Loot"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      currency: new SchemaField({ cp: coin(), sp: coin(), ep: coin(), gp: coin(), pp: coin() }),
      items: new ArrayField(
        new SchemaField({
          id: new StringField({ required: true, blank: false }),
          name: new StringField(),
          quantity: new NumberField({ required: true, integer: true, min: 0, initial: 1 }),
          item: new DocumentUUIDField({ type: "Item" })
        })
      ),
      source: new DocumentUUIDField({ type: "JournalEntryPage" }),
      distribution: new HTMLField()
    };
  }
}
