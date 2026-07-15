import { useAtom, useAtomValue } from "jotai";
import { ChoiceGroup, Stack, Toggle } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import {
  effectiveReaderSettingsAtom,
  navigatorPrefsAtom,
  readerPreferencesAtom,
} from "../../../state/ui";
import { FontField } from "../components/FontField";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { getReaderPreviewStyle } from "../lib/reader-css";
import {
  fontSizeOptions,
  lineSpacingOptions,
  navigatorGranularityOptions,
  pageColorOptions,
  pageMarginsOptions,
  paragraphSpacingOptions,
  readingModeOptions,
} from "../lib/reader-setting-options";

export function ReadingPanel() {
  const { t } = useTranslation("settings");
  // Reader appearance option labels live in the `reader` namespace so this panel
  // and the in-reader appearance popover share one set of strings.
  const { t: tReader } = useTranslation("reader");
  const [prefs, setPrefs] = useAtom(readerPreferencesAtom);
  const [navigatorPrefs, setNavigatorPrefs] = useAtom(navigatorPrefsAtom);
  const effective = useAtomValue(effectiveReaderSettingsAtom);

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
        <ReadingPreview style={getReaderPreviewStyle(effective)} />
      </div>

      <SettingsGroup title={t("reading.typography")}>
        <Stack gap="lg">
          <FontField
            value={prefs.fontFamily}
            onChange={(fontFamily) => setPrefs({ ...prefs, fontFamily })}
          />
          <ChoiceGroup
            label={t("reading.fontSize")}
            value={prefs.fontSize}
            options={fontSizeOptions(tReader)}
            onChange={(fontSize) => setPrefs({ ...prefs, fontSize })}
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
          options={pageColorOptions(tReader)}
          onChange={(theme) => setPrefs({ ...prefs, theme })}
        />
      </SettingsGroup>

      <SettingsGroup
        title={t("reading.navigator.title")}
        description={t("reading.navigator.description")}
      >
        <Stack gap="lg">
          <ChoiceGroup
            label={t("reading.navigator.granularity")}
            value={navigatorPrefs.granularity}
            options={navigatorGranularityOptions(tReader)}
            onChange={(granularity) =>
              setNavigatorPrefs({ ...navigatorPrefs, granularity })
            }
          />
          <SettingsRow
            borderless
            title={t("reading.navigator.tapToAdvance.title")}
            description={t("reading.navigator.tapToAdvance.description")}
            control={
              <Toggle
                aria-label={t("reading.navigator.tapToAdvance.title")}
                checked={navigatorPrefs.tapToAdvance}
                onChange={(tapToAdvance) =>
                  setNavigatorPrefs({ ...navigatorPrefs, tapToAdvance })
                }
              />
            }
          />
        </Stack>
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
        <p style={{ margin: 0 }}>{t("reading.previewText")}</p>
      </div>
    </div>
  );
}
