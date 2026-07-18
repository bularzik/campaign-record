import "./testing/quench.mjs";
import { registerDataModels } from "./data/registration.mjs";
import { registerUpdateGuards } from "./hooks/guards.mjs";
import { registerAutoLink } from "./hooks/auto-link.mjs";
import { registerDirectoryUI } from "./hooks/directory.mjs";
import { registerHubUI, registerHubKeybinding, registerHubSettings } from "./hooks/hub-ui.mjs";
import { ensureRecordsFolder } from "./data/groups.mjs";
import { registerSheets, registerPartials } from "./sheets/registration.mjs";
import { registerPresenterSocket, requestPresentationSync } from "./presenter/socket.mjs";
import { registerSchemaSetting, runMigrations } from "./data/migration-runner.mjs";
import { registerJournalPageStyling } from "./integrations/dnd5e.mjs";
import { registerAutoTargetSetting, registerAutoTargetSocket } from "./settings/auto-target.mjs";
import { registerAutoCapture, registerMediaDropSocket } from "./hooks/auto-capture.mjs";
import { registerMediaRelaySocket } from "./hooks/media-relay.mjs";

Hooks.once("init", () => {
  console.log("campaign-record | Initializing Campaign Record");
  registerDataModels();
  registerSchemaSetting();
  registerSheets();
  registerPartials();
  registerUpdateGuards();
  registerAutoLink();
  registerDirectoryUI();
  registerHubUI();
  registerHubKeybinding();
  registerHubSettings();
  registerAutoTargetSetting();
  registerJournalPageStyling();
});

Hooks.once("ready", async () => {
  await runMigrations();
  registerPresenterSocket();
  registerAutoTargetSocket();
  registerAutoCapture();
  registerMediaDropSocket();
  registerMediaRelaySocket();
  // a reloading/late-joining client re-acquires any presentation in progress
  requestPresentationSync();
  if (game.user.isGM) ensureRecordsFolder();
});
