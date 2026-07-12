import { describe, it, expect } from "vitest";
import { resolveTargetGroup, collapseParticipants, mergeParticipants } from "../scripts/logic/auto-capture.mjs";

describe("resolveTargetGroup", () => {
  const groups = [{ id: "a" }, { id: "b" }];
  it("returns the matching group", () => {
    expect(resolveTargetGroup("b", groups)).toBe(groups[1]);
  });
  it("returns null for an empty setting", () => {
    expect(resolveTargetGroup("", groups)).toBe(null);
  });
  it("returns null for a stale id", () => {
    expect(resolveTargetGroup("gone", groups)).toBe(null);
  });
});

describe("collapseParticipants", () => {
  it("groups combatants sharing an actor into a count", () => {
    const rows = collapseParticipants([
      { actorUuid: "Actor.gob", name: "Goblin" },
      { actorUuid: "Actor.gob", name: "Goblin" },
      { actorUuid: "Actor.pc", name: "Aldric" }
    ]);
    expect(rows).toContainEqual({ id: "Actor.gob", name: "Goblin", count: 2, actor: "Actor.gob" });
    expect(rows).toContainEqual({ id: "Actor.pc", name: "Aldric", count: 1, actor: "Actor.pc" });
  });
  it("groups actor-less combatants by name with a null actor", () => {
    const rows = collapseParticipants([
      { actorUuid: null, name: "Mook" },
      { actorUuid: null, name: "Mook" }
    ]);
    expect(rows).toEqual([{ id: "name:Mook", name: "Mook", count: 2, actor: null }]);
  });
});

describe("mergeParticipants", () => {
  it("takes the element-wise max per id and unions new entries", () => {
    const existing = [{ id: "Actor.gob", name: "Goblin", count: 3, actor: "Actor.gob" }];
    const incoming = [
      { id: "Actor.gob", name: "Goblin", count: 1, actor: "Actor.gob" },
      { id: "Actor.orc", name: "Orc", count: 2, actor: "Actor.orc" }
    ];
    const merged = mergeParticipants(existing, incoming);
    expect(merged).toContainEqual({ id: "Actor.gob", name: "Goblin", count: 3, actor: "Actor.gob" });
    expect(merged).toContainEqual({ id: "Actor.orc", name: "Orc", count: 2, actor: "Actor.orc" });
  });
  it("applies max in reverse: incoming larger wins, and unmatched existing survives", () => {
    const existing = [
      { id: "Actor.gob", name: "Goblin", count: 2, actor: "Actor.gob" },
      { id: "Actor.elf", name: "Elf", count: 4, actor: "Actor.elf" }
    ];
    const incoming = [
      { id: "Actor.gob", name: "Goblin", count: 5, actor: "Actor.gob" }
    ];
    const merged = mergeParticipants(existing, incoming);
    expect(merged).toContainEqual({ id: "Actor.gob", name: "Goblin", count: 5, actor: "Actor.gob" });
    expect(merged).toContainEqual({ id: "Actor.elf", name: "Elf", count: 4, actor: "Actor.elf" });
  });
});
