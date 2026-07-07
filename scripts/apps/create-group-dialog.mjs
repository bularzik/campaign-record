import { createGroup } from "../data/groups.mjs";

/** Prompt for a group name, create the group, and open its sheet. */
export async function promptCreateGroup() {
  const name = await foundry.applications.api.DialogV2.prompt({
    window: { title: "CAMPAIGNRECORD.CreateGroup" },
    content: `
      <div class="form-group">
        <label>${game.i18n.localize("CAMPAIGNRECORD.GroupName")}</label>
        <input type="text" name="name" required autofocus>
      </div>`,
    ok: {
      label: "CAMPAIGNRECORD.Create",
      callback: (event, button) => button.form.elements.name.value.trim()
    },
    rejectClose: false
  });
  if (!name) return null;
  const group = await createGroup(name);
  group.sheet.render(true);
  return group;
}
