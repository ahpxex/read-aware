import { invoke } from "../../../platform/ipc";
import { isTauri } from "../../../platform/environment";
import { AppError } from "@read-aware/core";

export function createSystemFontLoader(load: () => Promise<string[]>): () => Promise<string[]> {
  let cache: Promise<string[]> | null = null;
  return () => {
    cache ??= Promise.resolve().then(load).then(dedupeSorted).catch(error => {
      cache = null;
      throw new AppError("settings/font-enumeration-failed", "Could not enumerate installed font families", { cause: error, retryable: true });
    });
    return cache.then(families => [...families]);
  };
}

/**
 * Font families installed on the user's machine, for the reader font picker.
 *
 * Desktop-only: the Tauri shell enumerates them natively (`list_system_fonts` —
 * NSFontManager on macOS, DirectWrite on Windows, fc-list on Linux). There is
 * no cross-platform browser API we can rely on — WKWebView, the macOS webview,
 * has no `queryLocalFonts` — so in the browser preview / Storybook this
 * resolves to an empty list and the picker falls back to the built-in presets.
 *
 * Successful results are cached for the session. Restart after installing or
 * removing system fonts; a failed enumeration is retryable rather than cached.
 */
export const listSystemFonts = createSystemFontLoader(async () => isTauri() ? invoke<string[]>("list_system_fonts") : []);

/** Drop hidden/blank families, fold case-insensitive duplicates, sort by name. */
function dedupeSorted(families: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of families) {
    const name = raw.trim();
    // Skip blanks and the dot-prefixed hidden system faces (e.g. ".SF NS").
    if (!name || name.startsWith(".") || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
