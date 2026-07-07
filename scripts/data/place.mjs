import { BaseRecordModel } from "./base-record.mjs";

const { StringField, DocumentUUIDField } = foundry.data.fields;

export const PLACE_TYPES = {
  town: "CAMPAIGNRECORD.Place.Type.town",
  region: "CAMPAIGNRECORD.Place.Type.region",
  poi: "CAMPAIGNRECORD.Place.Type.poi",
  feature: "CAMPAIGNRECORD.Place.Type.feature"
};

export class PlaceModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Place"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      location: new StringField(),
      government: new StringField(),
      size: new StringField(),
      placeType: new StringField({ required: true, choices: PLACE_TYPES, initial: "poi" }),
      scene: new DocumentUUIDField({ type: "Scene" })
    };
  }
}
