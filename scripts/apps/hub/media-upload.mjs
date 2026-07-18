import { uploadFilename } from "../../logic/media-drop.mjs";
import { relayUploadMedia } from "../../hooks/media-relay.mjs";

/**
 * Upload a dropped media file into this group's media directory in the
 * user-data source. The filename is timestamp-prefixed so same-named drops
 * never overwrite. Returns the stored path; throws when the upload fails.
 */
export async function uploadHubMedia(group, file) {
  const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
  const dir = `campaign-record-media/${group.id}`;
  await FilePickerImpl.browse("data", dir).catch(async () => {
    // Parent first: createDirectory is not recursive. Both calls tolerate
    // already-exists races; a directory that truly failed to create
    // surfaces as an upload failure below.
    await FilePickerImpl.createDirectory("data", "campaign-record-media")
      .catch((err) => console.warn("campaign-record | createDirectory campaign-record-media", err));
    await FilePickerImpl.createDirectory("data", dir)
      .catch((err) => console.warn(`campaign-record | createDirectory ${dir}`, err));
  });
  const renamed = new File([file], uploadFilename(file.name, Date.now()), { type: file.type });
  const result = await FilePickerImpl.upload("data", dir, renamed, {}, { notify: false });
  if (!result?.path) throw new Error(`campaign-record | upload failed for ${file.name}`);
  return result.path;
}

/** Thrown when a user can neither upload directly nor relay through a GM. */
export class NoActiveGMError extends Error {
  constructor(...args) {
    super(...args);
    this.name = "NoActiveGMError";
  }
}

/**
 * Upload media as the current user: directly when they hold FILES_UPLOAD,
 * otherwise relayed through the active GM (images only). Throws
 * NoActiveGMError when neither path is available.
 */
export async function uploadHubMediaAsUser(group, file) {
  if (game.user.can("FILES_UPLOAD")) return uploadHubMedia(group, file);
  if (game.users.activeGM) return relayUploadMedia(group, file);
  throw new NoActiveGMError("campaign-record | no active GM to relay the upload");
}
