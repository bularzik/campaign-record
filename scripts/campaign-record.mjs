import "./testing/quench.mjs";
import { registerDataModels } from "./data/registration.mjs";
import { registerUpdateGuards } from "./hooks/guards.mjs";
import { registerDirectoryUI } from "./hooks/directory.mjs";
import { ensureRecordsFolder } from "./data/groups.mjs";
import { registerSheets, registerPartials } from "./sheets/registration.mjs";

Hooks.once("init", () => {
  console.log("campaign-record | Initializing Campaign Record");
  registerDataModels();
  registerSheets();
  registerPartials();
  registerUpdateGuards();
  registerDirectoryUI();
});

Hooks.once("ready", () => {
  if (game.user.isGM) ensureRecordsFolder();
});
