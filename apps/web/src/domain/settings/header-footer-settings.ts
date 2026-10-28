import { localKV } from "../../platform/local-store";
import { isMobileOS } from "../../platform/environment";

export const HEADER_FOOTER_SETTINGS_KEY = "read-aware-reader-header-footer";

/** A piece of reading status the strips can show. */
export type HeaderFooterItem = "chapter" | "bookTitle" | "progress" | "pages" | "time" | "battery";

/** Where an item lands: one of six strip positions, or nowhere. */
export type HeaderFooterSlot =
  | "hidden"
  | "header-left"
  | "header-center"
  | "header-right"
  | "footer-left"
  | "footer-center"
  | "footer-right";

/** Thin always-visible info strips above and below the page. Device-local. */
export type HeaderFooterSettings = {
  enabled: boolean;
  items: Record<HeaderFooterItem, HeaderFooterSlot>;
};

/** The catalog order — also the order items join within one slot. */
export const HEADER_FOOTER_ITEMS: readonly HeaderFooterItem[] = [
  "chapter",
  "bookTitle",
  "progress",
  "pages",
  "time",
  "battery",
];

export const HEADER_FOOTER_SLOTS: readonly HeaderFooterSlot[] = [
  "hidden",
  "header-left",
  "header-center",
  "header-right",
  "footer-left",
  "footer-center",
  "footer-right",
];

const DEFAULT_ITEMS: Record<HeaderFooterItem, HeaderFooterSlot> = {
  chapter: "header-left",
  bookTitle: "hidden",
  progress: "footer-right",
  pages: "hidden",
  time: "footer-left",
  battery: "footer-left",
};

/**
 * The strips default on only where they stand in for the hidden system status
 * bar — Android/iOS run the reader fully immersive. Resolved at read time so
 * the stored record stays platform-neutral: a synced or hand-edited record
 * never carries one platform's default onto another.
 */
export function defaultHeaderFooterSettings(): HeaderFooterSettings {
  return { enabled: isMobileOS(), items: { ...DEFAULT_ITEMS } };
}

export function normalizeHeaderFooterSettings(raw: unknown, defaults: HeaderFooterSettings): HeaderFooterSettings {
  const stored =
    raw && typeof raw === "object"
      ? (raw as { enabled?: unknown; items?: Partial<Record<HeaderFooterItem, unknown>> })
      : {};
  const storedItems = stored.items && typeof stored.items === "object" ? stored.items : {};
  const items = { ...defaults.items };
  for (const item of HEADER_FOOTER_ITEMS) {
    const slot = storedItems[item];
    items[item] = HEADER_FOOTER_SLOTS.includes(slot as HeaderFooterSlot) ? (slot as HeaderFooterSlot) : items[item];
  }
  return {
    enabled: typeof stored.enabled === "boolean" ? stored.enabled : defaults.enabled,
    items,
  };
}

export function getHeaderFooterSettings(): HeaderFooterSettings {
  const defaults = defaultHeaderFooterSettings();
  try {
    const raw = localKV.getItem(HEADER_FOOTER_SETTINGS_KEY);
    return raw ? normalizeHeaderFooterSettings(JSON.parse(raw), defaults) : defaults;
  } catch {
    // A corrupt record reads as the defaults; the next save replaces it.
    return defaults;
  }
}

export function saveHeaderFooterSettings(settings: HeaderFooterSettings): void {
  localKV.setItem(HEADER_FOOTER_SETTINGS_KEY, JSON.stringify(settings));
}
