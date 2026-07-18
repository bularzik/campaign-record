import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../scripts/hooks/media-relay.mjs", () => ({
  relayUploadMedia: vi.fn(async () => "campaign-record-media/g1/relayed.png")
}));

import { uploadHubMediaAsUser, NoActiveGMError } from "../scripts/apps/hub/media-upload.mjs";
import { relayUploadMedia } from "../scripts/hooks/media-relay.mjs";

const group = { id: "g1" };
const file = new File([new Uint8Array([1, 2, 3])], "map.png", { type: "image/png" });

let upload;
beforeEach(() => {
  upload = vi.fn(async () => ({ path: "campaign-record-media/g1/123-map.png" }));
  globalThis.foundry = {
    applications: { apps: { FilePicker: { implementation: {
      browse: vi.fn(async () => ({})),
      createDirectory: vi.fn(async () => ({})),
      upload
    } } } }
  };
  globalThis.game = {
    user: { can: vi.fn(() => true) },
    users: { activeGM: null }
  };
});
afterEach(() => {
  delete globalThis.foundry;
  delete globalThis.game;
  vi.clearAllMocks();
});

describe("uploadHubMediaAsUser", () => {
  it("uploads directly when the user holds FILES_UPLOAD", async () => {
    const path = await uploadHubMediaAsUser(group, file);
    expect(path).toBe("campaign-record-media/g1/123-map.png");
    expect(upload).toHaveBeenCalledOnce();
    expect(relayUploadMedia).not.toHaveBeenCalled();
  });
  it("relays through the active GM when the user cannot upload", async () => {
    game.user.can = vi.fn((p) => p !== "FILES_UPLOAD");
    game.users.activeGM = { id: "gm" };
    const path = await uploadHubMediaAsUser(group, file);
    expect(path).toBe("campaign-record-media/g1/relayed.png");
    expect(relayUploadMedia).toHaveBeenCalledWith(group, file);
    expect(upload).not.toHaveBeenCalled();
  });
  it("throws NoActiveGMError when neither path is available", async () => {
    game.user.can = vi.fn(() => false);
    game.users.activeGM = null;
    await expect(uploadHubMediaAsUser(group, file)).rejects.toBeInstanceOf(NoActiveGMError);
    expect(upload).not.toHaveBeenCalled();
    expect(relayUploadMedia).not.toHaveBeenCalled();
  });
});
