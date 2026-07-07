import { BaseRecordModel } from "./base-record.mjs";

const { StringField, HTMLField, BooleanField, ArrayField, SchemaField, DocumentUUIDField } =
  foundry.data.fields;

export const QUEST_STATUSES = {
  available: "CAMPAIGNRECORD.Quest.Status.available",
  active: "CAMPAIGNRECORD.Quest.Status.active",
  completed: "CAMPAIGNRECORD.Quest.Status.completed",
  failed: "CAMPAIGNRECORD.Quest.Status.failed",
  abandoned: "CAMPAIGNRECORD.Quest.Status.abandoned"
};

export class QuestModel extends BaseRecordModel {
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "CAMPAIGNRECORD.Quest"];

  static defineSchema() {
    return {
      ...super.defineSchema(),
      source: new StringField(),
      status: new StringField({ required: true, choices: QUEST_STATUSES, initial: "available" }),
      objectives: new ArrayField(
        new SchemaField({
          id: new StringField({ required: true, blank: false }),
          text: new StringField(),
          done: new BooleanField({ initial: false }),
          gmOnly: new BooleanField({ initial: false })
        })
      ),
      rewards: new HTMLField(),
      parentQuest: new DocumentUUIDField({ type: "JournalEntryPage" })
    };
  }
}
