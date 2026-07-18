import { describe, it, expect } from "vitest";
import { createSerialQueue } from "../scripts/logic/mount-queue.mjs";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createSerialQueue", () => {
  it("runs tasks strictly one at a time, in order", async () => {
    const q = createSerialQueue();
    const log = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const a = q.run(async () => { log.push("a:start"); await gate; log.push("a:end"); },
      { supersede: false });
    const b = q.run(async () => { log.push("b"); }, { supersede: false });
    await tick();
    expect(log).toEqual(["a:start"]); // b waits for a
    release();
    await Promise.all([a, b]);
    expect(log).toEqual(["a:start", "a:end", "b"]);
  });
  it("skips a superseded task when a newer one was submitted", async () => {
    const q = createSerialQueue();
    const log = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const a = q.run(async () => { await gate; log.push("a"); }, { supersede: false });
    const b = q.run(async () => { log.push("b"); });          // superseded by c
    const c = q.run(async () => { log.push("c"); });
    release();
    expect(await b).toBeUndefined();
    await Promise.all([a, c]);
    expect(log).toEqual(["a", "c"]);
  });
  it("a supersede:false task always runs, and later tasks still run after it", async () => {
    const q = createSerialQueue();
    const log = [];
    const m = q.run(async () => { log.push("mount"); });
    const cl = q.run(async () => { log.push("close"); }, { supersede: false });
    await Promise.all([m, cl]);
    // close (newer) superseded the queued mount and still ran itself
    expect(log).toEqual(["close"]);
  });
  it("propagates errors to the caller without wedging the chain", async () => {
    const q = createSerialQueue();
    await expect(q.run(async () => { throw new Error("boom"); }, { supersede: false }))
      .rejects.toThrow("boom");
    const after = await q.run(async () => "ok", { supersede: false });
    expect(after).toBe("ok");
  });
});
