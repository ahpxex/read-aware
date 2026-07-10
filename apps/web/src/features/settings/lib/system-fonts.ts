import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../../platform/environment";

let cache: Promise<string[]> | null = null;

/**
 * Font families installed on the user's machine, for the reader font picker.
 *
 * Desktop-only: the Tauri shell enumerates them natively (`list_system_fonts` —
 * NSFontManager on macOS, DirectWrite on Windows, fc-list on Linux). There is
 * no cross-platform browser API we can rely on — WKWebView, the macOS webview,
 * has no `queryLocalFonts` — so in the browser preview / Storybook this
 * resolves to an empty list and the picker falls back to the built-in presets.
 *
 * Cached for the session; the installed set doesn't change while the app runs.
 */
export function listSystemFonts(): Promise<string[]> {
  if (!cache) {
    cache = loadSystemFonts();
  }
  return cache;
}

async function loadSystemFonts(): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    const families = await invoke<string[]>("list_system_fonts");
    return dedupeSorted(families);
  } catch {
    return [];
  }
}

/** Drop hidden/blank families, fold case-insensitive duplicates, sort by name. */
function dedupeSorted(families: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of families) {
    const name = raw.trim();
    // Skip blanks and the dot-prefixed hidden system faces (e.g. ".SF NS").
    if (!name || name.startsWith(".")) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
