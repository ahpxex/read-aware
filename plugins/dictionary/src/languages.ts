import type { PluginDictionaryLanguage } from "@read-aware/plugin-types";

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
] satisfies { value: PluginDictionaryLanguage; label: string }[];

export const LANGUAGE_VALUE_BY_NAME: Readonly<Record<string, PluginDictionaryLanguage>> = {
  English: "en",
  "Simplified Chinese": "zh-Hans",
  "Traditional Chinese": "zh-Hant",
  Japanese: "ja",
  French: "fr",
  German: "de",
  Russian: "ru",
  Spanish: "es",
};

export function isTargetLanguage(value: unknown): value is PluginDictionaryLanguage {
  return LANGUAGE_OPTIONS.some((option) => option.value === value);
}
