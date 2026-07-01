import { Button } from "@read-aware/ui";
import { isTauri } from "../../../platform/environment";
import { useTranslation } from "../../../i18n";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { PendingBadge } from "../components/PendingBadge";

const APP_VERSION = "0.1.0";

function valueText(text: string) {
  return <span className="font-sans text-sm text-fg-muted">{text}</span>;
}

export function AboutPanel() {
  const { t } = useTranslation("settings");
  return (
    <SettingsPage title={t("about.title")} description={t("about.description")}>
      <SettingsGroup title="ReadAware">
        <SettingsRow borderless title={t("about.version")} control={valueText(APP_VERSION)} />
        <SettingsRow
          title={t("about.build")}
          control={valueText(isTauri() ? t("about.buildDesktop") : t("about.buildWeb"))}
        />
        <SettingsRow
          title={t("about.updates.title")}
          description={t("about.updates.description")}
          control={
            <span className="flex items-center gap-2">
              <PendingBadge />
              <Button variant="outline" size="sm" disabled>
                {t("about.checkUpdates")}
              </Button>
            </span>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title={t("about.engine.title")}
        description={t("about.engine.description")}
      >
        <SettingsRow
          borderless
          title="foliate-js"
          description={t("about.foliate.description")}
          control={valueText(t("about.vendored"))}
        />
      </SettingsGroup>

      <SettingsGroup title={t("about.help")}>
        <SettingsRow
          borderless
          title={t("about.feedback.title")}
          description={t("about.feedback.description")}
          control={
            <span className="flex items-center gap-2">
              <PendingBadge />
              <Button variant="outline" size="sm" disabled>
                {t("about.reportIssue")}
              </Button>
            </span>
          }
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
