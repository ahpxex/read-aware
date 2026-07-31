/**
 * The explanation-language vocabulary. Since the engine moved into this
 * plugin, the target-language type lives here too: a concrete app locale, or
 * "auto" to follow `ctx.locale`.
 */
export type TargetLanguage =
  | "auto"
  | "en"
  | "zh-Hans"
  | "zh-Hant"
  | "ja"
  | "fr"
  | "de"
  | "ru"
  | "es";

export const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Match app language" },
  { value: "en", label: "English" },
  { value: "zh-Hans", label: "简体中文" },
  { value: "zh-Hant", label: "繁體中文" },
  { value: "ja", label: "日本語" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "ru", label: "Русский" },
  { value: "es", label: "Español" },
] satisfies { value: TargetLanguage; label: string }[];

/**
 * English endonym per locale — what the model is told to explain in (a clear
 * language name is more reliable in the prompt than a BCP-47 tag).
 */
export const LANGUAGE_NAME_BY_VALUE: Readonly<Record<Exclude<TargetLanguage, "auto">, string>> = {
  en: "English",
  "zh-Hans": "Simplified Chinese",
  "zh-Hant": "Traditional Chinese",
  ja: "Japanese",
  fr: "French",
  de: "German",
  ru: "Russian",
  es: "Spanish",
};

export const LANGUAGE_VALUE_BY_NAME: Readonly<Record<string, TargetLanguage>> = {
  English: "en",
  "Simplified Chinese": "zh-Hans",
  "Traditional Chinese": "zh-Hant",
  Japanese: "ja",
  French: "fr",
  German: "de",
  Russian: "ru",
  Spanish: "es",
};

export function isTargetLanguage(value: unknown): value is TargetLanguage {
  return LANGUAGE_OPTIONS.some((option) => option.value === value);
}
