import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query and re-render when it flips.
 *
 * Backed by `useSyncExternalStore`, so the value is read fresh on every
 * render commit and stays in sync with rotation / window resizes. Returns
 * `false` during SSR (no `matchMedia`).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * Phone-width viewport: below Tailwind's `md` breakpoint (48rem), matching the
 * `max-md:` utility variant. Layouts branch on this to swap desktop docked
 * panels for full-screen sheets, show the bottom navigation bar, etc.
 */
export const PHONE_VIEWPORT_QUERY = "(max-width: 47.9375rem)";

/** True on phone-width viewports (below Tailwind `md`). */
export function usePhoneViewport(): boolean {
  return useMediaQuery(PHONE_VIEWPORT_QUERY);
}
