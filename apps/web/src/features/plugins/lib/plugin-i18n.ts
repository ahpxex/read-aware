import { i18n } from "../../../i18n";
import type { PluginLocalizedText, PluginText } from "./plugin-types";

/**
 * Contribution copy (`string | PluginLocalizedText`), resolved against the
 * CURRENT app language. Render sites call this inline; surfaces re-render on
 * language change through their own i18n subscriptions.
 */
export function contributionText(value: PluginText): string {
  return typeof value === "string" ? value : resolvePluginText(value, i18n.language);
}

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
