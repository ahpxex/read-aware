/**
 * Platform / runtime detection for the ReadAware web frontend.
 *
 * The same React app runs in two shells: a plain browser tab and the Tauri
 * desktop window. Anything that must differ between them (storage adapter,
 * custom window chrome, macOS traffic-light insets) keys off these helpers.
 */

/** True when running inside the Tauri desktop shell (vs a plain browser). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** True when the host OS is macOS. */
export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator.platform || "").toLowerCase();
  if (platform) return platform.includes("mac");
  return /\bMac\b/.test(navigator.userAgent);
}

/**
 * Tag the document root with platform data attributes so CSS can react to the
 * desktop shell and host OS — e.g. reserving a draggable titlebar band and
 * clearance for the macOS traffic lights once the native title bar is hidden.
 *
 * Call once at startup, before the app renders.
 */
export function applyPlatformAttributes(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (isTauri()) root.dataset.tauri = "true";
  if (isMacOS()) root.dataset.os = "mac";
}
