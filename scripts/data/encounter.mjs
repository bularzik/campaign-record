import { BaseRecordModel } from "./base-record.mjs";

const { StringField, NumberField, ArrayField, SchemaField, DocumentUUIDField } =
  foundry.data.fields;

export class EncounterModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Encounter"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      location: new StringField(),
      difficulty: new StringField(),
      outcome: new StringField(),
      combatants: new ArrayField(
        new SchemaField({
          id: new StringField({ required: true, blank: false }),
          name: new StringField(),
          count: new NumberField({ required: true, integer: true, min: 1, initial: 1 }),
          actor: new DocumentUUIDField({ type: "Actor" })
        })
      ),
      scene: new DocumentUUIDField({ type: "Scene" })
    };
  }
}
