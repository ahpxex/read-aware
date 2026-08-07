import { useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { Button, Caption, Select, Spinner, Toggle } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import {
  curatedFontId,
  isPluginFont,
  isSystemFont,
  systemFontFamily,
  toCuratedFont,
  toSystemFont,
  type ReaderFontFamily,
  type ReaderFontWeight,
} from "../lib/reader-settings";
import { CURATED_FONTS } from "../lib/curated-fonts";
import { useSystemFonts } from "../hooks/useSystemFonts";
import { useCuratedFontFace } from "../hooks/useCuratedFontFace";
import { usePluginFontFace } from "../hooks/usePluginFonts";
import { toPluginRef, parsePluginRef } from "../../plugins/lib/plugin-theme";
import { pluginFontsAtom } from "../../plugins/state/plugin-store";

const CURATED_OPTIONS: { value: string; label: string }[] = CURATED_FONTS.map((font) => ({
  value: toCuratedFont(font.id),
  label: font.label,
}));

/**
 * `defaultLabel` opts a caller into a null selection — the leading choice in
 * the curated list, meaning "whatever this surface uses by default". Content
 * typography needs it (its default is the app's bundled sans, which must not
 * become a curated download just to be nameable); the reader has no such
 * state, so the union keeps null out of its `onChange` entirely.
 */
type FontFieldProps = {
  /** Active weight preset — decides which weights the curated download fetches. */
  fontWeight?: ReaderFontWeight;
  className?: string;
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

/** Stands in for a null selection while the loaders run — owned by neither. */
const NO_FONT = "system:" as ReaderFontFamily;

/** Select value for the null choice. Not a valid font ref, so it cannot collide. */
const DEFAULT_OPTION = "\u0000default";

/**
 * Body-font picker. A single dropdown lists our curated reading fonts — each
 * downloaded + cached on demand the first time it's chosen. Flip the "Custom"
 * switch and the dropdown instead enumerates every font installed on this
 * device. Switching source is non-destructive: the current font stays until a
 * new one is picked. Shared by the Reading panel, the in-reader popover, and
 * the content typography controls.
 */
export function FontField({
  value,
  onChange,
  defaultLabel,
  fontWeight,
  className,
}: FontFieldProps) {
  const { t } = useTranslation("settings");
  const systemFonts = useSystemFonts();
  const pluginFonts = useAtomValue(pluginFontsAtom);
  // A null value is the surface's own default — neither loader owns it.
  const loaded = value ?? NO_FONT;
  // Open on the source the value came from. A null value belongs to the
  // curated list (that is where its "default" option lives), so it must not
  // read the `system:` placeholder above and open on Custom.
  const [custom, setCustom] = useState(value !== null && isSystemFont(value));
  // Download + inject the active curated font so the preview/UI render it.
  const fontFace = useCuratedFontFace(loaded, fontWeight);
  // Plugin fonts need no download — inject their folder-served faces directly.
  usePluginFontFace(loaded);

  const systemOptions = useMemo(() => {
    const opts = systemFonts.map((family) => ({ value: toSystemFont(family), label: family }));
    // Keep the current pick visible before the list resolves, or if uninstalled.
    if (value && isSystemFont(value) && !opts.some((option) => option.value === value)) {
      opts.unshift({ value, label: systemFontFamily(value) ?? value });
    }
    return opts;
  }, [systemFonts, value]);

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

  const options = custom ? systemOptions : curatedOptions;
  // Reflect the value only when it belongs to the active source.
  const selectValue: string = custom
    ? value && isSystemFont(value)
      ? value
      : ""
    : value === null
      ? defaultLabel
        ? DEFAULT_OPTION
        : ""
      : curatedFontId(value) || isPluginFont(value)
        ? value
        : "";

  return (
    <div className={cn("relative", className)}>
      <label className="absolute right-0 top-0 z-[1] inline-flex cursor-pointer items-center gap-2">
        <span className="font-sans text-[13px] text-fg-muted">{t("font.custom")}</span>
        <Toggle
          aria-label={t("font.customAria")}
          checked={custom}
          onChange={setCustom}
        />
      </label>
      <Select
        label={t("font.label")}
        value={selectValue}
        options={options}
        placeholder={custom ? t("font.placeholderCustom") : t("font.placeholderCurated")}
        onChange={(next) =>
          // The union guarantees a null-accepting handler whenever the default
          // option can be picked, so the cast only widens for that caller.
          (onChange as (v: ReaderFontFamily | null) => void)(
            next === DEFAULT_OPTION ? null : (next as ReaderFontFamily),
          )
        }
      />
      {/* Download feedback for curated fonts — fetched from a CDN on first use,
          which can be slow or unreachable; silence here read as a broken picker. */}
      {fontFace.status === "loading" && (
        <div className="mt-1.5 flex items-center gap-2 text-fg-muted">
          <Spinner size="sm" className="h-3 w-3" />
          <Caption>
            {t("font.downloading", { percent: Math.round(fontFace.progress * 100) })}
          </Caption>
        </div>
      )}
      {fontFace.status === "error" && (
        <div className="mt-1.5 flex items-center gap-2">
          <Caption className="text-red-800">{t("font.downloadFailed")}</Caption>
          <Button size="sm" variant="link" onClick={fontFace.retry}>
            {t("font.retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
