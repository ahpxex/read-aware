import type { PluginLocalizedText } from "./plugin-types";

/** Resolve plugin-owned copy without adding it to the host's i18next catalogs. */
export function resolvePluginText(value: PluginLocalizedText, locale?: string | null): string {
  if (!locale || !value.translations) return value.default;
  const requested = locale.toLowerCase();
  const exact = Object.entries(value.translations).find(
    ([candidate]) => candidate.toLowerCase() === requested,
  );
  if (exact) return exact[1];

  const base = requested.split("-")[0];
  const baseMatch = Object.entries(value.translations).find(
    ([candidate]) => candidate.toLowerCase() === base,
  );
  return baseMatch?.[1] ?? value.default;
}
