const { HTMLField, FilePathField, BooleanField, StringField, SetField } = foundry.data.fields;

/** Fields shared by every Campaign Record page type. */
export class BaseRecordModel extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["CAMPAIGNRECORD.Common"];

  static defineSchema() {
    return {
      description: new HTMLField({ textSearch: true }),
      gmNotes: new HTMLField(),
      image: new FilePathField({ categories: ["IMAGE"] }),
      tags: new SetField(new StringField({ blank: false })),
      hidden: new BooleanField({ initial: false }),
      timepoints: new SetField(new StringField({ blank: false }))
    };
  }
}
