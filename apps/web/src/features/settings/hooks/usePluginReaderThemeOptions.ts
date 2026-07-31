import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { useLocale } from "../../../i18n";
import { resolvePluginText } from "../../plugins/lib/plugin-i18n";
import { toPluginRef } from "../../plugins/lib/plugin-theme";
import { pluginThemesAtom } from "../../plugins/state/plugin-store";
import type { ReaderThemePreference } from "../lib/reader-settings";

/**
 * Plugin-contributed page colors for the two appearance surfaces (Reading
 * panel and in-reader popover), appended after the built-in options. Labels
 * are plugin-owned copy resolved against the app locale.
 */
export function usePluginReaderThemeOptions(): {
  value: ReaderThemePreference;
  label: string;
}[] {
  const pluginThemes = useAtomValue(pluginThemesAtom);
  const locale = useLocale();
  return useMemo(
    () =>
      pluginThemes
        .filter((theme) => theme.reader)
        .map((theme) => ({
          value: toPluginRef(theme.pluginId, theme.id) as ReaderThemePreference,
          label:
            typeof theme.name === "string"
              ? theme.name
              : resolvePluginText(theme.name, locale),
        })),
    [pluginThemes, locale],
  );
}
