import { DEFAULT_LOCALE, resolveLocale, type AppLocale } from "./config";

/**
 * Decide the boot locale: an explicitly stored preference wins; otherwise fall
 * back to the browser/OS language list (works in the Tauri WebView too); finally
 * default to English. Called once at startup with the persisted setting.
 */
export function detectInitialLocale(stored?: string | null): AppLocale {
  const fromStored = resolveLocale(stored);
  if (fromStored) return fromStored;

  if (typeof navigator !== "undefined") {
    const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const candidate of candidates) {
      const resolved = resolveLocale(candidate);
      if (resolved) return resolved;
    }
  }

  return DEFAULT_LOCALE;
}
