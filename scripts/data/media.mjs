import { BaseRecordModel } from "./base-record.mjs";

const { StringField, NumberField, FilePathField, ArrayField, SchemaField } = foundry.data.fields;

export class MediaModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Media"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      images: new ArrayField(
        new SchemaField({
          id: new StringField({ required: true, blank: false }),
          src: new FilePathField({ categories: ["IMAGE"] }),
          caption: new StringField()
        })
      ),
      slideshowInterval: new NumberField({ required: true, integer: true, min: 0, initial: 0 })
    };
  }
}
