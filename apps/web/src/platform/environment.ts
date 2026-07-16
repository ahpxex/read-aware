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

/** True when the host OS is Android. */
export function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /\bAndroid\b/i.test(navigator.userAgent);
}

/**
 * True when the host OS is iOS / iPadOS. Modern iPadOS masquerades as
 * "MacIntel", so a Mac platform with a touchscreen is treated as iPad.
 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/\b(iPhone|iPad|iPod)\b/.test(navigator.userAgent)) return true;
  const platform = (navigator.platform || "").toLowerCase();
  return platform.includes("mac") && navigator.maxTouchPoints > 1;
}

/** True when the host OS is macOS (excluding iPadOS masquerading as Mac). */
export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  if (isIOS()) return false;
  const platform = (navigator.platform || "").toLowerCase();
  if (platform) return platform.includes("mac");
  return /\bMac\b/.test(navigator.userAgent);
}

/** True when the host OS is Windows. */
export function isWindows(): boolean {
  if (typeof navigator === "undefined") return false;
  return /\b(Windows|Win32|Win64)\b/i.test(navigator.platform || navigator.userAgent);
}

/** True when the host OS is a desktop Linux (Android reports Linux too — excluded). */
export function isLinux(): boolean {
  if (typeof navigator === "undefined") return false;
  if (isAndroid()) return false;
  return /\bLinux\b/i.test(navigator.platform || navigator.userAgent);
}

/** True on a phone/tablet OS, where the Tauri shell is the mobile app. */
export function isMobileOS(): boolean {
  return isAndroid() || isIOS();
}

/**
 * Dev-only OS override for previewing another platform's window chrome —
 * `localStorage.setItem("ra-debug-os", "windows" | "linux")` then reload.
 * Affects the chrome kind and the data-os attribute, never the real OS checks.
 */
function debugOsOverride(): "windows" | "linux" | null {
  if (!import.meta.env.DEV) return null;
  try {
    const value = localStorage.getItem("ra-debug-os");
    return value === "windows" || value === "linux" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Which window chrome the desktop shell draws:
 * - "mac": native traffic lights overlay our header (left inset reserved)
 * - "custom": frameless window; we render caption controls on the header's right
 * - "none": browser or mobile — no window chrome of ours at all
 */
export function desktopChromeKind(): "mac" | "custom" | "none" {
  if (!isTauri() || isMobileOS()) return "none";
  if (debugOsOverride()) return "custom";
  if (isMacOS()) return "mac";
  if (isWindows() || isLinux()) return "custom";
  return "none";
}

/**
 * True when the primary pointer is coarse (a touchscreen). Layout code uses
 * this for touch-specific ergonomics that aren't about viewport width — e.g.
 * tighter reading margins on tablets.
 */
export function hasCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches === true
  );
}

/**
 * Tag the document root with platform data attributes so CSS can react to the
 * shell and host OS — e.g. reserving a draggable titlebar band and clearance
 * for the macOS traffic lights once the native title bar is hidden, or mobile
 * safe-area padding.
 *
 * Call once at startup, before the app renders.
 */
export function applyPlatformAttributes(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (isTauri()) root.dataset.tauri = "true";
  const override = debugOsOverride();
  if (override) root.dataset.os = override;
  else if (isAndroid()) root.dataset.os = "android";
  else if (isIOS()) root.dataset.os = "ios";
  else if (isMacOS()) root.dataset.os = "mac";
  else if (isWindows()) root.dataset.os = "windows";
  else if (isLinux()) root.dataset.os = "linux";
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
