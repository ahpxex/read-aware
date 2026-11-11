import { useEffect, useSyncExternalStore } from "react";
import { DiscordLogo, Heart, Star } from "@phosphor-icons/react";
import { Button, buttonClassName, ChoiceGroup, Spinner } from "@read-aware/ui";
import { useExternalLink } from "../../../hooks/useExternalLink";
import { isAndroid, isIOS, isTauri } from "../../../platform/environment";
import { PROJECT_AUTHOR_URL, PROJECT_DISCORD_URL, PROJECT_REPOSITORY_URL } from "../../../platform/site-url";
import { Trans, useTranslation } from "../../../i18n";
import { useSoftwareUpdate } from "../../update/hooks/useSoftwareUpdate";
import { getUpdateChannel, setUpdateChannel, subscribeUpdateChannel } from "../../update/lib/update-channel";
import { versionCodename } from "../../update/lib/version-codename";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsPage } from "../components/SettingsPage";
import { SettingsRow } from "../components/SettingsRow";
import { DiagnosticsGroup } from "./DiagnosticsGroup";
import { useMaintenanceSurface } from "../hooks/useMaintenanceSurface";

function valueText(text: string) {
  return <span className="font-sans text-sm text-fg-muted">{text}</span>;
}

/** `0.4.1 「El Alto」` — the minor series' codename rides along when it has one. */
function formatVersion(version: string | null, unknownLabel: string): string {
  if (!version) return unknownLabel;
  const codename = versionCodename(version);
  return codename ? `${version} 「${codename}」` : version;
}

function linkValue(href: string, label: string, onClick: ReturnType<typeof useExternalLink>) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className="font-sans text-sm text-fg-muted underline underline-offset-2 transition-colors hover:text-fg"
    >
      {label}
    </a>
  );
}

export function AboutPanel() {
  const { t } = useTranslation(["settings", "common"]);
  const openLink = useExternalLink();
  const update = useSoftwareUpdate();
  const { loadCurrentVersion } = update;
  const updateControlRef = useMaintenanceSurface("updates");
  const channel = useSyncExternalStore(subscribeUpdateChannel, getUpdateChannel);
  const buildLabel = !isTauri()
    ? t("about.buildWeb")
    : isAndroid()
      ? t("about.buildAndroid")
      : isIOS()
        ? t("about.buildIos")
        : t("about.buildDesktop");

  useEffect(() => {
    void loadCurrentVersion();
  }, [loadCurrentVersion]);

  const busy =
    update.state.phase === "checking" || update.state.phase === "downloading" || update.state.phase === "installing";
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
          control={valueText(formatVersion(update.state.currentVersion, t("about.versionUnknown")))}
        />
        <SettingsRow title={t("about.build")} control={valueText(buildLabel)} />
        <SettingsRow
          title={t("about.updates.title")}
          description={t("about.updates.description")}
          control={
            <span className="flex items-center gap-2">
              {status && <span className="line-clamp-3 max-w-64 text-right text-caption text-fg-muted">{status}</span>}
              <Button
                ref={updateControlRef}
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
        <SettingsRow
          title={t("about.channel.title")}
          description={t("about.channel.description")}
          control={
            <ChoiceGroup
              value={channel}
              options={[
                { value: "stable", label: t("about.channel.stable") },
                { value: "beta", label: t("about.channel.beta") },
              ]}
              onChange={(next) => {
                setUpdateChannel(next);
              }}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t("common:community.title")} description={t("common:community.description")}>
        <div className="flex flex-wrap gap-2">
          <a
            href={PROJECT_REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={openLink}
            className={buttonClassName()}
          >
            <Star size={16} aria-hidden="true" />
            {t("common:community.star")}
          </a>
          <a
            href={PROJECT_DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={openLink}
            className={buttonClassName({ variant: "outline" })}
          >
            <DiscordLogo size={18} aria-hidden="true" />
            {t("common:community.discord")}
          </a>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("about.engine.title")} description={t("about.engine.description")}>
        <SettingsRow
          borderless
          title="foliate-js"
          description={t("about.foliate.description")}
          control={valueText(t("about.vendored"))}
        />
      </SettingsGroup>

      <DiagnosticsGroup />

      <SettingsGroup title={t("about.help")}>
        <SettingsRow
          borderless
          title={t("about.website.title")}
          description={t("about.website.description")}
          control={linkValue("https://readaware.app", "readaware.app", openLink)}
        />
        <SettingsRow
          title={t("about.contact.title")}
          description={t("about.contact.description")}
          control={linkValue("mailto:ahpxex@gmail.com", "ahpxex@gmail.com", openLink)}
        />
      </SettingsGroup>
      <footer className="pt-2 text-center font-sans text-caption text-fg-muted">
        <Trans
          ns="common"
          i18nKey="community.madeBy"
          components={{
            heart: (
              <Heart
                size={12}
                weight="fill"
                role="img"
                aria-label={t("common:community.love")}
                className="mx-0.5 inline-block align-[-2px]"
              />
            ),
            author: (
              <a
                href={PROJECT_AUTHOR_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={openLink}
                className="underline-offset-4 hover:text-fg hover:underline"
              />
            ),
          }}
        />
      </footer>
    </SettingsPage>
  );
}
