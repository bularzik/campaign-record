/**
 * Scene-link click logic for Campaign Record sheets. Pure and Foundry-free so
 * it can be unit-tested without a running game; the sheet supplies DOM nodes
 * and scene primitives and performs the resulting Foundry action.
 */

// A content-link UUID points at a Scene when its final "<Type>.<id>" segment
// is a Scene — matches world ("Scene.abc") and compendium
// ("Compendium.pack.Scene.abc") references alike.
const SCENE_UUID = /(?:^|\.)Scene\.[^.]+$/;

/**
 * The Scene UUID of the content link enclosing `target`, or null when the
 * click was not on a scene content link (so it falls through to Foundry).
 */
export function sceneUuidFromContentLink(target) {
  const uuid = target?.closest?.("a.content-link[data-uuid]")?.dataset?.uuid ?? null;
  return uuid && SCENE_UUID.test(uuid) ? uuid : null;
}

/**
 * Decide what a scene-link click should do:
 * - { kind: "view" }                    when the user can view the scene
 * - { kind: "image", src, title }       otherwise, if the scene has an image
 *                                        (background preferred, thumbnail fallback)
 * - { kind: "notify" }                  otherwise (no image to show)
 */
export function resolveSceneClickAction({ canView, backgroundSrc, thumb, name }) {
  if (canView) return { kind: "view" };
  const src = backgroundSrc || thumb;
  if (src) return { kind: "image", src, title: name };
  return { kind: "notify" };
}
