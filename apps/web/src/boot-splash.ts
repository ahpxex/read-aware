/**
 * Dismisses the boot splash (the #ra-splash overlay in index.html).
 *
 * The splash sits above #root, so the app paints its first frame underneath
 * it; this fades the splash out over that frame — a cross-fade — and removes
 * it. Called from App's mount effect on the normal path, and from the root
 * error/not-found screens so a failed boot can never stay hidden behind it.
 * Idempotent: once the element is gone, later calls are no-ops.
 */
import { prefersReducedMotion } from "./features/settings/lib/app-settings";

/** Safety margin over the 260ms CSS transition in index.html. */
const SPLASH_LEAVE_FALLBACK_MS = 340;

export function dismissBootSplash(): void {
  const splash = document.getElementById("ra-splash");
  if (!splash) return;

  if (prefersReducedMotion()) {
    splash.remove();
    return;
  }

  splash.addEventListener("transitionend", () => splash.remove(), { once: true });
  // Remove even if transitionend never fires (tab hidden, transition skipped).
  window.setTimeout(() => splash.remove(), SPLASH_LEAVE_FALLBACK_MS);
  // Double rAF: let the app's first frame actually paint under the splash
  // before the fade starts, so the reveal never flashes an unpainted root.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => splash.classList.add("ra-splash-leave"));
  });
}
