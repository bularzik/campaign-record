import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const lang = JSON.parse(fs.readFileSync(path.join(ROOT, "lang/en.json"), "utf8"));

function resolve(key) {
  return key.split(".").reduce((node, part) => node?.[part], lang);
}

function filesUnder(dir, ext) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => path.join(e.parentPath ?? e.path, e.name));
}

function extractKeys() {
  const keys = new Set();
  const patterns = [
    /\{\{\s*localize\s+"([^"]+)"/g, // {{localize "KEY"}}
    /data-tooltip="((?:CAMPAIGNRECORD|TYPES)[^"{]+)"/g, // static tooltip keys
    /game\.i18n\.(?:localize|format)\(\s*"([^"]+)"/g, // JS lookups
    /labelPrefix:\s*"([^"]+)"/g, // hub tab labels (suffixed below)
    /(?:title|label):\s*"((?:CAMPAIGNRECORD|TYPES)[^"]+)"/g // AppV2 window titles, sheet labels
  ];
  const files = [...filesUnder(path.join(ROOT, "templates"), ".hbs"), ...filesUnder(path.join(ROOT, "scripts"), ".mjs")];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const re of patterns) {
      for (const m of text.matchAll(re)) keys.add(m[1]);
    }
  }
  return keys;
}

describe("i18n coverage", () => {
  it("every referenced key resolves in lang/en.json", () => {
    const missing = [];
    for (const key of extractKeys()) {
      if (key === "CAMPAIGNRECORD.Hub.Tabs") {
        for (const tab of ["index", "timeline", "search"]) {
          if (typeof resolve(`${key}.${tab}`) !== "string") missing.push(`${key}.${tab}`);
        }
        continue;
      }
      if (typeof resolve(key) !== "string") missing.push(key);
    }
    expect(missing).toEqual([]);
  });

  it("every record type has a TYPES label", () => {
    const constants = fs.readFileSync(path.join(ROOT, "scripts/constants.mjs"), "utf8");
    const types = [...constants.matchAll(/"(\w+)"/g)].map((m) => m[1]);
    const recordTypes = types.filter((t) =>
      ["npc", "place", "quest", "pc", "item", "encounter", "checklist", "shop", "loot", "media"].includes(t)
    );
    expect(recordTypes.length).toBe(10);
    for (const t of recordTypes) {
      expect(typeof lang.TYPES.JournalEntryPage[`campaign-record.${t}`]).toBe("string");
    }
  });
});
