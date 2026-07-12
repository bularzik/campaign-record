import { describe, it, expect } from "vitest";
import { resolveTargetGroup, collapseParticipants, mergeParticipants, matchPlaceForScene, pickLatestTimepoint, summarizeOutcome } from "../scripts/logic/auto-capture.mjs";

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

describe("matchPlaceForScene", () => {
  const places = [{ scene: "Scene.a" }, { scene: "Scene.b" }];
  it("finds the place for a scene", () => {
    expect(matchPlaceForScene(places, "Scene.b")).toBe(places[1]);
  });
  it("returns null when no place matches", () => {
    expect(matchPlaceForScene(places, "Scene.z")).toBe(null);
  });
});

describe("pickLatestTimepoint", () => {
  const tps = [{ id: "t1", sort: 0 }, { id: "t2", sort: 100 }, { id: "t3", sort: 200 }];
  it("returns the highest-sort attached id", () => {
    expect(pickLatestTimepoint(["t1", "t2"], tps)).toBe("t2");
  });
  it("returns null when nothing is attached", () => {
    expect(pickLatestTimepoint([], tps)).toBe(null);
  });
});

describe("summarizeOutcome", () => {
  const labels = { died: "Died", injured: "Injured", fled: "Fled", none: "All combatants unharmed." };
  it("buckets died, injured, and fled with counts", () => {
    const s = summarizeOutcome({
      present: [
        { name: "Goblin", defeated: true, hp: { value: 0, max: 7 } },
        { name: "Goblin", defeated: true, hp: { value: 0, max: 7 } },
        { name: "Aldric", defeated: false, hp: { value: 4, max: 20 } },
        { name: "Thorne", defeated: false, hp: { value: 20, max: 20 } }
      ],
      departed: [{ name: "Bandit", defeated: false }]
    }, labels);
    expect(s).toContain("Died: Goblin ×2");
    expect(s).toContain("Injured: Aldric");
    expect(s).toContain("Fled: Bandit");
    expect(s).not.toContain("Thorne");
  });
  it("skips injuries when HP is unavailable", () => {
    const s = summarizeOutcome({
      present: [{ name: "Ghost", defeated: false, hp: null }],
      departed: []
    }, labels);
    expect(s).toBe(labels.none);
  });
  it("counts a defeated departed combatant as died, not fled", () => {
    const s = summarizeOutcome({
      present: [],
      departed: [{ name: "Orc", defeated: true }]
    }, labels);
    expect(s).toContain("Died: Orc");
    expect(s).not.toContain("Fled");
  });
});
