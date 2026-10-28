import { localKV } from "../../platform/local-store";
import { isMobileOS } from "../../platform/environment";

export const HEADER_FOOTER_SETTINGS_KEY = "read-aware-reader-header-footer";

/** A piece of reading status the strips can show. */
export type HeaderFooterItem = "chapter" | "bookTitle" | "progress" | "pages" | "time" | "battery";

/** One of the six strip positions an item can occupy. */
export type HeaderFooterPosition =
  | "header-left"
  | "header-center"
  | "header-right"
  | "footer-left"
  | "footer-center"
  | "footer-right";

export const HEADER_FOOTER_POSITIONS: readonly HeaderFooterPosition[] = [
  "header-left",
  "header-center",
  "header-right",
  "footer-left",
  "footer-center",
  "footer-right",
];

/**
 * Thin always-visible info strips above and below the page. Device-local.
 * Each position holds an ordered list of items; an item in no position is
 * hidden.
 */
export type HeaderFooterSettings = {
  enabled: boolean;
  slots: Record<HeaderFooterPosition, HeaderFooterItem[]>;
};

/** The catalog order — also the order items are offered in pickers. */
export const HEADER_FOOTER_ITEMS: readonly HeaderFooterItem[] = [
  "chapter",
  "bookTitle",
  "progress",
  "pages",
  "time",
  "battery",
];

/** Where "show" places a hidden item of each kind. */
export const HEADER_FOOTER_SHOW_POSITION: Record<HeaderFooterItem, HeaderFooterPosition> = {
  chapter: "header-left",
  bookTitle: "header-center",
  progress: "footer-right",
  pages: "footer-center",
  time: "footer-left",
  battery: "footer-left",
};

const DEFAULT_SLOTS: Record<HeaderFooterPosition, HeaderFooterItem[]> = {
  "header-left": ["chapter"],
  "header-center": [],
  "header-right": [],
  "footer-left": ["time", "battery"],
  "footer-center": [],
  "footer-right": ["progress"],
};

/**
 * The strips default on only where they stand in for the hidden system status
 * bar — Android/iOS run the reader fully immersive. Resolved at read time so
 * the stored record stays platform-neutral: a synced or hand-edited record
 * never carries one platform's default onto another.
 */
export function defaultHeaderFooterSettings(): HeaderFooterSettings {
  return { enabled: isMobileOS(), slots: { ...DEFAULT_SLOTS } };
}

export function normalizeHeaderFooterSettings(raw: unknown, defaults: HeaderFooterSettings): HeaderFooterSettings {
  // Anything that is not a settings object reads as the defaults untouched.
  if (!raw || typeof raw !== "object") return defaults;
  const stored = raw as { enabled?: unknown; slots?: Partial<Record<HeaderFooterPosition, unknown>> };
  const storedSlots = stored.slots && typeof stored.slots === "object" ? stored.slots : {};
  const seen = new Set<HeaderFooterItem>();
  const slots = {} as Record<HeaderFooterPosition, HeaderFooterItem[]>;
  // First occurrence wins, position order then array order.
  for (const position of HEADER_FOOTER_POSITIONS) {
    const list = storedSlots[position];
    slots[position] = Array.isArray(list)
      ? list.filter(
          (id): id is HeaderFooterItem =>
            typeof id === "string" &&
            HEADER_FOOTER_ITEMS.includes(id as HeaderFooterItem) &&
            !seen.has(id as HeaderFooterItem) &&
            (seen.add(id as HeaderFooterItem), true),
        )
      : [];
  }
  return {
    enabled: typeof stored.enabled === "boolean" ? stored.enabled : defaults.enabled,
    slots,
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
