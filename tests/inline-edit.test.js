import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeInlineEdit, createDebouncedSaver } from "../scripts/logic/inline-edit.mjs";

describe("computeInlineEdit", () => {
  it("is true only when enabled, permitted, and in view mode", () => {
    for (const enabled of [true, false]) {
      for (const canUpdate of [true, false]) {
        for (const isView of [true, false]) {
          expect(computeInlineEdit({ enabled, canUpdate, isView })).toBe(
            enabled && canUpdate && isView
          );
        }
      }
    }
  });

  it("returns a boolean even for truthy/falsy non-boolean inputs", () => {
    expect(computeInlineEdit({ enabled: 1, canUpdate: "yes", isView: {} })).toBe(true);
    expect(computeInlineEdit({ enabled: undefined, canUpdate: true, isView: true })).toBe(false);
  });
});

describe("createDebouncedSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("schedule saves quietly after the delay, once per idle period", () => {
    const save = vi.fn();
    const saver = createDebouncedSaver({ save, delay: 2000 });
    saver.schedule(() => "<p>a</p>");
    saver.schedule(() => "<p>ab</p>");
    vi.advanceTimersByTime(1999);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("<p>ab</p>", { quiet: true });
  });

  it("flush saves immediately, not quietly, and cancels the pending timer", () => {
    const save = vi.fn();
    const saver = createDebouncedSaver({ save, delay: 2000 });
    saver.schedule(() => "<p>a</p>");
    saver.flush(() => "<p>a</p>");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("<p>a</p>", { quiet: false });
    vi.advanceTimersByTime(5000);
    expect(save).toHaveBeenCalledTimes(1); // timer was cancelled
  });

  it("skips saves when the value has not changed since the last save", () => {
    const save = vi.fn();
    const saver = createDebouncedSaver({ save, delay: 2000 });
    saver.prime("<p>initial</p>");
    saver.flush(() => "<p>initial</p>");
    expect(save).not.toHaveBeenCalled();
    saver.schedule(() => "<p>changed</p>");
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledTimes(1);
    saver.schedule(() => "<p>changed</p>");
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledTimes(1); // same value, no second save
  });

  it("cancel drops a pending save without firing it", () => {
    const save = vi.fn();
    const saver = createDebouncedSaver({ save, delay: 2000 });
    saver.schedule(() => "<p>a</p>");
    saver.cancel();
    vi.advanceTimersByTime(5000);
    expect(save).not.toHaveBeenCalled();
  });
});
