import { useAtom } from "jotai";
import { ChoiceGroup, Select, Toggle } from "@read-aware/ui";
import { generalSettingsAtom } from "../../../state/ui";
import { LOCALES, LOCALE_LABELS, setLocale, useLocale, useTranslation } from "../../../i18n";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import type { StartView } from "../lib/general-settings";

const START_VIEW_VALUES: StartView[] = ["shelf", "resume"];

const LANGUAGE_OPTIONS = LOCALES.map((locale) => ({
  value: locale,
  label: LOCALE_LABELS[locale],
}));

export function GeneralPanel() {
  const { t } = useTranslation("settings");
  const [settings, setSettings] = useAtom(generalSettingsAtom);
  const activeLocale = useLocale();

  const startViewOptions = START_VIEW_VALUES.map((value) => ({
    value,
    label: t(`general.startViewOptions.${value}`),
  }));

  return (
    <SettingsPage
      title={t("general.title")}
      description={t("general.description")}
    >
      <SettingsGroup title={t("general.onLaunch")}>
        <ChoiceGroup
          label={t("general.startView")}
          value={settings.startView}
          options={startViewOptions}
          onChange={(startView) => setSettings({ ...settings, startView })}
        />
      </SettingsGroup>

      <SettingsGroup
        title={t("general.desktopIntegration.title")}
        description={t("general.desktopIntegration.description")}
      >
        <SettingsRow
          borderless
          title={t("general.desktopIntegration.launchAtStartup.title")}
          description={t("general.desktopIntegration.launchAtStartup.description")}
          control={
            <Toggle
              aria-label={t("general.desktopIntegration.launchAtStartup.title")}
              checked={settings.launchAtStartup}
              onChange={(launchAtStartup) => setSettings({ ...settings, launchAtStartup })}
            />
          }
        />
        <SettingsRow
          title={t("general.desktopIntegration.fileAssociations.title")}
          description={t("general.desktopIntegration.fileAssociations.description")}
          control={
            <Toggle
              aria-label={t("general.desktopIntegration.fileAssociations.title")}
              checked={settings.fileAssociations}
              onChange={(fileAssociations) => setSettings({ ...settings, fileAssociations })}
            />
          }
        />
        <SettingsRow
          title={t("general.desktopIntegration.autoUpdate.title")}
          description={t("general.desktopIntegration.autoUpdate.description")}
          control={
            <Toggle
              aria-label={t("general.desktopIntegration.autoUpdate.title")}
              checked={settings.autoUpdate}
              onChange={(autoUpdate) => setSettings({ ...settings, autoUpdate })}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("general.languagePrivacy")}>
        <div className="pb-1">
          <Select
            label={t("general.language")}
            value={settings.language ?? activeLocale}
            onChange={(language) => {
              const next = language as (typeof LOCALES)[number];
              setSettings({ ...settings, language: next });
              setLocale(next);
            }}
            options={LANGUAGE_OPTIONS}
          />
        </div>
        <SettingsRow
          borderless
          title={t("general.crashReports.title")}
          description={t("general.crashReports.description")}
          control={
            <Toggle
              aria-label={t("general.crashReports.title")}
              checked={settings.crashReports}
              onChange={(crashReports) => setSettings({ ...settings, crashReports })}
            />
          }
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
