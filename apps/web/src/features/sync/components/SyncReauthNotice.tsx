import { SignIn, X } from "@phosphor-icons/react";
import { IconButton, Tooltip } from "@read-aware/ui";
import { useState } from "react";
import { useSetAtom } from "jotai";
import { useTranslation } from "../../../i18n";
import {
  dismissReauthNotice,
  isReauthNoticeDismissed,
} from "../../../platform/sync/reauth-notice";
import { settingsOpenAtom, settingsSectionRequestAtom } from "../../../state/ui";
import { useSyncStatus } from "../hooks/useSyncStatus";

/**
 * The "sign in again" prompt for a relay-rejected session, living in the same
 * leading-status slot (and following the same manners) as the update
 * surfaces.
 * Clicking opens Settings → Data & Sync where the re-login lives; the X
 * silences it for this dead session's epoch (persisted — see
 * platform/sync/reauth-notice.ts), after which settings stays the one door.
 */
export function SyncReauthNotice() {
  const { t } = useTranslation("settings");
  const status = useSyncStatus();
  const [dismissed, setDismissed] = useState(() => isReauthNoticeDismissed());
  const setSettingsOpen = useSetAtom(settingsOpenAtom);
  const requestSection = useSetAtom(settingsSectionRequestAtom);

  if (status.state !== "unauthenticated" || dismissed) return null;

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={() => {
          requestSection("dataSync");
          setSettingsOpen(true);
        }}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-fg/5 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
      >
        <SignIn size={14} weight="regular" aria-hidden="true" />
        <span>{t("dataSync.reauth.notice")}</span>
      </button>
      <Tooltip content={t("dataSync.reauth.dismiss")} side="bottom">
        <IconButton
          size="sm"
          label={t("dataSync.reauth.dismiss")}
          onClick={() => {
            dismissReauthNotice();
            setDismissed(true);
          }}
          className="h-6 w-6 rounded-md text-fg-subtle hover:bg-fg/5 hover:text-fg focus-visible:ring-fg"
          icon={<X size={12} weight="regular" aria-hidden="true" />}
        />
      </Tooltip>
    </span>
  );
}
