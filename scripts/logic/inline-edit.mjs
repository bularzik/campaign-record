/** Pure decision + debounce plumbing for inline-editable record views. */

/** Should a record sheet render its view as inline-editable? */
export function computeInlineEdit({ enabled, canUpdate, isView }) {
  return Boolean(enabled && canUpdate && isView);
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
 * Is the user focused inside an inline-editable section of `root`?
 * Render guards defer re-renders while this is true so auto-saves don't
 * destroy the control being typed in.
 */
export function hasInlineFocus(root, active = document.activeElement) {
  return (
    !!root &&
    !!active &&
    root.contains(active) &&
    !!active.closest(".campaign-record-content.inline-edit")
  );
}
