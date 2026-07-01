import { useMemo, useState } from "react";
import { Select, Toggle } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { useTranslation } from "../../../i18n";
import {
  curatedFontId,
  isSystemFont,
  systemFontFamily,
  toCuratedFont,
  toSystemFont,
  type ReaderFontFamily,
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
  className?: string;
};

/**
 * Reader body-font picker. A single dropdown lists our curated reading fonts —
 * each downloaded + cached on demand the first time it's chosen. Flip the
 * "Custom" switch and the dropdown instead enumerates every font installed on
 * this device. Switching source is non-destructive: the current font stays until
 * a new one is picked. Shared by the Reading panel and the in-reader popover.
 */
export function FontField({ value, onChange, className }: FontFieldProps) {
  const { t } = useTranslation("settings");
  const systemFonts = useSystemFonts();
  const [custom, setCustom] = useState(isSystemFont(value));
  // Download + inject the active curated font so the preview/UI render it.
  useCuratedFontFace(value);

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
    </div>
  );
}
