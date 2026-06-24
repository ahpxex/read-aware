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

function preventContextMenu(event: MouseEvent): void {
  const target = event.target;
  const inEditable =
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea") !== null);
  if (!inEditable) event.preventDefault();
}

/**
 * Suppress the webview's native right-click menu on a document, in the desktop
 * shell only.
 *
 * The default WKWebView context menu (Reload, Back/Forward, Inspect Element…) is
 * browser chrome with no place in a shipped app. Editable fields keep their
 * native menu so Cut/Copy/Paste/Look Up still work. Plain browser/dev builds are
 * left untouched so right-click devtools stay reachable.
 *
 * Works on any document, so it covers both the app shell and each reader section
 * iframe. `preventContextMenu` is a stable reference, so re-attaching to the
 * same document is a no-op.
 */
export function suppressNativeContextMenu(doc: Document): void {
  if (!isTauri()) return;
  doc.addEventListener("contextmenu", preventContextMenu);
}

/** Suppress the native right-click menu for the top-level app document. */
export function disableNativeContextMenu(): void {
  if (typeof document === "undefined") return;
  suppressNativeContextMenu(document);
}
