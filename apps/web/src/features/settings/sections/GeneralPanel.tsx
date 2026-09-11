import { ChoiceGroup, InlineError, Select, Spinner, Toggle } from "@read-aware/ui";
import { describeError } from "../../../i18n/describe-error";
import { useGeneralSettings } from "../hooks/useGeneralSettings";
import { isMacOS } from "../../../platform/environment";
import { LOCALES, LOCALE_LABELS, useLocale, useTranslation } from "../../../i18n";
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
  const { t } = useTranslation(["settings", "common"]);
  const { settings, startup, busy, update, retry } = useGeneralSettings();
  const failure = startup.status === "failed" ? describeError(startup.error) : null;
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
          disabled={busy}
          onChange={(startView) => void update("startView", startView)}
        />
      </SettingsGroup>

      <SettingsGroup
        title={t("general.desktopIntegration.title")}
        description={t("general.desktopIntegration.description")}
      >
        <SettingsRow
          borderless
          title={t("general.desktopIntegration.launchAtStartup.title")}
          description={failure
            ? <InlineError compact onRetry={failure.retryable && !busy ? retry : undefined} retryLabel={t("common:errorBoundary.retry")}>{failure.body}</InlineError>
            : t("general.desktopIntegration.launchAtStartup.description")}
          control={
            startup.status === "loading" ? <Spinner size="sm" /> : <Toggle
              aria-label={t("general.desktopIntegration.launchAtStartup.title")}
              checked={startup.status === "ready" && startup.enabled}
              disabled={busy || startup.status !== "ready"}
              aria-busy={busy}
              onChange={(launchAtStartup) => void update("launchAtStartup", launchAtStartup)}
            />
          }
        />
        <SettingsRow
          title={t("general.desktopIntegration.fileAssociations.title")}
          description={isMacOS()
            ? t("general.desktopIntegration.fileAssociations.descriptionMac")
            : t("general.desktopIntegration.fileAssociations.description")}
          control={
            <Toggle
              aria-label={t("general.desktopIntegration.fileAssociations.title")}
              checked={settings.fileAssociations}
              disabled={busy}
              onChange={(fileAssociations) => void update("fileAssociations", fileAssociations)}
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
              disabled={busy}
              onChange={(autoUpdate) => void update("autoUpdate", autoUpdate)}
            />
          }
        />
        <SettingsRow
          title={t("general.desktopIntegration.whatsNewDialog.title")}
          description={t("general.desktopIntegration.whatsNewDialog.description")}
          control={
            <Toggle
              aria-label={t("general.desktopIntegration.whatsNewDialog.title")}
              checked={settings.whatsNewDialog}
              disabled={busy}
              onChange={(whatsNewDialog) =>
                void update("whatsNewDialog", whatsNewDialog)
              }
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("general.languagePrivacy")}>
        <div className="pb-1">
          <Select
            label={t("general.language")}
            value={settings.language ?? activeLocale}
            disabled={busy}
            onChange={(language) => {
              const next = language as (typeof LOCALES)[number];
              void update("language", next);
            }}
            options={LANGUAGE_OPTIONS}
          />
        </div>
        <SettingsRow
          borderless
          title={t("general.crashPrompt.title")}
          description={t("general.crashPrompt.description")}
          control={
            <Toggle
              aria-label={t("general.crashPrompt.title")}
              checked={settings.crashPrompt}
              disabled={busy}
              onChange={(crashPrompt) => void update("crashPrompt", crashPrompt)}
            />
          }
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
