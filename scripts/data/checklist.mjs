import { BaseRecordModel } from "./base-record.mjs";

const { StringField, BooleanField, ArrayField, SchemaField } = foundry.data.fields;

export class ChecklistModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Checklist"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      items: new ArrayField(
        new SchemaField({
          id: new StringField({ required: true, blank: false }),
          text: new StringField(),
          done: new BooleanField({ initial: false }),
          assignee: new StringField()
        })
      )
    };
  }
}
