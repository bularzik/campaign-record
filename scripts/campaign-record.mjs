import "./testing/quench.mjs";
import { registerDataModels } from "./data/registration.mjs";
import { registerUpdateGuards } from "./hooks/guards.mjs";
import { registerDirectoryUI } from "./hooks/directory.mjs";
import { registerHubUI, registerHubKeybinding } from "./hooks/hub-ui.mjs";
import { ensureRecordsFolder } from "./data/groups.mjs";
import { registerSheets, registerPartials } from "./sheets/registration.mjs";
import { registerPresenterSocket, requestPresentationSync } from "./presenter/socket.mjs";

Hooks.once("init", () => {
  console.log("campaign-record | Initializing Campaign Record");
  registerDataModels();
  registerSheets();
  registerPartials();
  registerUpdateGuards();
  registerDirectoryUI();
  registerHubUI();
  registerHubKeybinding();
});

Hooks.once("ready", () => {
  registerPresenterSocket();
  // a reloading/late-joining client re-acquires any presentation in progress
  requestPresentationSync();
  if (game.user.isGM) ensureRecordsFolder();
});
