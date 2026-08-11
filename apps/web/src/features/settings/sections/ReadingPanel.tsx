import { useAtom, useAtomValue } from "jotai";
import { ChoiceGroup, Stack } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { pluginThemesAtom } from "../../plugins/state/plugin-store";
import {
  effectiveReaderSettingsAtom,
  readerPreferencesAtom,
} from "../../../state/ui";
import { FontField } from "../components/FontField";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { getReaderPreviewStyle } from "../lib/reader-css";
import { applyReaderThemeSelection } from "../lib/reader-theme";
import { useReaderPalette } from "../hooks/useReaderPalette";
import { useRegisteredPluginFont } from "../hooks/usePluginFonts";
import { usePluginReaderThemeOptions } from "../hooks/usePluginReaderThemeOptions";
import {
  fontSizeOptions,
  fontWeightOptions,
  lineSpacingOptions,
  pageColorOptions,
  pageMarginsOptions,
  paragraphSpacingOptions,
  readingModeOptions,
  textAlignOptions,
} from "../lib/reader-setting-options";

export function ReadingPanel() {
  const { t } = useTranslation("settings");
  // Reader appearance option labels live in the `reader` namespace so this panel
  // and the in-reader appearance popover share one set of strings.
  const { t: tReader } = useTranslation("reader");
  const [prefs, setPrefs] = useAtom(readerPreferencesAtom);
  const effective = useAtomValue(effectiveReaderSettingsAtom);
  const pluginThemes = useAtomValue(pluginThemesAtom);
  const pluginThemeOptions = usePluginReaderThemeOptions();
  const previewPalette = useReaderPalette(effective.theme);
  const previewPluginFont = useRegisteredPluginFont(effective.fontFamily);

  return (
    <SettingsPage
      title={t("reading.title")}
      description={t("reading.description")}
    >
      {/* Live preview pinned to the top of the scroll area, so every control
          below shows its effect without scrolling back up. The negative margins
          bleed the opaque backdrop to the panel edges, covering controls that
          scroll underneath. */}
      <div className="sticky top-0 z-10 -mx-6 bg-[var(--ra-main-surface-color)] px-6 pb-4 sm:-mx-10 sm:px-10">
        <ReadingPreview
          style={getReaderPreviewStyle(effective, {
            palette: previewPalette,
            pluginFont: previewPluginFont,
          })}
        />
      </div>

      <SettingsGroup title={t("reading.typography")}>
        <Stack gap="lg">
          <FontField
            value={prefs.fontFamily}
            fontWeight={prefs.fontWeight}
            onChange={(fontFamily) => setPrefs({ ...prefs, fontFamily })}
          />
          <ChoiceGroup
            label={t("reading.fontSize")}
            value={prefs.fontSize}
            options={fontSizeOptions(tReader)}
            onChange={(fontSize) => setPrefs({ ...prefs, fontSize })}
          />
          <ChoiceGroup
            label={t("reading.fontWeight")}
            value={prefs.fontWeight}
            options={fontWeightOptions(tReader)}
            onChange={(fontWeight) => setPrefs({ ...prefs, fontWeight })}
          />
          <ChoiceGroup
            label={t("reading.lineSpacing")}
            value={prefs.lineSpacing}
            options={lineSpacingOptions(tReader)}
            onChange={(lineSpacing) => setPrefs({ ...prefs, lineSpacing })}
          />
          <ChoiceGroup
            label={t("reading.paragraphSpacing")}
            value={prefs.paragraphSpacing}
            options={paragraphSpacingOptions(tReader)}
            onChange={(paragraphSpacing) => setPrefs({ ...prefs, paragraphSpacing })}
          />
          <ChoiceGroup
            label={t("reading.textAlign")}
            value={prefs.textAlign}
            options={textAlignOptions(tReader)}
            onChange={(textAlign) => setPrefs({ ...prefs, textAlign })}
          />
        </Stack>
      </SettingsGroup>

      <SettingsGroup title={t("reading.layout")}>
        <Stack gap="lg">
          <ChoiceGroup
            label={t("reading.readingMode")}
            value={prefs.readingMode}
            options={readingModeOptions(tReader)}
            onChange={(readingMode) => setPrefs({ ...prefs, readingMode })}
          />
          <ChoiceGroup
            label={t("reading.pageMargins")}
            value={prefs.pageMargins}
            options={pageMarginsOptions(tReader)}
            onChange={(pageMargins) => setPrefs({ ...prefs, pageMargins })}
          />
        </Stack>
      </SettingsGroup>

      <SettingsGroup
        title={t("reading.pageColor.title")}
        description={t("reading.pageColor.description")}
      >
        <ChoiceGroup
          value={prefs.theme}
          options={[...pageColorOptions(tReader), ...pluginThemeOptions]}
          onChange={(theme) =>
            setPrefs(applyReaderThemeSelection(prefs, theme, pluginThemes))
          }
        />
      </SettingsGroup>

    </SettingsPage>
  );
}

function ReadingPreview({ style }: { style: React.CSSProperties }) {
  const { t } = useTranslation("settings");
  return (
    <div
      className="overflow-hidden rounded-md border border-border"
      aria-label={t("reading.previewLabel")}
    >
      <div className="px-6 py-5 transition-colors" style={style}>
        <blockquote className="m-0">
          <p className="m-0">{t("reading.previewText")}</p>
          <p
            className="m-0"
            style={{ marginBlockStart: "var(--ra-reader-preview-paragraph-spacing)" }}
          >
            {t("reading.previewTextSecondary")}
          </p>
          <footer className="mt-3 font-sans text-caption leading-5 opacity-60">
            {t("reading.previewSource")}
          </footer>
        </blockquote>
      </div>
    </div>
  );
}
