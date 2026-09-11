import { FolderOpen } from "@phosphor-icons/react";
import { Button, InlineError, Spinner } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { describeError } from "../../../i18n/describe-error";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsRow } from "../components/SettingsRow";
import { useDataLocation } from "../hooks/useDataLocation";
import { useMaintenanceSurface } from "../hooks/useMaintenanceSurface";

export function DataLocationGroup() {
  const { t } = useTranslation(["settings", "common"]);
  const ref = useMaintenanceSurface("data-location");
  const { state, revealing, reveal, retry } = useDataLocation();
  const failure = state.status === "failed" ? describeError(state.error, {
    fallback: t("settings:dataSync.dataLocation.loadFailed"),
  }) : null;

  return <div ref={ref} tabIndex={-1} aria-label={t("settings:dataSync.dataLocation.title")}>
    <SettingsGroup title={t("settings:dataSync.storage")}>
      <SettingsRow borderless title={t("settings:dataSync.dataLocation.title")}
        description={state.status === "ready"
          ? <span className="block select-text break-all font-mono">{state.path}</span>
          : failure ? <InlineError compact onRetry={failure.retryable ? retry : undefined} retryLabel={t("common:errorBoundary.retry")}>{failure.body}</InlineError>
          : state.status === "unsupported" ? t("settings:dataSync.dataLocation.descWeb")
          : <Spinner size="sm" />}
        control={<Button variant="outline" size="sm" disabled={state.status !== "ready" || revealing}
          aria-busy={revealing} onClick={() => void reveal()}>
          <FolderOpen size={16} aria-hidden="true" />
          {t("settings:dataSync.reveal")}
        </Button>} />
    </SettingsGroup>
  </div>;
}
