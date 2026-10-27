import { Caption, ChoiceGroup, Slider, Toggle } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import {
  customTypographyFromPresets,
  READER_CUSTOM_TYPOGRAPHY_LIMITS,
  resolveReaderFontWeight,
  type ReaderCustomTypography,
  type ReaderSettingsPreferences,
} from "../lib/reader-settings";
import {
  customTextIndentOptions,
  fontSizeOptions,
  fontWeightOptions,
  lineSpacingOptions,
  pageMarginsOptions,
  paragraphSpacingOptions,
  textAlignOptions,
  textIndentOptions,
} from "../lib/reader-setting-options";

type ReaderTypographyControlsProps = {
  prefs: ReaderSettingsPreferences;
  onChange: (next: ReaderSettingsPreferences) => void;
  /** False on the compact drawer, whose main page steps the size instead. */
  showFontSize?: boolean;
};

/**
 * The shared reader typography block — preset tiers or exact values behind
 * one toggle. Render-only: every surface (the in-reader popover, the compact
 * drawer, Settings → Reading) binds it to its own preferences write.
 */
export function ReaderTypographyControls({ prefs, onChange, showFontSize = true }: ReaderTypographyControlsProps) {
  const { t } = useTranslation("reader");
  const custom = prefs.typographyMode === "custom";
  // Resolved values: stored numbers while present, else seeded from the live
  // presets — switching modes never moves the text, and writing a custom
  // value before the object exists seeds it rather than dropping the write.
  const values = prefs.customTypography ?? customTypographyFromPresets(prefs);
  const setCustom = (patch: Partial<ReaderCustomTypography>) =>
    onChange({ ...prefs, customTypography: { ...values, ...patch } });
  const setMode = (on: boolean) =>
    onChange({
      ...prefs,
      typographyMode: on ? "custom" : "preset",
      ...(on && !prefs.customTypography ? { customTypography: customTypographyFromPresets(prefs) } : {}),
    });
  const limits = READER_CUSTOM_TYPOGRAPHY_LIMITS;

  // Choice groups stay grouped ahead of sliders in either mode, so the shared
  // ones are elements reused across both branches rather than duplicated JSX.
  const fontWeightChoice = (
    <ChoiceGroup
      label={t("fontWeight")}
      value={resolveReaderFontWeight(prefs.fontWeight, prefs.fontFamily)}
      options={fontWeightOptions(t, prefs.fontFamily)}
      onChange={(fontWeight) => onChange({ ...prefs, fontWeight })}
    />
  );
  const textAlignChoice = (
    <ChoiceGroup
      label={t("textAlign")}
      value={prefs.textAlign}
      options={textAlignOptions(t)}
      onChange={(textAlign) => onChange({ ...prefs, textAlign })}
    />
  );

  return (
    <>
      <div>
        <div className="flex items-center justify-between gap-3">
          <span className="font-sans text-[13px] font-medium text-fg-muted">{t("typographyAdvanced")}</span>
          <Toggle aria-label={t("typographyAdvanced")} checked={custom} onChange={setMode} />
        </div>
        <Caption className="mt-1.5 block text-fg-subtle">
          {t(custom ? "typographyAdvancedHintCustom" : "typographyAdvancedHintPreset")}
        </Caption>
      </div>
      {custom ? (
        <>
          {fontWeightChoice}
          {textAlignChoice}
          <ChoiceGroup
            label={t("textIndent")}
            value={values.textIndentEm === null ? "book" : "custom"}
            options={customTextIndentOptions(t)}
            onChange={(choice) => setCustom({ textIndentEm: choice === "book" ? null : (values.textIndentEm ?? 2) })}
          />
          {showFontSize && (
            <Slider
              label={t("fontSize")}
              value={values.fontSizePx}
              min={limits.fontSizePx.min}
              max={limits.fontSizePx.max}
              step={limits.fontSizePx.step}
              onChange={(fontSizePx) => setCustom({ fontSizePx })}
              formatValue={(value) => t("fontSizeValue", { value })}
            />
          )}
          <Slider
            label={t("lineSpacing")}
            value={values.lineHeight}
            min={limits.lineHeight.min}
            max={limits.lineHeight.max}
            step={limits.lineHeight.step}
            onChange={(lineHeight) => setCustom({ lineHeight })}
            formatValue={(value) => value.toFixed(2)}
          />
          <Slider
            label={t("paragraphSpacing")}
            value={values.paragraphSpacingEm}
            min={limits.paragraphSpacingEm.min}
            max={limits.paragraphSpacingEm.max}
            step={limits.paragraphSpacingEm.step}
            onChange={(paragraphSpacingEm) => setCustom({ paragraphSpacingEm })}
            formatValue={(value) => t("emValue", { value })}
          />
          {values.textIndentEm !== null && (
            <Slider
              label={t("textIndentAmount")}
              value={values.textIndentEm}
              min={limits.textIndentEm.min}
              max={limits.textIndentEm.max}
              step={limits.textIndentEm.step}
              onChange={(textIndentEm) => setCustom({ textIndentEm })}
              formatValue={(value) => t("indentValue", { value })}
            />
          )}
          <Slider
            label={t("pageMargins")}
            value={values.pageMarginPercent}
            min={limits.pageMarginPercent.min}
            max={limits.pageMarginPercent.max}
            step={limits.pageMarginPercent.step}
            onChange={(pageMarginPercent) => setCustom({ pageMarginPercent })}
            formatValue={(value) => t("percentValue", { value })}
          />
        </>
      ) : (
        <>
          {showFontSize && (
            <ChoiceGroup
              label={t("fontSize")}
              value={prefs.fontSize}
              options={fontSizeOptions(t)}
              onChange={(fontSize) => onChange({ ...prefs, fontSize })}
            />
          )}
          {fontWeightChoice}
          <ChoiceGroup
            label={t("lineSpacing")}
            value={prefs.lineSpacing}
            options={lineSpacingOptions(t)}
            onChange={(lineSpacing) => onChange({ ...prefs, lineSpacing })}
          />
          <ChoiceGroup
            label={t("paragraphSpacing")}
            value={prefs.paragraphSpacing}
            options={paragraphSpacingOptions(t)}
            onChange={(paragraphSpacing) => onChange({ ...prefs, paragraphSpacing })}
          />
          <ChoiceGroup
            label={t("textIndent")}
            value={prefs.textIndent}
            options={textIndentOptions(t)}
            onChange={(textIndent) => onChange({ ...prefs, textIndent })}
          />
          {textAlignChoice}
          <ChoiceGroup
            label={t("pageMargins")}
            value={prefs.pageMargins}
            options={pageMarginsOptions(t)}
            onChange={(pageMargins) => onChange({ ...prefs, pageMargins })}
          />
        </>
      )}
    </>
  );
}
