import { useEffect } from "react";
import { Button, Spinner } from "@read-aware/ui";
import { isAndroid, isIOS, isTauri } from "../../../platform/environment";
import { useTranslation } from "../../../i18n";
import { useSoftwareUpdate } from "../../update/hooks/useSoftwareUpdate";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";

function valueText(text: string) {
  return <span className="font-sans text-sm text-fg-muted">{text}</span>;
}

function linkValue(href: string, label: string) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-sans text-sm text-fg-muted underline underline-offset-2 transition-colors hover:text-fg"
    >
      {label}
    </a>
  );
}

export function AboutPanel() {
  const { t } = useTranslation("settings");
  const update = useSoftwareUpdate();
  const buildLabel = !isTauri()
    ? t("about.buildWeb")
    : isAndroid()
      ? t("about.buildAndroid")
      : isIOS()
        ? t("about.buildIos")
        : t("about.buildDesktop");

  useEffect(() => {
    void update.loadCurrentVersion();
  }, [update.loadCurrentVersion]);

  const busy =
    update.state.phase === "checking" ||
    update.state.phase === "downloading" ||
    update.state.phase === "installing";
  const updateAvailable =
    update.state.phase === "available" ||
    update.state.phase === "permission-required" ||
    update.state.phase === "installer-open";
  const status =
    update.state.phase === "up-to-date"
      ? t("about.updateStatus.upToDate")
      : update.state.phase === "available" && update.state.availableVersion
        ? t("about.updateStatus.available", { version: update.state.availableVersion })
        : update.state.phase === "downloading"
          ? update.state.progress === null
            ? t("about.updateStatus.downloading")
            : t("about.updateStatus.downloadingProgress", { progress: update.state.progress })
          : update.state.phase === "installing"
            ? t("about.updateStatus.installing")
            : update.state.phase === "permission-required"
              ? t("about.updateStatus.permissionRequired")
              : update.state.phase === "installer-open"
                ? t("about.updateStatus.installerOpen")
                : update.state.phase === "error"
                  ? t("about.updateStatus.failed")
                  : null;

  return (
    <SettingsPage title={t("about.title")} description={t("about.description")}>
      <SettingsGroup title="ReadAware">
        <SettingsRow
          borderless
          title={t("about.version")}
          control={valueText(update.state.currentVersion ?? t("about.versionUnknown"))}
        />
        <SettingsRow
          title={t("about.build")}
          control={valueText(buildLabel)}
        />
        <SettingsRow
          title={t("about.updates.title")}
          description={t("about.updates.description")}
          control={
            <span className="flex items-center gap-2">
              {status && <span className="text-caption text-fg-muted">{status}</span>}
              <Button
                variant="outline"
                size="sm"
                disabled={!update.supported || busy}
                onClick={() => {
                  if (updateAvailable) void update.installUpdate();
                  else void update.checkForUpdates();
                }}
              >
                {busy && <Spinner size="sm" />}
                {updateAvailable
                  ? t("about.installUpdate")
                  : update.state.phase === "checking"
                    ? t("about.checkingUpdates")
                    : t("about.checkUpdates")}
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
          title={t("about.website.title")}
          description={t("about.website.description")}
          control={linkValue("https://readaware.app", "readaware.app")}
        />
        <SettingsRow
          title={t("about.contact.title")}
          description={t("about.contact.description")}
          control={linkValue("mailto:hi@ahpx.me", "hi@ahpx.me")}
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
