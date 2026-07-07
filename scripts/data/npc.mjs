import { BaseRecordModel } from "./base-record.mjs";

const { StringField, DocumentUUIDField } = foundry.data.fields;

export const NPC_STATUSES = {
  alive: "CAMPAIGNRECORD.Npc.Status.alive",
  dead: "CAMPAIGNRECORD.Npc.Status.dead",
  unknown: "CAMPAIGNRECORD.Npc.Status.unknown"
};

export class NpcModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Npc"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      role: new StringField(),
      location: new StringField(),
      race: new StringField(),
      gender: new StringField(),
      profession: new StringField(),
      voice: new StringField(),
      faction: new StringField(),
      status: new StringField({ required: true, choices: NPC_STATUSES, initial: "unknown" }),
      actor: new DocumentUUIDField({ type: "Actor" })
    };
  }
}
