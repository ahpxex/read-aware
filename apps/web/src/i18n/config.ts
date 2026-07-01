/**
 * Static i18n configuration: the supported locales, the namespace list, and the
 * pure helpers for resolving/labelling locales. No i18next instance here — this
 * module is safe to import from anywhere (including catalog-typing) without
 * pulling in the runtime.
 */

/** BCP-47 tags for every locale ReadAware ships. `en` is the source/fallback. */
export const LOCALES = [
  "en",
  "zh-Hans",
  "zh-Hant",
  "ja",
  "fr",
  "de",
  "ru",
  "es",
] as const;

export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

/**
 * Translation namespaces, one per product surface. Each maps to a
 * `locales/<lng>/<ns>.json` catalog and is loaded as its own lazy chunk, so a
 * route only pays for the namespaces it renders.
 */
export const NAMESPACES = [
  "common",
  "ui",
  "settings",
  "reader",
  "shelf",
  "stats",
  "ai",
  "command",
  "nav",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

/** Autonyms — each language named in its own script, for the language picker. */
export const LOCALE_LABELS: Record<AppLocale, string> = {
  en: "English",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  ja: "日本語",
  fr: "Français",
  de: "Deutsch",
  ru: "Русский",
  es: "Español",
};

export function isAppLocale(value: string): value is AppLocale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Map an arbitrary BCP-47 tag (e.g. from `navigator.language`) to the nearest
 * supported locale, or `undefined` if nothing fits. Handles Chinese script
 * variants explicitly (`zh-CN`/`zh-SG` → Simplified, `zh-TW`/`zh-HK`/`zh-MO` →
 * Traditional) and otherwise falls back to a primary-subtag match.
 */
export function resolveLocale(input?: string | null): AppLocale | undefined {
  if (!input) return undefined;
  const tag = input.toLowerCase();

  const exact = LOCALES.find((locale) => locale.toLowerCase() === tag);
  if (exact) return exact;

  if (tag.startsWith("zh")) {
    if (
      tag.includes("hant") ||
      tag.includes("tw") ||
      tag.includes("hk") ||
      tag.includes("mo")
    ) {
      return "zh-Hant";
    }
    return "zh-Hans";
  }

  const base = tag.split("-")[0];
  return LOCALES.find(
    (locale) => !locale.startsWith("zh") && locale.toLowerCase().split("-")[0] === base,
  );
}
