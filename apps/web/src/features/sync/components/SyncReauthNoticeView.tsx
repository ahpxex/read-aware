/**
 * The "sign in again" prompt for a relay-rejected session, as pure
 * presentation — the same leading-status slot, and the same manners, as the
 * update surfaces.
 *
 * Whether it appears at all (a dead session, not yet silenced) is the
 * container's decision; this half is the notice itself.
 */
import { SignIn, X } from "@phosphor-icons/react";
import { IconButton, Tooltip } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";

type SyncReauthNoticeViewProps = {
  /** Opens Settings -> Data & Sync, where the re-login lives. */
  onOpenSettings: () => void;
  /** Silences the notice for this dead session's epoch. */
  onDismiss: () => void;
};

export function SyncReauthNoticeView({
  onOpenSettings,
  onDismiss,
}: SyncReauthNoticeViewProps) {
  const { t } = useTranslation("settings");

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={onOpenSettings}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-fg/5 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
      >
        <SignIn size={14} weight="regular" aria-hidden="true" />
        <span>{t("dataSync.reauth.notice")}</span>
      </button>
      <Tooltip content={t("dataSync.reauth.dismiss")} side="bottom">
        <IconButton
          size="sm"
          label={t("dataSync.reauth.dismiss")}
          onClick={onDismiss}
          className="h-6 w-6 rounded-md text-fg-subtle hover:bg-fg/5 hover:text-fg focus-visible:ring-fg"
          icon={<X size={12} weight="regular" aria-hidden="true" />}
        />
      </Tooltip>
    </span>
  );
}
