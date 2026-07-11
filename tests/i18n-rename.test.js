import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const lang = JSON.parse(fs.readFileSync(path.join(ROOT, "lang/en.json"), "utf8"));

function resolve(key) {
  return key.split(".").reduce((node, part) => node?.[part], lang);
}

function allStringValues(node, out = []) {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object") for (const v of Object.values(node)) allStringValues(v, out);
  return out;
}

describe("i18n rename: Campaign Group -> Campaign Record", () => {
  // Container term renamed everywhere.
  const containerExpectations = {
    "CAMPAIGNRECORD.CreateGroup": "Create Campaign Record",
    "CAMPAIGNRECORD.GroupName": "Campaign Record Name",
    "CAMPAIGNRECORD.Hub.GroupPicker": "Campaign Record",
    "CAMPAIGNRECORD.Hub.AllGroups": "All Campaign Records",
    "CAMPAIGNRECORD.Hub.NoGroups": "Create a Campaign Record first.",
    "CAMPAIGNRECORD.Hub.WrongGroup":
      "Entries can only attach to timepoints in their own Campaign Record.",
    "CAMPAIGNRECORD.Hub.CannotEditTimeline":
      "You lack permission to edit this Campaign Record's timeline.",
    "CAMPAIGNRECORD.Import.NewGroup": "New Campaign Record…",
    "CAMPAIGNRECORD.Import.GroupName": "Campaign Record name",
    "CAMPAIGNRECORD.Export.GroupButton": "Export Campaign Record",
    "CAMPAIGNRECORD.Export.SelectGroup": "Select a specific Campaign Record to export.",
    "CAMPAIGNRECORD.Sheets.GroupHub": "Campaign Hub (Campaign Record Sheet)",
    "CAMPAIGNRECORD.Warning.CreateGroupFailed":
      "Failed to create the Campaign Record. See the console for details."
  };

  // Page term renamed to entry/entries.
  const pageExpectations = {
    "CAMPAIGNRECORD.Hub.NewRecord": "New Entry",
    "CAMPAIGNRECORD.Hub.NoRecords": "No entries match the current filters.",
    "CAMPAIGNRECORD.Hub.HiddenOnly": "Show hidden entries only",
    "CAMPAIGNRECORD.Hub.SearchPlaceholder": "Search all entries…",
    "CAMPAIGNRECORD.Hub.NoResults": "No entries match.",
    "CAMPAIGNRECORD.Hub.EditRecord": "Edit entry",
    "CAMPAIGNRECORD.Hub.RecordUnavailable": "That entry can no longer be displayed.",
    "CAMPAIGNRECORD.Hub.DeleteTimepointConfirmNamed":
      'Delete the timepoint "{label}"? Attached entries stay; only the timepoint is removed.',
    "CAMPAIGNRECORD.Export.IncludeGM": "Include GM content (hidden entries, GM notes)",
    "CAMPAIGNRECORD.Export.HiddenRecord":
      'This entry is hidden — check "Include GM content" to export it.',
    "CAMPAIGNRECORD.Import.Created":
      'Imported {pages} entries and {timepoints} timepoints into "{group}".',
    "CAMPAIGNRECORD.Settings.InlineEditing.Hint":
      "Edit entries directly while viewing them; changes save automatically. Turn off for read-only views.",
    "CAMPAIGNRECORD.Warning.HiddenGMOnly": "Only a Gamemaster can hide or reveal entries.",
    "CAMPAIGNRECORD.Presenter.NoImages": "This media entry has no images to present."
  };

  for (const [key, value] of Object.entries({ ...containerExpectations, ...pageExpectations })) {
    it(`${key} is renamed`, () => {
      expect(resolve(key)).toBe(value);
    });
  }

  it("SchemaNewer warning uses 'Entries are read-only'", () => {
    expect(resolve("CAMPAIGNRECORD.Warning.SchemaNewer")).toContain("Entries are read-only");
  });

  it("no user-facing value still says 'Campaign Group'", () => {
    const offenders = allStringValues(lang).filter((s) => /campaign group/i.test(s));
    expect(offenders).toEqual([]);
  });

  it("intentional module-name strings are left intact", () => {
    expect(resolve("CAMPAIGNRECORD.RecordsFolder")).toBe("Campaign Records");
    expect(resolve("CAMPAIGNRECORD.Sheets.Npc")).toBe("Campaign Record NPC Sheet");
    expect(resolve("CAMPAIGNRECORD.ModuleName")).toBe("Campaign Record");
  });

  it("no user-facing value uses the page term 'record'", () => {
    // Strip the intended module/container name first, then any remaining
    // standalone "record"/"records" is an un-renamed page-sense string.
    const offenders = allStringValues(lang).filter((s) =>
      /\brecords?\b/i.test(s.replace(/campaign record/gi, ""))
    );
    expect(offenders).toEqual([]);
  });

  it("ToggleRail and DropEncounterHint use the entry term", () => {
    expect(resolve("CAMPAIGNRECORD.Hub.ToggleRail")).toBe("Toggle entry list");
    expect(resolve("CAMPAIGNRECORD.Loot.DropEncounterHint")).toBe(
      "Drop an Encounter entry here to link it."
    );
  });
});

describe("rename: docs and manifest", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  it("module.json title and id are unchanged", () => {
    expect(manifest.title).toBe("Campaign Record");
    expect(manifest.id).toBe("campaign-record");
  });

  it("module.json description uses the new terms", () => {
    expect(manifest.description).toContain("typed entries");
    expect(manifest.description).toContain("organized into Campaign Records");
    expect(manifest.description).not.toContain("typed records");
    expect(manifest.description).not.toContain("into groups");
  });

  it("README no longer says 'Campaign Group'", () => {
    expect(/campaign group/i.test(readme)).toBe(false);
    expect(readme).toContain("Campaign Record");
  });
});
