import { useSyncExternalStore } from "react";
import { useAtomValue } from "jotai";
import { appSettingsAtom } from "../../../state/ui";
import {
  isEinkActive,
  REDUCED_MOTION_QUERY,
  resolveReducedMotion,
  systemPrefersReducedMotion,
} from "../lib/app-settings";

function subscribeReducedMotion(changed: () => void): () => void {
  // Hosts without media queries (tests, embedded previews) never change it.
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", changed);
  return () => media.removeEventListener("change", changed);
}

/**
 * The display mode React output depends on, live: whether e-ink mode is in
 * effect and whether motion is off (setting, e-ink mode or the OS
 * preference). For what CSS cannot reach — the book's own frames, inline
 * palette colors — the same answers `applyDisplayAttributes` stamps.
 */
export function useDisplayMode(): { eink: boolean; reducedMotion: boolean } {
  const settings = useAtomValue(appSettingsAtom);
  // Subscribed so an OS change re-renders; `resolveReducedMotion` reads the
  // same query for the value.
  useSyncExternalStore(subscribeReducedMotion, systemPrefersReducedMotion, () => false);
  return { eink: isEinkActive(settings), reducedMotion: resolveReducedMotion(settings) };
}
