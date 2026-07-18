import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { computeInlineEdit, createDebouncedSaver, hasActiveEditorFocus } from "../scripts/logic/inline-edit.mjs";
import { shouldShowEditToggle } from "../scripts/logic/inline-edit.mjs";
import { isInlineEditableView } from "../scripts/logic/inline-edit.mjs";
import { isNameEditable } from "../scripts/logic/inline-edit.mjs";

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

  it("still commits a flush after a quiet autosave persisted the same value (regression)", () => {
    // A quiet autosave (e.g. 2s idle pause) must not suppress the committed
    // save that follows on focusout — the auto-link hook only reacts to
    // committed (render:true) saves, so typing a name, pausing, then
    // clicking away must still fire a committed save even though nothing
    // changed since the quiet autosave.
    const save = vi.fn();
    const saver = createDebouncedSaver({ save, delay: 2000 });
    saver.prime("");
    saver.schedule(() => "hello");
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenNthCalledWith(1, "hello", { quiet: true });

    saver.flush(() => "hello");
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(2, "hello", { quiet: false });
  });
});

function root(html) {
  return new JSDOM(`<body><div id="root">${html}</div></body>`).window.document.getElementById("root");
}

describe("hasActiveEditorFocus", () => {
  it("defers for a focused text-page editor NOT wrapped in .inline-edit", () => {
    const r = root('<prose-mirror><div contenteditable="true">x</div></prose-mirror>');
    const active = r.querySelector('[contenteditable="true"]');
    expect(hasActiveEditorFocus(r, active)).toBe(true);
  });
  it("defers for a focused input inside root", () => {
    const r = root('<input name="system.foo">');
    expect(hasActiveEditorFocus(r, r.querySelector("input"))).toBe(true);
  });
  it("does NOT defer for a focused action button", () => {
    const r = root('<button type="button">Add</button>');
    expect(hasActiveEditorFocus(r, r.querySelector("button"))).toBe(false);
  });
  it("does NOT defer when focus is outside root", () => {
    const doc = new JSDOM('<body><div id="root"><input></div><input id="outside"></body>').window.document;
    expect(hasActiveEditorFocus(doc.getElementById("root"), doc.getElementById("outside"))).toBe(false);
  });
  it("is false with no active element", () => {
    expect(hasActiveEditorFocus(root('<input>'), null)).toBe(false);
  });
});

describe("isInlineEditableView", () => {
  const base = { enabled: true, canEdit: true, inGroup: true };
  it("is true for a record type in a hub group with the setting on", () => {
    expect(isInlineEditableView({ ...base, type: "campaign-record.npc" })).toBe(true);
  });
  it("is true for a text page in a hub group with the setting on", () => {
    expect(isInlineEditableView({ ...base, type: "text" })).toBe(true);
  });
  it("is true for an HTML text page (isMarkdown false/default)", () => {
    expect(isInlineEditableView({ ...base, type: "text", isMarkdown: false })).toBe(true);
  });
  it("is false for a markdown-format text page", () => {
    expect(isInlineEditableView({ ...base, type: "text", isMarkdown: true })).toBe(false);
  });
  it("is false when the setting is off", () => {
    expect(isInlineEditableView({ ...base, enabled: false, type: "text" })).toBe(false);
  });
  it("is false when the user cannot edit", () => {
    expect(isInlineEditableView({ ...base, canEdit: false, type: "text" })).toBe(false);
  });
  it("is false outside a hub group", () => {
    expect(isInlineEditableView({ ...base, inGroup: false, type: "text" })).toBe(false);
  });
  it("is false for an unrelated page type", () => {
    expect(isInlineEditableView({ ...base, type: "image" })).toBe(false);
  });
});

describe("isNameEditable", () => {
  it("is editable in an inline-editable view (typed record, inline on)", () => {
    expect(isNameEditable({ canEdit: true, editing: false, inlineEditable: true })).toBe(true);
  });
  it("is editable in manual edit mode (text page / inline off)", () => {
    expect(isNameEditable({ canEdit: true, editing: true, inlineEditable: false })).toBe(true);
  });
  it("is read-only in plain view mode when the view is not inline-editable", () => {
    expect(isNameEditable({ canEdit: true, editing: false, inlineEditable: false })).toBe(false);
  });
  it("is never editable without update permission", () => {
    for (const editing of [true, false]) {
      for (const inlineEditable of [true, false]) {
        expect(isNameEditable({ canEdit: false, editing, inlineEditable })).toBe(false);
      }
    }
  });
});
