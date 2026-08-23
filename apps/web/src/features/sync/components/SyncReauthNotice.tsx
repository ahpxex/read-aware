import { useState } from "react";
import { useSetAtom } from "jotai";
import {
  dismissReauthNotice,
  isReauthNoticeDismissed,
} from "../../../platform/sync/reauth-notice";
import { settingsOpenAtom, settingsSectionRequestAtom } from "../../../state/ui";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { SyncReauthNoticeView } from "./SyncReauthNoticeView";

/**
 * The "sign in again" prompt for a relay-rejected session, living in the same
 * leading-status slot (and following the same manners) as the update
 * surfaces.
 * Clicking opens Settings -> Data & Sync where the re-login lives; the X
 * silences it for this dead session's epoch (persisted - see
 * platform/sync/reauth-notice.ts), after which settings stays the one door.
 *
 * This half owns those two decisions; the notice itself is
 * `SyncReauthNoticeView`.
 */
export function SyncReauthNotice() {
  const status = useSyncStatus();
  const [dismissed, setDismissed] = useState(() => isReauthNoticeDismissed());
  const setSettingsOpen = useSetAtom(settingsOpenAtom);
  const requestSection = useSetAtom(settingsSectionRequestAtom);

  if (status.state !== "unauthenticated" || dismissed) return null;

  return (
    <SyncReauthNoticeView
      onOpenSettings={() => {
        requestSection("dataSync");
        setSettingsOpen(true);
      }}
      onDismiss={() => {
        dismissReauthNotice();
        setDismissed(true);
      }}
    />
  );
}
