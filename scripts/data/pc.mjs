import { BaseRecordModel } from "./base-record.mjs";

const { StringField, DocumentUUIDField } = foundry.data.fields;

export class PcModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Pc"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      playerName: new StringField(),
      classLevel: new StringField(),
      faction: new StringField(),
      actor: new DocumentUUIDField({ type: "Actor" })
    };
  }
}
