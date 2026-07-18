import { parseImageDataUri, imageExtension } from "../logic/import-images.mjs";
import { uploadHubMediaAsUser, NoActiveGMError } from "./hub/media-upload.mjs";

/**
 * Build an upload File from an image data-URI. Renderable types upload as-is;
 * unknown-but-decodable types transcode to PNG; undecodable types (EMF/WMF)
 * return { skipped: subtype }.
 */
export async function dataUriToFile(uri, basename) {
  const parsed = parseImageDataUri(uri);
  if (!parsed) return { skipped: "unknown" };
  const bytes = Uint8Array.from(atob(parsed.base64), (c) => c.charCodeAt(0));
  const ext = imageExtension(parsed.subtype);
  if (ext) return { file: new File([bytes], `${basename}.${ext}`, { type: parsed.mime }) };
  // Not directly renderable — best-effort transcode to PNG (EMF/WMF will throw).
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: parsed.mime }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const png = await canvas.convertToBlob({ type: "image/png" });
    return { file: new File([await png.arrayBuffer()], `${basename}.png`, { type: "image/png" }) };
  } catch {
    return { skipped: parsed.subtype };
  }
}

/**
 * Upload each inline data-URI image once (mammoth inlines docx images), rewrite
 * srcs to the stored path, and return the collected {src, caption} refs for
 * gallery filing. Identical data-URIs upload once. Per-image failures drop that
 * image with a warning; other images are unaffected. `uploadedByUri` (data-URI ->
 * stored path or null) is supplied by the caller and shared across the whole
 * document, so identical images on different pages are also deduped. Uploads
 * route through uploadHubMediaAsUser, so players without FILES_UPLOAD relay
 * through the active GM; with no GM the images are skipped with their own
 * warning.
 */
export async function uploadInlineImages(html, group, warnings, uploadedByUri) {
  if (!html?.includes("data:image")) return { html, images: [] };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const imgs = [...doc.body.querySelectorAll('img[src^="data:"]')];
  if (!imgs.length) return { html, images: [] };

  const images = [];
  let uploadFailed = false;
  let needsGm = false;
  let n = 0;
  for (const img of imgs) {
    const uri = img.getAttribute("src");
    if (!uploadedByUri.has(uri)) {
      const result = await dataUriToFile(uri, `import-${Date.now()}-${++n}`);
      let path = null;
      if (result.skipped) {
        warnings.push(game.i18n.format("CAMPAIGNRECORD.Import.ImageTypeUnsupported", { type: result.skipped }));
      } else {
        try {
          path = await uploadHubMediaAsUser(group, result.file);
        } catch (error) {
          console.warn("campaign-record | inline image upload failed", error);
          if (error instanceof NoActiveGMError) needsGm = true;
          else uploadFailed = true;
        }
      }
      uploadedByUri.set(uri, path);
    }
    const path = uploadedByUri.get(uri);
    if (path) {
      img.setAttribute("src", path);
      const caption = (img.getAttribute("alt") ?? "").trim();
      images.push({ src: path, caption });
    } else {
      img.remove();
    }
  }

  if (needsGm && !warnings.includes(game.i18n.localize("CAMPAIGNRECORD.Import.ImagesNeedGM"))) {
    warnings.push(game.i18n.localize("CAMPAIGNRECORD.Import.ImagesNeedGM"));
  }
  if (uploadFailed) warnings.push(game.i18n.localize("CAMPAIGNRECORD.Import.ImagesDropped"));

  // Dedupe refs by src so the same image inline twice yields one gallery entry.
  const seen = new Set();
  const uniqueImages = images.filter((i) => (seen.has(i.src) ? false : seen.add(i.src)));
  return { html: doc.body.innerHTML, images: uniqueImages };
}
