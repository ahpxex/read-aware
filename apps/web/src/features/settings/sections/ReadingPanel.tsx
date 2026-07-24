import { useAtom, useAtomValue } from "jotai";
import { ChoiceGroup, Stack, Toggle } from "@read-aware/ui";
import { useLocale, useTranslation } from "../../../i18n";
import { resolvePluginText } from "../../plugins/lib/plugin-i18n";
import { resolveReaderModeUnit } from "../../plugins/lib/reader-mode";
import { textUnitReaderModeAtom } from "../../plugins/state/plugin-store";
import { preferredTextUnitModeUnitId } from "../../reader/lib/text-unit-mode-state";
import {
  effectiveReaderSettingsAtom,
  textUnitModePrefsAtom,
  readerPreferencesAtom,
} from "../../../state/ui";
import { FontField } from "../components/FontField";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { getReaderPreviewStyle } from "../lib/reader-css";
import {
  fontSizeOptions,
  fontWeightOptions,
  lineSpacingOptions,
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
  const locale = useLocale();
  const [prefs, setPrefs] = useAtom(readerPreferencesAtom);
  const [modePrefs, setModePrefs] = useAtom(textUnitModePrefsAtom);
  const effective = useAtomValue(effectiveReaderSettingsAtom);
  const textUnitMode = useAtomValue(textUnitReaderModeAtom);

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

      {textUnitMode && (
        <SettingsGroup
          title={resolvePluginText(textUnitMode.copy.title, locale)}
          description={resolvePluginText(textUnitMode.copy.settings.description, locale)}
        >
          <Stack gap="lg">
            <ChoiceGroup
              label={resolvePluginText(textUnitMode.copy.settings.unitLabel, locale)}
              value={resolveReaderModeUnit(
                textUnitMode,
                preferredTextUnitModeUnitId(modePrefs, textUnitMode.key),
              ).id}
              options={textUnitMode.units.map((unit) => ({
                value: unit.id,
                label: resolvePluginText(unit.label, locale),
              }))}
              onChange={(unitId) =>
                setModePrefs({ ...modePrefs, modeKey: textUnitMode.key, unitId })
              }
            />
            <SettingsRow
              borderless
              title={resolvePluginText(
                textUnitMode.copy.settings.tapToAdvance.title,
                locale,
              )}
              description={resolvePluginText(
                textUnitMode.copy.settings.tapToAdvance.description,
                locale,
              )}
              control={
                <Toggle
                  aria-label={resolvePluginText(
                    textUnitMode.copy.settings.tapToAdvance.title,
                    locale,
                  )}
                  checked={modePrefs.tapToAdvance}
                  onChange={(tapToAdvance) =>
                    setModePrefs({ ...modePrefs, tapToAdvance })
                  }
                />
              }
            />
            <SettingsRow
              title={resolvePluginText(
                textUnitMode.copy.settings.scrollToStep.title,
                locale,
              )}
              description={resolvePluginText(
                textUnitMode.copy.settings.scrollToStep.description,
                locale,
              )}
              control={
                <Toggle
                  aria-label={resolvePluginText(
                    textUnitMode.copy.settings.scrollToStep.title,
                    locale,
                  )}
                  checked={modePrefs.scrollToStep}
                  onChange={(scrollToStep) =>
                    setModePrefs({ ...modePrefs, scrollToStep })
                  }
                />
              }
            />
          </Stack>
        </SettingsGroup>
      )}
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
