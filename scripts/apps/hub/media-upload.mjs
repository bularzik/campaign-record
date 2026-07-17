import { uploadFilename } from "../../logic/media-drop.mjs";

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
    await FilePickerImpl.createDirectory("data", "campaign-record-media").catch(() => {});
    await FilePickerImpl.createDirectory("data", dir).catch(() => {});
  });
  const renamed = new File([file], uploadFilename(file.name, Date.now()), { type: file.type });
  const result = await FilePickerImpl.upload("data", dir, renamed, {}, { notify: false });
  if (!result?.path) throw new Error(`campaign-record | upload failed for ${file.name}`);
  return result.path;
}
