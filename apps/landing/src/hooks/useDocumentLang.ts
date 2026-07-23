import { useEffect } from "react";
import { LOCALE_LANG, type Locale } from "../lib/i18n";

/**
 * Keeps <html lang> honest across client-side navigation between locales.
 * Prerendered HTML already ships the right lang attribute per page
 * (scripts/prerender.mjs); this covers SPA transitions after boot.
 */
export function useDocumentLang(locale: Locale): void {
  useEffect(() => {
    document.documentElement.lang = LOCALE_LANG[locale];
  }, [locale]);
}
