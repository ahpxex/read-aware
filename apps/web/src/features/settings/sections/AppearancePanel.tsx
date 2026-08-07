import { useAtom, useAtomValue } from "jotai";
import { ChoiceGroup, Stack, Toggle } from "@read-aware/ui";
import { appSettingsAtom, contentTypographyAtom } from "../../../state/ui";
import { useTranslation } from "../../../i18n";
import { contributionText } from "../../plugins/lib/plugin-i18n";
import { toPluginRef } from "../../plugins/lib/plugin-theme";
import { pluginThemesAtom } from "../../plugins/state/plugin-store";
import { FontField } from "../components/FontField";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import type { AppThemePreference } from "../lib/app-settings";
import { CONTENT_FONT_SIZES, type ContentFontSize } from "../lib/content-typography";
import type { ReaderFontFamily, ReaderLineSpacing } from "../lib/reader-settings";
import { ContentTypographyPreview } from "../components/ContentTypographyPreview";

const THEME_VALUES = ["system", "light", "dark"] as const;
const LINE_SPACINGS = ["compact", "comfortable", "relaxed"] as const;

export function AppearancePanel() {
  const { t } = useTranslation("settings");
  const { t: tReader } = useTranslation("reader");
  const [settings, setSettings] = useAtom(appSettingsAtom);
  const [content, setContent] = useAtom(contentTypographyAtom);
  const pluginThemes = useAtomValue(pluginThemesAtom);

  const contentSizeOptions: { value: ContentFontSize; label: string }[] =
    CONTENT_FONT_SIZES.map((value) => ({ value, label: tReader(`fontSizeOption.${value}`) }));
  const contentSpacingOptions: { value: ReaderLineSpacing; label: string }[] =
    LINE_SPACINGS.map((value) => ({ value, label: tReader(`lineSpacingOption.${value}`) }));

  const themeOptions: { value: AppThemePreference; label: string }[] = [
    ...THEME_VALUES.map((value) => ({
      value,
      label: t(`appearance.themeOptions.${value}`),
    })),
    // Plugin skins (ui:themes contributions with an app part) join the fixed
    // choices; their labels are plugin-owned copy, not catalog strings.
    ...pluginThemes
      .filter((theme) => theme.app)
      .map((theme) => ({
        value: toPluginRef(theme.pluginId, theme.id) as AppThemePreference,
        label: contributionText(theme.name),
      })),
  ];

  return (
    <SettingsPage
      title={t("appearance.title")}
      description={t("appearance.description")}
    >
      <SettingsGroup
        title={t("appearance.theme.title")}
        description={t("appearance.theme.description")}
      >
        <ChoiceGroup
          value={settings.theme}
          options={themeOptions}
          onChange={(theme) => setSettings({ ...settings, theme })}
        />
      </SettingsGroup>

      {/* Content typography — the chat transcript, notes, and plugin markdown.
          Deliberately not the chrome: nav, buttons, and labels keep their own
          scale so a larger reading size never reflows the furniture. */}
      <SettingsGroup
        title={t("appearance.contentType.title")}
        description={t("appearance.contentType.description")}
      >
        <Stack gap="lg">
          <ContentTypographyPreview />
          <SettingsRow
            borderless
            title={t("appearance.contentType.follow.title")}
            description={t("appearance.contentType.follow.description")}
            control={
              <Toggle
                aria-label={t("appearance.contentType.follow.title")}
                checked={content.followReader}
                onChange={(followReader) => setContent({ ...content, followReader })}
              />
            }
          />
          {/* The detached controls are absent, not disabled, while following:
              a row of dead options invites clicks that do nothing. */}
          {!content.followReader && (
            <>
              <FontField
                value={content.fontFamily}
                defaultLabel={t("appearance.contentType.appDefaultFont")}
                onChange={(fontFamily: ReaderFontFamily | null) =>
                  setContent({ ...content, fontFamily })
                }
              />
              <ChoiceGroup
                label={t("appearance.contentType.fontSize")}
                value={content.fontSize}
                options={contentSizeOptions}
                onChange={(fontSize) => setContent({ ...content, fontSize })}
              />
              <ChoiceGroup
                label={t("appearance.contentType.lineSpacing")}
                value={content.lineSpacing}
                options={contentSpacingOptions}
                onChange={(lineSpacing) => setContent({ ...content, lineSpacing })}
              />
            </>
          )}
        </Stack>
      </SettingsGroup>

      <SettingsGroup title={t("appearance.motion")}>
        <SettingsRow
          borderless
          title={t("appearance.reduceMotion.title")}
          description={t("appearance.reduceMotion.description")}
          control={
            <Toggle
              aria-label={t("appearance.reduceMotion.title")}
              checked={settings.motion === "reduced"}
              onChange={(reduced) =>
                setSettings({ ...settings, motion: reduced ? "reduced" : "system" })
              }
            />
          }
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
