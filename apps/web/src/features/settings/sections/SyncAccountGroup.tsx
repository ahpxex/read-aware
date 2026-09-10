/**
 * The Sync group's container: the live connection, the relay's account info,
 * the outbox backlogs, and the billing round-trips. The rows themselves are
 * `SyncAccountGroupView`.
 */
import { useEffect } from "react";
import { useAtom } from "jotai";
import { useToast } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import { isTauri } from "../../../platform/environment";
import { createLogger } from "../../../platform/logger";
import { syncLoginTokenAtom } from "../../../state/ui";
import { useBlobBookTitle } from "../../sync/hooks/useBlobBookTitle";
import { useSyncBacklog, useSyncBookBacklog } from "../../sync/hooks/useSyncStatus";
import { useExternalPurchaseAllowed } from "../hooks/useExternalPurchaseAllowed";
import { useSyncAccountInfo } from "../hooks/useSyncAccountInfo";
import { useSyncConnection } from "../hooks/useSyncConnection";
import { useSyncAccountFlows } from "../hooks/useSyncAccountFlows";
import { SyncAccountGroupView } from "./SyncAccountGroupView";

const log = createLogger("sync");

export function SyncAccountGroup() {
  const { t } = useTranslation("settings");
  const { toast } = useToast();
  const sync = useSyncConnection();

  const backlog = useSyncBacklog(sync.connected);
  const bookBacklog = useSyncBookBacklog(sync.connected);
  // Account info (email, plan, usage) is the relay's — a transport connection
  // has no account to ask about.
  const accountInfo = useSyncAccountInfo(sync.connected && sync.connectedTransport === null);
  const purchaseAllowed = useExternalPurchaseAllowed();
  const flows = useSyncAccountFlows(sync, purchaseAllowed);
  const movingBookTitle = useBlobBookTitle(
    sync.status.state === "syncing" ? (sync.status.progress?.blobKey ?? null) : null,
  );

  // A deep-linked sign-in token opens the connect dialog, which consumes the
  // atom itself. Already connected — with a session the relay still honors —
  // the link has nothing left to do; a rejected session is exactly what the
  // link re-establishes, so it opens the dialog like a first sign-in.
  const [linkToken, setLinkToken] = useAtom(syncLoginTokenAtom);
  const { connected } = sync;
  const sessionRejected = sync.status.state === "unauthenticated";
  useEffect(() => {
    if (!linkToken) return;
    if (connected && !sessionRejected) {
      setLinkToken(null);
      return;
    }
    flows.setConnectOpen(true);
  }, [linkToken, connected, sessionRejected, setLinkToken, sync.busy]);

  const handleSyncNow = async () => {
    try {
      await sync.requestSyncNow();
    } catch (error) {
      log.error("manual sync failed", error);
      toast({
        variant: "destructive",
        title: t("dataSync.noticeError"),
        description: t("dataSync.syncStatus.error"),
      });
    }
  };

  return (
    <SyncAccountGroupView
      // The web shell has no store and no sync — keep the pre-sync placeholder.
      supported={isTauri()}
      connected={sync.connected}
      status={sync.status}
      profile={sync.profile}
      accountInfo={accountInfo}
      backlog={backlog}
      bookBacklog={bookBacklog}
      movingBookTitle={movingBookTitle}
      connectOpen={flows.connectOpen}
      onConnectOpenChange={flows.setConnectOpen}
      transportDialogRef={flows.transportDialogRef}
      onTransportDialogChange={flows.setTransportDialogRef}
      disconnectOpen={flows.disconnectOpen}
      onDisconnectOpenChange={flows.setDisconnectOpen}
      deleteAccountOpen={flows.deleteAccountOpen}
      onDeleteAccountOpenChange={flows.setDeleteAccountOpen}
      deletingAccount={flows.working}
      onDeleteAccount={() => void flows.deleteAccount()}
      onSyncNow={() => void handleSyncNow()}
      onDisconnect={() => void flows.disconnect()}
      purchaseAllowed={purchaseAllowed}
      onOpenPortal={() => void flows.openPortal()}
      onOpenUpgrade={() => void flows.openUpgrade()}
      sync={flows.sync}
    />
  );
}
