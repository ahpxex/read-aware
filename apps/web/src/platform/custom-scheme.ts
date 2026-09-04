/**
 * URLs for the app's custom URI schemes (`raplugin://` plugin assets,
 * `rablob://` book covers), registered in the Rust shell.
 *
 * Mirrors Tauri's convertFileSrc() scheme mapping: Windows AND Android serve
 * custom protocols over `http://<scheme>.localhost` (their webviews cannot
 * intercept a custom scheme directly), everywhere else as
 * `<scheme>://localhost/`. Missing the Android half of that rule once left
 * every plugin failing activation there with "Failed to fetch dynamically
 * imported module: raplugin://…" — so the rule lives in exactly one place.
 */
export function customSchemeBase(scheme: string): string {
  const httpMapped =
    typeof navigator !== "undefined" &&
    (navigator.userAgent.includes("Windows") || navigator.userAgent.includes("Android"));
  return httpMapped ? `http://${scheme}.localhost/` : `${scheme}://localhost/`;
}

/** `<base>/<path>` for a custom scheme; `path` must not start with a slash. */
export function customSchemeUrl(scheme: string, path: string): string {
  return `${customSchemeBase(scheme)}${path}`;
}
