/**
 * Dictionary preferences — which language the AI dictionary explains words in.
 * Persisted device-locally (SQLite on desktop) like the other reader prefs.
 * `"auto"` (the default) follows the app's UI language.
 */
import { localKV } from "../../../platform/local-store";
import { type AppLocale, isAppLocale } from "../../../i18n/config";

const STORAGE_KEY = "read-aware-dictionary-language";

/** A concrete locale, or `"auto"` = follow the current app language. */
export type DictionaryLanguage = AppLocale | "auto";

export function getDictionaryLanguage(): DictionaryLanguage {
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    if (!raw) return "auto";
    if (raw === "auto" || isAppLocale(raw)) return raw;
    return "auto";
  } catch {
    return "auto";
  }
}

export function saveDictionaryLanguage(language: DictionaryLanguage): void {
  localKV.setItem(STORAGE_KEY, language);
}

/**
 * English endonym for each locale — passed to the model as the explanation
 * language (a clear language name is more reliable in the prompt than a BCP-47
 * tag). Keep in sync with `LOCALES`.
 */
const LOCALE_LANGUAGE_NAME: Record<AppLocale, string> = {
  en: "English",
  "zh-Hans": "Simplified Chinese",
  "zh-Hant": "Traditional Chinese",
  ja: "Japanese",
  fr: "French",
  de: "German",
  ru: "Russian",
  es: "Spanish",
};

/** Resolve the preference (+ current app locale) to a model-ready language name. */
export function resolveExplanationLanguageName(
  language: DictionaryLanguage,
  appLocale: AppLocale,
): string {
  const locale = language === "auto" ? appLocale : language;
  return LOCALE_LANGUAGE_NAME[locale] ?? LOCALE_LANGUAGE_NAME.en;
}
