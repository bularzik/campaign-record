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
 * Should the hub treat the viewed page as inline-editable (drives whether the
 * pane shows an always-open editor vs. a view + edit-toggle)? Records and plain
 * text/journal pages both qualify; both are protected from mid-edit teardown.
 * A markdown-format text page is the exception: it falls back to core's own
 * editor (see RecordPane.mount), so it is never inline-editable here either.
 */
export function isInlineEditableView({ enabled, canEdit, type, inGroup, isMarkdown = false }) {
  if (!(enabled && canEdit && inGroup)) return false;
  if (type === "text") return !isMarkdown;
  return typeof type === "string" && type.startsWith("campaign-record.");
}

/**
 * Should the pane header render the record name as an always-open input?
 * True exactly when the rest of the entry is editable: the user can update the
 * page AND either the view is inline-editable or manual edit mode is active.
 */
export function isNameEditable({ canEdit, editing, inlineEditable }) {
  return Boolean(canEdit && (inlineEditable || editing));
}

/**
 * Debounced field saver. schedule() saves quietly (render suppressed) after
 * `delay` ms of inactivity; flush() saves immediately with a normal render.
 * schedule() skips a value identical to the last save of either kind, but
 * flush() dedups only against the last COMMITTED (non-quiet) save — so a
 * quiet autosave never suppresses the committed save that follows it (e.g.
 * on focusout), which is what lets passive viewers/hooks that only react to
 * committed saves catch up.
 */
export function createDebouncedSaver({ save, delay = 2000 }) {
  let timer = null;
  let lastValue = null; // last value persisted by ANY save (quiet or committed)
  let lastCommitted = null; // last value persisted by a COMMITTED (rendered) save
  const doSave = (value, quiet) => {
    lastValue = value;
    if (!quiet) lastCommitted = value;
    save(value, { quiet });
  };
  return {
    /** Record the persisted value so unchanged content never saves. */
    prime(value) {
      lastValue = value;
      lastCommitted = value;
    },
    schedule(getValue) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const value = getValue();
        if (value === lastValue) return;
        doSave(value, true);
      }, delay);
    },
    flush(getValue) {
      if (timer) clearTimeout(timer);
      timer = null;
      const value = getValue();
      if (value === lastCommitted) return;
      doSave(value, false);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    }
  };
}

/**
 * Is the user focused on a typing-style control inside `root`? Render guards
 * defer re-renders while this is true so auto-saves / external updates don't
 * destroy the control being typed in. Matches inputs, selects, textareas,
 * anything within a prose-mirror editor, and contenteditable — anywhere in
 * root (record inline views AND core text-page editors). A focused action
 * button is none of these, so it still does not suppress the re-render that
 * shows its own structural result.
 */
export function hasActiveEditorFocus(root, active = document.activeElement) {
  if (!root || !active || !root.contains(active)) return false;
  return (
    !!active.matches?.("input, select, textarea") ||
    !!active.closest?.("prose-mirror") ||
    active.isContentEditable === true
  );
}
