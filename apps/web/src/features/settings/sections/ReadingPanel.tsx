import { useAtom, useAtomValue } from "jotai";
import { ChoiceGroup, Stack, Toggle } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { pluginThemesAtom } from "../../plugins/state/plugin-store";
import { effectiveReaderSettingsAtom, pageTurnSettingsAtom, readerPreferencesAtom } from "../../../state/ui";
import { isAndroid } from "../../../platform/environment";
import { FontField } from "../components/FontField";
import { ReaderBackgroundLayer } from "../components/ReaderBackgroundLayer";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { getReaderPreviewStyle } from "../lib/reader-css";
import { resolveReaderFontWeight } from "../lib/reader-settings";
import { applyReaderThemeSelection, type ReaderPalette } from "../lib/reader-theme";
import type {
  PageTurnTapZoneWidth,
  PageTurnTapZones,
  VolumeKeyDirection,
} from "../../../domain/settings/page-turn-settings";
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
    <SettingsPage title={t("reading.title")} description={t("reading.description")}>
      {/* Live preview pinned to the top of the scroll area, so every control
          below shows its effect without scrolling back up. The negative margins
          bleed the opaque backdrop to the panel edges, covering controls that
          scroll underneath. */}
      <div className="sticky top-0 z-10 -mx-6 bg-[var(--ra-main-surface-color)] px-6 pb-4 sm:-mx-10 sm:px-10">
        <ReadingPreview
          palette={previewPalette}
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
            value={resolveReaderFontWeight(prefs.fontWeight, prefs.fontFamily)}
            options={fontWeightOptions(tReader, prefs.fontFamily)}
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

      <PageTurnGroup />

      <SettingsGroup title={t("reading.pageColor.title")} description={t("reading.pageColor.description")}>
        <ChoiceGroup
          value={prefs.theme}
          options={[...pageColorOptions(tReader), ...pluginThemeOptions]}
          onChange={(theme) => setPrefs(applyReaderThemeSelection(prefs, theme, pluginThemes))}
        />
      </SettingsGroup>
    </SettingsPage>
  );
}

/** Tap zones and volume keys: device-local input habits, never per book. */
function PageTurnGroup() {
  const { t } = useTranslation("settings");
  const [pageTurn, setPageTurn] = useAtom(pageTurnSettingsAtom);
  const tapZoneOptions: { value: PageTurnTapZones; label: string }[] = [
    { value: "off", label: t("reading.pageTurn.tapZones.off") },
    { value: "sides", label: t("reading.pageTurn.tapZones.sides") },
    { value: "forward", label: t("reading.pageTurn.tapZones.forward") },
  ];
  const tapZoneWidthOptions: { value: PageTurnTapZoneWidth; label: string }[] = [
    { value: "narrow", label: t("reading.pageTurn.tapZoneWidth.narrow") },
    { value: "medium", label: t("reading.pageTurn.tapZoneWidth.medium") },
    { value: "wide", label: t("reading.pageTurn.tapZoneWidth.wide") },
  ];
  const volumeKeyDirectionOptions: { value: VolumeKeyDirection; label: string }[] = [
    { value: "down-forward", label: t("reading.pageTurn.volumeKeyDirection.downForward") },
    { value: "up-forward", label: t("reading.pageTurn.volumeKeyDirection.upForward") },
  ];

  return (
    <SettingsGroup title={t("reading.pageTurn.title")} description={t("reading.pageTurn.description")}>
      <Stack gap="lg">
        <ChoiceGroup
          label={t("reading.pageTurn.tapZones.label")}
          value={pageTurn.tapZones}
          options={tapZoneOptions}
          onChange={(tapZones) => setPageTurn({ ...pageTurn, tapZones })}
        />
        <ChoiceGroup
          label={t("reading.pageTurn.tapZoneWidth.label")}
          value={pageTurn.tapZoneWidth}
          options={tapZoneWidthOptions}
          disabled={pageTurn.tapZones === "off"}
          onChange={(tapZoneWidth) => setPageTurn({ ...pageTurn, tapZoneWidth })}
        />
        {/* Only Android can capture the volume buttons. */}
        {isAndroid() && (
          <>
            <SettingsRow
              borderless
              className="py-0"
              title={t("reading.pageTurn.volumeKeys.title")}
              description={t("reading.pageTurn.volumeKeys.description")}
              control={
                <Toggle
                  aria-label={t("reading.pageTurn.volumeKeys.title")}
                  checked={pageTurn.volumeKeys}
                  onChange={(volumeKeys) => setPageTurn({ ...pageTurn, volumeKeys })}
                />
              }
            />
            <ChoiceGroup
              label={t("reading.pageTurn.volumeKeyDirection.label")}
              value={pageTurn.volumeKeyDirection}
              options={volumeKeyDirectionOptions}
              onChange={(volumeKeyDirection) => setPageTurn({ ...pageTurn, volumeKeyDirection })}
            />
          </>
        )}
      </Stack>
    </SettingsGroup>
  );
}

function ReadingPreview({ style, palette }: { style: React.CSSProperties; palette: ReaderPalette }) {
  const { t } = useTranslation("settings");
  return (
    <div className="overflow-hidden rounded-md border border-border" aria-label={t("reading.previewLabel")}>
      <div className="relative px-6 py-5 transition-colors" style={style}>
        <ReaderBackgroundLayer palette={palette} />
        <blockquote className="relative m-0">
          <p className="m-0">{t("reading.previewText")}</p>
          <p className="m-0" style={{ marginBlockStart: "var(--ra-reader-preview-paragraph-spacing)" }}>
            {t("reading.previewTextSecondary")}
          </p>
          <footer className="mt-3 font-sans text-caption leading-5 opacity-60">{t("reading.previewSource")}</footer>
        </blockquote>
      </div>
    </div>
  );
}
