/**
 * Prompt for an Actor the current user can see; resolves to its UUID, or
 * null if cancelled. Exists because core gates dragging Actors out of the
 * sidebar on TOKEN_CREATE (Assistant GM by default), so players need a
 * drag-free way to link actors to records.
 */
export async function promptSelectActor() {
  const actors = game.actors
    .filter((a) => a.visible)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!actors.length) {
    ui.notifications.warn(game.i18n.localize("CAMPAIGNRECORD.Warning.NoActorsToLink"));
    return null;
  }
  const options = actors
    .map((a) => `<option value="${a.uuid}">${foundry.utils.escapeHTML(a.name)}</option>`)
    .join("");
  return foundry.applications.api.DialogV2.prompt({
    window: { title: "CAMPAIGNRECORD.LinkActor" },
    content: `
      <div class="form-group">
        <label>${game.i18n.localize("CAMPAIGNRECORD.SelectActor")}</label>
        <select name="actor" autofocus>${options}</select>
      </div>`,
    ok: {
      label: "CAMPAIGNRECORD.Link",
      callback: (event, button) => button.form.elements.actor.value
    },
    rejectClose: false
  });
}
