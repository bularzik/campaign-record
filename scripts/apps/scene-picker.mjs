/**
 * Prompt for a Scene the current user can see; resolves to its UUID, or
 * null if cancelled. Exists because core gates dragging Scenes out of the
 * sidebar to GMs, so players need a drag-free way to link scenes to records.
 */
export async function promptSelectScene() {
  const scenes = game.scenes
    .filter((s) => s.visible)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!scenes.length) {
    ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Warning.NoScenesToLink"));
    return null;
  }
  const options = scenes
    .map((s) => `<option value="${s.uuid}">${foundry.utils.escapeHTML(s.name)}</option>`)
    .join("");
  return foundry.applications.api.DialogV2.prompt({
    window: { title: "CAMPAIGNRECORD.LinkScene" },
    content: `
      <div class="form-group">
        <label>${game.i18n.localize("CAMPAIGNRECORD.SelectScene")}</label>
        <select name="scene" autofocus>${options}</select>
      </div>`,
    ok: {
      label: "CAMPAIGNRECORD.Link",
      callback: (event, button) => button.form.elements.scene.value
    },
    rejectClose: false
  });
}
