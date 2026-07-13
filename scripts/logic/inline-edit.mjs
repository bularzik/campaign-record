/** Pure decision + debounce plumbing for inline-editable record views. */

/**
 * Should a record sheet render its view as inline-editable?
 * `inGroup` — the page lives in a journal pinned to the module's GroupHubSheet.
 * Record pages are world-registered, so they can be added to any ordinary
 * journal; only the hub sheets suppress implicit form submits and defer
 * re-renders while an inline control has focus, so inline editing must stay
 * off everywhere else.
 */
export function computeInlineEdit({ enabled, canUpdate, isView, inGroup }) {
  return Boolean(enabled && canUpdate && isView && inGroup);
}

/**
 * Should the pane header show the manual edit-toggle for the viewed record?
 * Hidden only when the view is already inline-editable (a typed entry, inline
 * editing on) and we are in view mode — there is nothing to switch to. Kept for
 * text pages, inline-off, no inline path, and while in edit mode (as the
 * "done editing" affordance). Requires update permission in every case.
 */
export function shouldShowEditToggle({ canEdit, inViewMode, inlineEditableView }) {
  if (!canEdit) return false;
  return !(inViewMode && inlineEditableView);
}

/**
 * Debounced field saver. schedule() saves quietly (render suppressed) after
 * `delay` ms of inactivity; flush() saves immediately with a normal render.
 * A value identical to the last saved one is skipped.
 */
export function createDebouncedSaver({ save, delay = 2000 }) {
  let timer = null;
  let lastValue = null;
  const commit = (value, quiet) => {
    if (value === lastValue) return;
    lastValue = value;
    save(value, { quiet });
  };
  return {
    /** Record the persisted value so unchanged content never saves. */
    prime(value) {
      lastValue = value;
    },
    schedule(getValue) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        commit(getValue(), true);
      }, delay);
    },
    flush(getValue) {
      if (timer) clearTimeout(timer);
      timer = null;
      commit(getValue(), false);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    }
  };
}

/**
 * Is the user focused on an editable control inside an inline-editable
 * section of `root`? Render guards defer re-renders while this is true so
 * auto-saves don't destroy the control being typed in. Only typing-style
 * controls (inputs, selects, textareas, anything within a prose-mirror
 * editor) count — a focused action button (add/delete row, toggle) must not
 * suppress the re-render that shows its own structural result.
 */
export function hasInlineFocus(root, active = document.activeElement) {
  if (!root || !active || !root.contains(active)) return false;
  if (!active.closest(".campaign-record-content.inline-edit")) return false;
  return (
    !!active.matches?.("input, select, textarea") ||
    !!active.closest("prose-mirror") ||
    active.isContentEditable === true
  );
}

/**
 * Like hasInlineFocus, but for ANY editable control in `root` — not only the
 * inline-edit view. The hub uses this to defer pane re-renders while the user
 * is editing a mounted record in any mode (inline view, the edit sheet, or a
 * core text/journal page), so a remote update or auto-save doesn't tear the
 * active editor out from under the caret.
 */
export function hasEditableFocus(root, active = document.activeElement) {
  if (!root || !active || !root.contains(active)) return false;
  return (
    !!active.matches?.("input, select, textarea") ||
    !!active.closest("prose-mirror") ||
    active.isContentEditable === true
  );
}
