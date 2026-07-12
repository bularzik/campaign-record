import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeInlineEdit, createDebouncedSaver, hasInlineFocus } from "../scripts/logic/inline-edit.mjs";
import { shouldShowEditToggle } from "../scripts/logic/inline-edit.mjs";

describe("shouldShowEditToggle", () => {
  it("hides the toggle for an inline-editable typed entry in view mode", () => {
    expect(shouldShowEditToggle({ canEdit: true, inViewMode: true, inlineEditableView: true })).toBe(false);
  });
  it("shows the toggle when the view is not inline-editable (text page / inline off)", () => {
    expect(shouldShowEditToggle({ canEdit: true, inViewMode: true, inlineEditableView: false })).toBe(true);
  });
  it("shows the toggle while in edit mode so the user can return to view", () => {
    expect(shouldShowEditToggle({ canEdit: true, inViewMode: false, inlineEditableView: true })).toBe(true);
  });
  it("never shows the toggle without update permission", () => {
    expect(shouldShowEditToggle({ canEdit: false, inViewMode: true, inlineEditableView: false })).toBe(false);
  });
});

describe("computeInlineEdit", () => {
  it("is true only when enabled, permitted, in view mode, and inside a group journal", () => {
    for (const enabled of [true, false]) {
      for (const canUpdate of [true, false]) {
        for (const isView of [true, false]) {
          for (const inGroup of [true, false]) {
            expect(computeInlineEdit({ enabled, canUpdate, isView, inGroup })).toBe(
              enabled && canUpdate && isView && inGroup
            );
          }
        }
      }
    }
  });

  it("stays off for a record page added to an ordinary journal (no group sheet)", () => {
    expect(
      computeInlineEdit({ enabled: true, canUpdate: true, isView: true, inGroup: false })
    ).toBe(false);
    // parent?.getFlag() on a mismatch yields undefined at the call site
    expect(
      computeInlineEdit({ enabled: true, canUpdate: true, isView: true, inGroup: undefined })
    ).toBe(false);
  });

  it("returns a boolean even for truthy/falsy non-boolean inputs", () => {
    expect(computeInlineEdit({ enabled: 1, canUpdate: "yes", isView: {}, inGroup: [] })).toBe(
      true
    );
    expect(
      computeInlineEdit({ enabled: undefined, canUpdate: true, isView: true, inGroup: true })
    ).toBe(false);
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

describe("hasInlineFocus", () => {
  // Minimal stub elements implementing only the DOM surface hasInlineFocus
  // touches: contains() on the root, and closest()/matches()/
  // isContentEditable on the active element.
  const makeRoot = ({ containsActive = true } = {}) => ({
    contains: () => containsActive
  });

  const makeActive = ({
    inSection = true,
    isTyping = false,
    inProseMirror = false,
    contentEditable = false
  } = {}) => ({
    matches: (selector) => (isTyping ? selector === "input, select, textarea" : false),
    closest: (selector) => {
      if (selector === ".campaign-record-content.inline-edit") return inSection ? {} : null;
      if (selector === "prose-mirror") return inProseMirror ? {} : null;
      return null;
    },
    isContentEditable: contentEditable
  });

  it("returns false when root is null", () => {
    const active = makeActive({ isTyping: true });
    expect(hasInlineFocus(null, active)).toBe(false);
  });

  it("returns false when active is null", () => {
    const root = makeRoot();
    expect(hasInlineFocus(root, null)).toBe(false);
  });

  it("returns false when the active element is outside root", () => {
    const root = makeRoot({ containsActive: false });
    const active = makeActive({ isTyping: true });
    expect(hasInlineFocus(root, active)).toBe(false);
  });

  it("returns true for a typing control (input/select/textarea) inside an inline-edit section", () => {
    const root = makeRoot();
    const active = makeActive({ inSection: true, isTyping: true });
    expect(hasInlineFocus(root, active)).toBe(true);
  });

  it("returns false for a structural button inside the section", () => {
    const root = makeRoot();
    const active = makeActive({ inSection: true, isTyping: false });
    expect(hasInlineFocus(root, active)).toBe(false);
  });

  it("returns true for an element inside a prose-mirror editor", () => {
    const root = makeRoot();
    const active = makeActive({ inSection: true, isTyping: false, inProseMirror: true });
    expect(hasInlineFocus(root, active)).toBe(true);
  });

  it("returns true for a contenteditable element", () => {
    const root = makeRoot();
    const active = makeActive({ inSection: true, isTyping: false, contentEditable: true });
    expect(hasInlineFocus(root, active)).toBe(true);
  });

  it("returns false for a typing control that is not inside an inline-edit section", () => {
    const root = makeRoot();
    const active = makeActive({ inSection: false, isTyping: true });
    expect(hasInlineFocus(root, active)).toBe(false);
  });
});
