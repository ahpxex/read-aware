import { useMemo, useState } from "react";
import { Button, Caption, Select, Spinner, Toggle } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import {
  curatedFontId,
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

const CURATED_OPTIONS: { value: string; label: string }[] = CURATED_FONTS.map((font) => ({
  value: toCuratedFont(font.id),
  label: font.label,
}));

type FontFieldProps = {
  value: ReaderFontFamily;
  onChange: (value: ReaderFontFamily) => void;
  /** Active weight preset — decides which weights the curated download fetches. */
  fontWeight?: ReaderFontWeight;
  className?: string;
};

/**
 * Reader body-font picker. A single dropdown lists our curated reading fonts —
 * each downloaded + cached on demand the first time it's chosen. Flip the
 * "Custom" switch and the dropdown instead enumerates every font installed on
 * this device. Switching source is non-destructive: the current font stays until
 * a new one is picked. Shared by the Reading panel and the in-reader popover.
 */
export function FontField({ value, onChange, fontWeight, className }: FontFieldProps) {
  const { t } = useTranslation("settings");
  const systemFonts = useSystemFonts();
  const [custom, setCustom] = useState(isSystemFont(value));
  // Download + inject the active curated font so the preview/UI render it.
  const fontFace = useCuratedFontFace(value, fontWeight);

  const systemOptions = useMemo(() => {
    const opts = systemFonts.map((family) => ({ value: toSystemFont(family), label: family }));
    // Keep the current pick visible before the list resolves, or if uninstalled.
    if (isSystemFont(value) && !opts.some((option) => option.value === value)) {
      opts.unshift({ value, label: systemFontFamily(value) ?? value });
    }
    return opts;
  }, [systemFonts, value]);

  const options = custom ? systemOptions : CURATED_OPTIONS;
  // Reflect the value only when it belongs to the active source.
  const selectValue: string = custom
    ? isSystemFont(value)
      ? value
      : ""
    : curatedFontId(value)
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
        onChange={(next) => onChange(next as ReaderFontFamily)}
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
