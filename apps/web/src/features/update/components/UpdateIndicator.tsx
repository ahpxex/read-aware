import { ArrowCircleDown, WarningCircle } from "@phosphor-icons/react";
import { Button, Tooltip } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { useSoftwareUpdate } from "../hooks/useSoftwareUpdate";

export function UpdateIndicator() {
  const { t } = useTranslation("nav");
  const { state, checkForUpdates, installUpdate } = useSoftwareUpdate();

  const installFailed = state.phase === "error" && state.errorStage === "install";
  const visible =
    state.phase === "available" ||
    state.phase === "downloading" ||
    state.phase === "installing" ||
    installFailed;

  if (!visible) return null;

  const label =
    state.phase === "downloading"
      ? state.progress === null
        ? t("update.downloading")
        : t("update.downloadingProgress", { progress: state.progress })
      : state.phase === "installing"
        ? t("update.installing")
        : installFailed
          ? t("update.failed")
          : t("update.available");

  const tooltip =
    state.phase === "available" && state.availableVersion
      ? t("update.availableVersion", { version: state.availableVersion })
      : installFailed && state.error
        ? state.error
        : label;

  const busy = state.phase === "downloading" || state.phase === "installing";
  const handleClick = () => {
    if (installFailed) void checkForUpdates();
    else if (state.phase === "available") void installUpdate();
  };

  return (
    <Tooltip content={tooltip} side="bottom" align="start">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={handleClick}
        className="shrink-0 px-2 text-caption text-fg-muted disabled:cursor-default disabled:opacity-75"
      >
        {installFailed ? (
          <WarningCircle size={15} weight="regular" aria-hidden="true" />
        ) : (
          <ArrowCircleDown size={15} weight="regular" aria-hidden="true" />
        )}
        <span>{label}</span>
      </Button>
    </Tooltip>
  );
}
