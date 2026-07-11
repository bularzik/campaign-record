import { MODULE_ID } from "../constants.mjs";

const pending = new Map();

/**
 * Load a checked-in vendor bundle (UMD/IIFE) via script tag and return the
 * global it defines. Idempotent; concurrent callers share one load.
 */
export async function loadVendorGlobal(file, globalName) {
  if (globalThis[globalName]) return globalThis[globalName];
  if (!pending.has(file)) {
    pending.set(file, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `modules/${MODULE_ID}/vendor/${file}`;
      script.onload = resolve;
      script.onerror = () => {
        pending.delete(file);
        reject(new Error(`campaign-record | failed to load vendor/${file}`));
      };
      document.head.append(script);
    }));
  }
  await pending.get(file);
  const global = globalThis[globalName];
  if (!global) throw new Error(`campaign-record | vendor/${file} did not define ${globalName}`);
  return global;
}
