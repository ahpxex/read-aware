import { useAtom } from "jotai";
import { ChoiceGroup, Toggle } from "@read-aware/ui";
import { appSettingsAtom } from "../../../state/ui";
import { useTranslation } from "../../../i18n";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import type { AppThemePreference } from "../lib/app-settings";

const THEME_VALUES: AppThemePreference[] = ["system", "light", "dark"];

export function AppearancePanel() {
  const { t } = useTranslation("settings");
  const [settings, setSettings] = useAtom(appSettingsAtom);

  const themeOptions = THEME_VALUES.map((value) => ({
    value,
    label: t(`appearance.themeOptions.${value}`),
  }));

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
