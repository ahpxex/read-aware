/**
 * Runtime bundle identity — WHICH app is running, independent of how the
 * frontend was served (dev server vs bundled dist).
 *
 * `productName` is the signal: the dev desktop config (tauri.dev.conf.json)
 * names the app "ReadAware Dev", and that survives a release-mode vite build
 * — exactly the build where every VITE_* env default (`.env.development`) is
 * absent. This is what lets the sync layer hold its invariant: a
 * dev-IDENTIFIED bundle never defaults to the production relay, no matter
 * how it was built (see sync-scheduler.ts defaultRelayUrl).
 *
 * Hydrated once at boot (`getName` is async IPC); false until then — boot
 * awaits it before any consumer can ask (main.tsx).
 */
import { isTauri } from "./environment";

/** Pure marker test — the dev config's productName family. */
export function isDevProductName(name: string): boolean {
  return name.startsWith("ReadAware Dev");
}

let devBundle = false;

/** Boot-time hydrate; safe to call repeatedly, resolved once. */
export async function hydrateAppIdentity(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getName } = await import("@tauri-apps/api/app");
    devBundle = isDevProductName(await getName());
  } catch {
    // An unresolvable identity is not fatal: the relay default then behaves
    // like a production bundle (which is what an unnamed build is).
  }
}

export function isDevBundle(): boolean {
  return devBundle;
}
