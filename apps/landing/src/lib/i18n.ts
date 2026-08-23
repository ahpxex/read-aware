/**
 * Locale support for the site. English is the source of truth at the
 * unprefixed paths; translations live at locale-prefixed URLs. i18next owns
 * resource lookup and English fallback, while this module owns URL mapping
 * and language metadata only.
 */
export type Locale = "en" | "zh" | "zh-hant" | "ja" | "fr" | "de" | "ru" | "es";

/**
 * Where an explicit language-switcher pick persists. The homepage's
 * browser-language redirect defers to it, so a chosen language sticks
 * across visits instead of fighting the Accept-Language heuristic.
 */
export const LOCALE_CHOICE_KEY = "read-aware-landing-locale";

/** The full site locale set — mirrors the app's own i18n locales. */
export const LOCALES: readonly Locale[] = [
  "en",
  "zh",
  "zh-hant",
  "ja",
  "fr",
  "de",
  "ru",
  "es",
];

/**
 * Docs routes exist in every locale and render one shared component from
 * i18next resources. Blog mirrors remain a three-language subset.
 */
export type DocsLocale = Locale;

export const DOCS_LOCALES: readonly DocsLocale[] = LOCALES;

/** Blog mirrors exist only in this three-language subset. */
export type BlogLocale = "en" | "zh" | "ja";

export const BLOG_LOCALES: readonly BlogLocale[] = ["en", "zh", "ja"];

export function isBlogLocale(locale: Locale): locale is BlogLocale {
  return (BLOG_LOCALES as readonly Locale[]).includes(locale);
}

/** BCP 47 tags for <html lang>, hreflang, and date formatting. */
export const LOCALE_LANG: Record<Locale, string> = {
  en: "en",
  zh: "zh-CN",
  "zh-hant": "zh-Hant",
  ja: "ja",
  fr: "fr",
  de: "de",
  ru: "ru",
  es: "es",
};

/** Native-name labels for the language switcher menu. */
export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  zh: "简体中文",
  "zh-hant": "繁體中文",
  ja: "日本語",
  fr: "Français",
  de: "Deutsch",
  ru: "Русский",
  es: "Español",
};

const PREFIX: Record<Locale, string> = {
  en: "",
  zh: "/zh",
  "zh-hant": "/zh-hant",
  ja: "/ja",
  fr: "/fr",
  de: "/de",
  ru: "/ru",
  es: "/es",
};

// Longest prefix first, so "/zh-hant" never matches as "/zh".
const PREFIXED = LOCALES.filter((locale) => locale !== "en").sort(
  (a, b) => PREFIX[b].length - PREFIX[a].length,
);

export function localeFromPathname(pathname: string): Locale {
  for (const locale of PREFIXED) {
    const prefix = PREFIX[locale];
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return locale;
  }
  return "en";
}

/** The same page's pathname in another locale ("/zh/docs/install" ↔ "/docs/install"). */
export function localizePath(pathname: string, locale: Locale): string {
  const current = localeFromPathname(pathname);
  const base =
    current === "en" ? pathname : pathname.slice(PREFIX[current].length) || "/";
  return locale === "en" ? base : `${PREFIX[locale]}${base}`;
}

/** The locales this page actually exists in (drives the switcher and hreflang). */
export function availableLocales(pathname: string): readonly Locale[] {
  const base = localizePath(pathname, "en");
  if (base === "/" || base.startsWith("/changelog") || base.startsWith("/pricing")) {
    return LOCALES;
  }
  if (base.startsWith("/docs")) return DOCS_LOCALES;
  if (base.startsWith("/blog")) return BLOG_LOCALES;
  return [];
}

export function hasLocaleVariants(pathname: string): boolean {
  return availableLocales(pathname).length > 1;
}
