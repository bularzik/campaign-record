import { registerDataModels } from "./data/registration.mjs";
import { registerUpdateGuards } from "./hooks/guards.mjs";
import { registerDirectoryUI } from "./hooks/directory.mjs";
import { ensureRecordsFolder } from "./data/groups.mjs";

Hooks.once("init", () => {
  console.log("campaign-record | Initializing Campaign Record");
  registerDataModels();
  registerUpdateGuards();
  registerDirectoryUI();
});

Hooks.once("ready", () => {
  if (game.user.isGM) ensureRecordsFolder();
});
