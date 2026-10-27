import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { describeError } from "../../../i18n";
import {
  isPluginFont,
  isSystemFont,
  systemFontFamily,
  toCuratedFont,
  toSystemFont,
  toUserFont,
  type ReaderFontFamily,
  type ReaderFontWeight,
} from "../lib/reader-settings";
import { CURATED_FONTS } from "../lib/curated-fonts";
import { useSystemFonts } from "./useSystemFonts";
import { useCuratedFontFace } from "./useCuratedFontFace";
import { usePluginFontFace } from "./usePluginFonts";
import { useUserFontFace } from "./useUserFontFace";
import { userFontsAtom } from "../lib/user-fonts";
import { toPluginRef, parsePluginRef } from "../../plugins/lib/plugin-theme";
import { pluginFontsAtom } from "../../plugins/state/plugin-store";

const CURATED_OPTIONS: { value: string; label: string }[] = CURATED_FONTS.map((font) => ({
  value: toCuratedFont(font.id),
  label: font.label,
}));

/** Stands in for a null selection while the loaders run — owned by neither. */
const NO_FONT = "system:" as ReaderFontFamily;

/** Choice value for the null choice. Not a valid font ref, so it cannot collide. */
const DEFAULT_OPTION = "\u0000default";

export type FontChoicesOptions = {
  /** Active weight preset — decides which weights the curated download fetches. */
  fontWeight?: ReaderFontWeight;
} & (
  | {
      value: ReaderFontFamily;
      onChange: (value: ReaderFontFamily) => void;
      defaultLabel?: undefined;
    }
  | {
      value: ReaderFontFamily | null;
      onChange: (value: ReaderFontFamily | null) => void;
      defaultLabel: string;
    }
);

/**
 * The font choices a body-font picker offers, whatever it looks like (the
 * FontField dropdown, the phone's FontList): one list in three sections —
 * our curated reading fonts plus plugin fonts (each downloaded and cached on
 * demand the first time it is chosen), then the user's imported font files,
 * then every font installed on this device. Also owns loading the chosen
 * face, and reports the download and device-list states a picker must show.
 *
 * `defaultLabel` opts a caller into a null selection — the leading choice in
 * the curated list, meaning "whatever this surface uses by default". Content
 * typography needs it (its default is the app's bundled sans, which must not
 * become a curated download just to be nameable); the reader has no such
 * state, so the union keeps null out of its `onChange` entirely.
 */
export function useFontChoices({ value, onChange, defaultLabel, fontWeight }: FontChoicesOptions) {
  const { fonts: systemFonts, error: systemError, loading: systemLoading, retry: retrySystemFonts } = useSystemFonts();
  const systemFailure = systemError ? describeError(systemError) : null;
  const pluginFonts = useAtomValue(pluginFontsAtom);
  const userFonts = useAtomValue(userFontsAtom);
  // A null value is the surface's own default — neither loader owns it.
  const loaded = value ?? NO_FONT;
  // Download + inject the active curated font so the preview/UI render it.
  const fontFace = useCuratedFontFace(loaded, fontWeight);
  // Plugin fonts need no download — inject their folder-served faces directly.
  usePluginFontFace(loaded);
  // Imported fonts point at the synced blob store — no download either.
  useUserFontFace(loaded);

  const installedOptions = useMemo(() => {
    const opts = systemFonts.map((family) => ({ value: toSystemFont(family), label: family }));
    // Keep the current pick visible before the list resolves, or if uninstalled.
    if (value && isSystemFont(value) && !opts.some((option) => option.value === value)) {
      opts.unshift({ value, label: systemFontFamily(value) ?? value });
    }
    return opts;
  }, [systemFonts, value]);

  /**
   * The user's own picks, named by the family the file declares (never the
   * file name).
   */
  const importedOptions = useMemo(
    () =>
      userFonts.map((font) => ({
        value: toUserFont(font.id),
        label: font.name,
        font,
      })),
    [userFonts],
  );

  // Plugin-bundled fonts share the leading section with the curated set —
  // both are app-offered rather than device-enumerated.
  const curatedOptions = useMemo(() => {
    const opts = [
      // The default choice leads: it is where the surface started, so it reads
      // as the top of the list rather than an escape hatch below the fonts.
      ...(defaultLabel ? [{ value: DEFAULT_OPTION, label: defaultLabel }] : []),
      ...CURATED_OPTIONS,
      ...pluginFonts.map((font) => ({
        value: toPluginRef(font.pluginId, font.id) as string,
        label: font.family,
      })),
    ];
    // A stored plugin font whose plugin is currently gone stays visible.
    if (value && isPluginFont(value) && !opts.some((option) => option.value === value)) {
      opts.push({ value, label: parsePluginRef(value)?.partId ?? value });
    }
    return opts;
  }, [defaultLabel, pluginFonts, value]);

  const options = useMemo(
    () => [...curatedOptions, ...importedOptions, ...installedOptions],
    [curatedOptions, importedOptions, installedOptions],
  );
  // Every source lives in the one list, so the stored ref is always the
  // select's value — only the null surface default maps to its sentinel.
  const selectValue: string = value === null ? (defaultLabel ? DEFAULT_OPTION : "") : value;

  const choose = (next: string) =>
    // The union guarantees a null-accepting handler whenever the default
    // option can be picked, so the cast only widens for that caller.
    (onChange as (v: ReaderFontFamily | null) => void)(next === DEFAULT_OPTION ? null : (next as ReaderFontFamily));

  return {
    options,
    /** The three sections, for pickers that render their own group labels. */
    curatedOptions,
    importedOptions,
    installedOptions,
    /** The option matching the value, or "" for none. */
    selectValue,
    choose,
    systemLoading,
    systemFailure,
    retrySystemFonts,
    /** The chosen curated font's download: status, progress, retry. */
    fontFace,
    /** The imported-font registry rows the picker manages (empty off-Tauri). */
    userFonts,
  };
}
