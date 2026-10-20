import { useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { describeError } from "../../../i18n";
import {
  curatedFontId,
  isPluginFont,
  isSystemFont,
  isUserFont,
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
 * FontField dropdown, the phone's FontList): our curated reading fonts plus
 * plugin fonts — each downloaded and cached on demand the first time it is
 * chosen — or, with `custom` on, every font installed on this device.
 * Switching source is non-destructive: the current font stays until a new one
 * is picked. Also owns loading the chosen face, and reports the download and
 * device-list states a picker must show.
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
  // Open on the source the value came from. A null value belongs to the
  // curated list (that is where its "default" option lives), so it must not
  // read the `system:` placeholder above and open on Custom.
  const [custom, setCustom] = useState(value !== null && (isSystemFont(value) || isUserFont(value)));
  // Download + inject the active curated font so the preview/UI render it.
  const fontFace = useCuratedFontFace(loaded, fontWeight);
  // Plugin fonts need no download — inject their folder-served faces directly.
  usePluginFontFace(loaded);
  // Imported fonts point at the synced blob store — no download either.
  useUserFontFace(loaded);

  const systemOptions = useMemo(() => {
    const opts = systemFonts.map((family) => ({ value: toSystemFont(family), label: family }));
    // Keep the current pick visible before the list resolves, or if uninstalled.
    if (value && isSystemFont(value) && !opts.some((option) => option.value === value)) {
      opts.unshift({ value, label: systemFontFamily(value) ?? value });
    }
    return opts;
  }, [systemFonts, value]);

  /**
   * Imported fonts lead the custom list — they are the user's own picks,
   * named by the family the file declares (never the file name). The device
   * enumeration follows on desktop; on mobile it is simply absent.
   */
  const userOptions = useMemo(
    () =>
      userFonts.map((font) => ({
        value: toUserFont(font.id),
        label: font.name,
        font,
      })),
    [userFonts],
  );

  const customOptions = useMemo(() => [...userOptions, ...systemOptions], [userOptions, systemOptions]);

  // Plugin-bundled fonts share the curated dropdown (both are app-offered,
  // as opposed to the device-enumerated "custom" list).
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

  const options = custom ? customOptions : curatedOptions;
  // Reflect the value only when it belongs to the active source.
  const selectValue: string = custom
    ? value && (isSystemFont(value) || isUserFont(value))
      ? value
      : ""
    : value === null
      ? defaultLabel
        ? DEFAULT_OPTION
        : ""
      : curatedFontId(value) || isPluginFont(value)
        ? value
        : "";

  const choose = (next: string) =>
    // The union guarantees a null-accepting handler whenever the default
    // option can be picked, so the cast only widens for that caller.
    (onChange as (v: ReaderFontFamily | null) => void)(next === DEFAULT_OPTION ? null : (next as ReaderFontFamily));

  return {
    /** Listing imported + installed fonts rather than the curated set. */
    custom,
    setCustom,
    options,
    /** The option matching the value in the active source, or "" for none. */
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
