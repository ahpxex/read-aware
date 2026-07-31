import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { pluginThemesAtom } from "../../plugins/state/plugin-store";
import { resolveReaderPalette, type ReaderPalette } from "../lib/reader-theme";
import type { ReaderTheme } from "../lib/reader-settings";

/**
 * The palette behind a concrete reader theme, tracking the plugin theme
 * registry live — a plugin theme applies the moment its plugin activates and
 * falls back to `warm` when it goes away.
 */
export function useReaderPalette(theme: ReaderTheme): ReaderPalette {
  const pluginThemes = useAtomValue(pluginThemesAtom);
  return useMemo(() => resolveReaderPalette(theme, pluginThemes), [theme, pluginThemes]);
}
