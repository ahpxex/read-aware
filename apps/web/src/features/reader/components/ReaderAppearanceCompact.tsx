import { useState, type ReactNode } from "react";
import { CaretLeft } from "@phosphor-icons/react";
import { useAtomValue } from "jotai";
import { Caption, ChoiceGroup, IconButton, ItemList, Stepper, SwatchGroup, Toggle } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import {
  fixedLayoutColorOptions,
  fontSizeOptions,
  fontWeightOptions,
  lineSpacingOptions,
  pageColorOptions,
  pageMarginsOptions,
  paragraphSpacingOptions,
  readingModeOptions,
  textAlignOptions,
} from "../../settings/lib/reader-setting-options";
import { applyReaderThemeSelection, readerThemeSwatch } from "../../settings/lib/reader-theme";
import { resolveReaderFontWeight } from "../../settings/lib/reader-settings";
import { readerFontLabel } from "../../settings/lib/reader-font-label";
import { usePluginReaderThemeOptions } from "../../settings/hooks/usePluginReaderThemeOptions";
import { pluginFontsAtom, pluginThemesAtom } from "../../plugins/state/plugin-store";
import { userFontsAtom } from "../../settings";
import { FontList } from "../../settings/components/FontList";
import { useReaderAppearance } from "../hooks/useReaderAppearance";
import { FixedLayoutFitChoice } from "./FixedLayoutZoomControls";

type ReaderAppearanceCompactProps = {
  bookId: string;
  /** Fixed-layout books keep only the controls that still do visible work (see ReaderAppearanceFields). */
  fixedLayout?: boolean;
};

type Page = "main" | "font" | "layout";

/**
 * The phone's appearance controls, in the bottom bar's drawer. Same settings
 * and option lists as ReaderAppearanceFields (the desktop popover and the
 * Settings page), arranged for a thumb and a short sheet:
 *
 * - text size and page color, what people change mid-chapter, lead as a
 *   stepper and a row of swatches;
 * - below them, one line per remaining setting, as in a phone's own settings:
 *   reading mode inline, the font and the finer typography as pages that
 *   open in place (with a way back), and applying to this book as a switch.
 *
 * Every line keeps one height and one type size, so the sheet reads as a
 * list rather than a stack of differently shaped forms.
 */
export function ReaderAppearanceCompact({ bookId, fixedLayout = false }: ReaderAppearanceCompactProps) {
  const { t } = useTranslation(["reader", "settings"]);
  const { scope, prefs, setScope, updatePrefs } = useReaderAppearance(bookId);
  const pluginThemes = useAtomValue(pluginThemesAtom);
  const pluginFonts = useAtomValue(pluginFontsAtom);
  const userFonts = useAtomValue(userFontsAtom);
  const pluginThemeOptions = usePluginReaderThemeOptions();
  const [page, setPage] = useState<Page>("main");

  if (page === "font") {
    return (
      <Subpage title={t("settings:font.label")} backLabel={t("readingAppearance")} onBack={() => setPage("main")}>
        <FontList
          value={prefs.fontFamily}
          fontWeight={prefs.fontWeight}
          onChange={(fontFamily) => updatePrefs({ ...prefs, fontFamily })}
          className="-mx-2"
        />
      </Subpage>
    );
  }
  if (page === "layout") {
    return (
      <Subpage title={t("appearanceMoreLayout")} backLabel={t("readingAppearance")} onBack={() => setPage("main")}>
        <div className="flex flex-col gap-5">
          <ChoiceGroup
            label={t("fontWeight")}
            value={resolveReaderFontWeight(prefs.fontWeight, prefs.fontFamily)}
            options={fontWeightOptions(t, prefs.fontFamily)}
            onChange={(fontWeight) => updatePrefs({ ...prefs, fontWeight })}
          />
          <ChoiceGroup
            label={t("lineSpacing")}
            value={prefs.lineSpacing}
            options={lineSpacingOptions(t)}
            onChange={(lineSpacing) => updatePrefs({ ...prefs, lineSpacing })}
          />
          <ChoiceGroup
            label={t("paragraphSpacing")}
            value={prefs.paragraphSpacing}
            options={paragraphSpacingOptions(t)}
            onChange={(paragraphSpacing) => updatePrefs({ ...prefs, paragraphSpacing })}
          />
          <ChoiceGroup
            label={t("textAlign")}
            value={prefs.textAlign}
            options={textAlignOptions(t)}
            onChange={(textAlign) => updatePrefs({ ...prefs, textAlign })}
          />
          <ChoiceGroup
            label={t("pageMargins")}
            value={prefs.pageMargins}
            options={pageMarginsOptions(t)}
            onChange={(pageMargins) => updatePrefs({ ...prefs, pageMargins })}
          />
        </div>
      </Subpage>
    );
  }

  const sizes = fontSizeOptions(t);
  const sizeIndex = Math.max(
    0,
    sizes.findIndex((option) => option.value === prefs.fontSize),
  );
  const stepSize = (by: number) => {
    const next = sizes[sizeIndex + by];
    if (next) updatePrefs({ ...prefs, fontSize: next.value });
  };
  const swatches = [...pageColorOptions(t), ...pluginThemeOptions].map((option) => ({
    ...option,
    ...readerThemeSwatch(option.value, pluginThemes),
  }));

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-4 px-4 pb-4">
        {!fixedLayout && (
          <Stepper
            label={t("fontSize")}
            valueText={sizes[sizeIndex]?.label ?? ""}
            canDecrement={sizeIndex > 0}
            canIncrement={sizeIndex < sizes.length - 1}
            onDecrement={() => stepSize(-1)}
            onIncrement={() => stepSize(1)}
            decrementLabel={t("fontSizeSmaller")}
            incrementLabel={t("fontSizeLarger")}
            decrementIcon={
              <span aria-hidden="true" className="font-serif text-[15px] leading-none">
                A
              </span>
            }
            incrementIcon={
              <span aria-hidden="true" className="font-serif text-[22px] leading-none">
                A
              </span>
            }
          />
        )}
        <SwatchGroup
          ariaLabel={t("pageColor")}
          showLabels={false}
          spread
          value={prefs.theme}
          options={swatches}
          onChange={(theme) => updatePrefs(applyReaderThemeSelection(prefs, theme, pluginThemes))}
        />
      </div>

      <ItemList className="border-t border-border/60 px-2">
        <ItemList.Item
          title={t("readingMode")}
          disclosure="none"
          accessories={
            // Fixed-layout books read on their own mode axis (see ReaderAppearanceFields).
            <ChoiceGroup
              ariaLabel={t("readingMode")}
              value={fixedLayout ? prefs.fixedLayoutReadingMode : prefs.readingMode}
              options={readingModeOptions(t)}
              onChange={(mode) =>
                updatePrefs(fixedLayout ? { ...prefs, fixedLayoutReadingMode: mode } : { ...prefs, readingMode: mode })
              }
              className="pt-1.5 [&>div]:gap-x-4"
            />
          }
        />
        {fixedLayout ? (
          <>
            <ItemList.Item
              title={t("pageFit")}
              subtitle={t("pageZoomHint")}
              disclosure="none"
              accessories={
                <FixedLayoutFitChoice
                  bookId={bookId}
                  scrolled={prefs.fixedLayoutReadingMode === "scroll"}
                  inline
                  className="pt-1.5 [&>div]:gap-x-4"
                />
              }
            />
            <ItemList.Item
              title={t("fixedLayoutColor")}
              disclosure="none"
              accessories={
                <ChoiceGroup
                  ariaLabel={t("fixedLayoutColor")}
                  value={prefs.fixedLayoutColor}
                  options={fixedLayoutColorOptions(t)}
                  onChange={(fixedLayoutColor) => updatePrefs({ ...prefs, fixedLayoutColor })}
                  className="pt-1.5 [&>div]:gap-x-4"
                />
              }
            />
          </>
        ) : (
          <>
            <ItemList.Item
              title={t("settings:font.label")}
              accessories={
                <span className="max-w-[10rem] truncate font-sans text-sm text-fg-subtle">
                  {readerFontLabel(prefs.fontFamily, pluginFonts, userFonts)}
                </span>
              }
              onClick={() => setPage("font")}
            />
            <ItemList.Item title={t("appearanceMoreLayout")} onClick={() => setPage("layout")} />
          </>
        )}
        <ItemList.Item
          title={t("scopeBookOnly")}
          subtitle={scope === "book" ? t("scopeHintBook") : undefined}
          disclosure="none"
          accessories={
            <Toggle
              aria-label={t("scopeBookOnly")}
              checked={scope === "book"}
              onChange={(bookOnly) => setScope(bookOnly ? "book" : "global")}
            />
          }
        />
      </ItemList>
      {fixedLayout && <Caption className="block px-4 pt-2 text-fg-subtle">{t("fixedLayoutHint")}</Caption>}
    </div>
  );
}

/** A page opened from a line of the main list, with its way back. */
function Subpage({
  title,
  backLabel,
  onBack,
  children,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-2 pb-2">
        <IconButton label={backLabel} onClick={onBack} icon={<CaretLeft size={18} aria-hidden="true" />} />
        <span className="font-sans text-sm font-medium text-fg">{title}</span>
      </div>
      <div className="px-4 pb-4">{children}</div>
    </div>
  );
}
