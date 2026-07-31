import { useAtom, useAtomValue } from "jotai";
import { ChoiceGroup, Toggle } from "@read-aware/ui";
import { appSettingsAtom } from "../../../state/ui";
import { useTranslation } from "../../../i18n";
import { contributionText } from "../../plugins/lib/plugin-i18n";
import { toPluginRef } from "../../plugins/lib/plugin-theme";
import { pluginThemesAtom } from "../../plugins/state/plugin-store";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import type { AppThemePreference } from "../lib/app-settings";

const THEME_VALUES = ["system", "light", "dark"] as const;

export function AppearancePanel() {
  const { t } = useTranslation("settings");
  const [settings, setSettings] = useAtom(appSettingsAtom);
  const pluginThemes = useAtomValue(pluginThemesAtom);

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
