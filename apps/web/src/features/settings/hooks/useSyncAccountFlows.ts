import { useLayoutEffect, useRef, useState } from "react";
import { AppError, type HostSyncFlow } from "@read-aware/core";
import { useToast } from "@read-aware/ui";
import { describeError, useTranslation } from "../../../i18n";
import { openExternalUrl } from "../../../platform/external-link";
import { createLogger } from "../../../platform/logger";
import { siteBaseUrl } from "../../../platform/site-url";
import { getSyncConnectionBusy } from "../../../platform/sync/connection-operation";
import { getSyncConnectionGeneration, getSyncStatusSnapshot, syncRelayClient } from "../../../platform/sync/sync-scheduler";
import { hostSyncFlows } from "../../../services/sync";
import type { useSyncConnection } from "./useSyncConnection";

const log = createLogger("sync");
const LANDING_LOCALE: Record<string, string> = { "zh-Hans": "zh", "zh-Hant": "zh-hant", ja: "ja", fr: "fr", de: "de", ru: "ru", es: "es" };

/** Settings owns all secrets, confirmations and user-facing failures. The
 * shared controller correlates only the action and its final outcome. */
export function useSyncAccountFlows(sync: ReturnType<typeof useSyncConnection>, purchaseAllowed: boolean) {
  const { t, i18n } = useTranslation("settings");
  const { toast } = useToast();
  const [connectOpen, setConnectOpen] = useState(false);
  const [transportDialogRef, setTransportDialogRef] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [working, setWorking] = useState(false);

  const close = () => {
    setConnectOpen(false); setTransportDialogRef(null);
    setDisconnectOpen(false); setDeleteAccountOpen(false);
  };
  const change = (action: HostSyncFlow, open: boolean, set: (open: boolean) => void) => {
    if (working || getSyncConnectionBusy()) return;
    if (!open) hostSyncFlows.dismiss(action);
    set(open);
  };
  const failure = (error: unknown) => {
    log.error("sync account action failed", error);
    toast({ variant: "destructive", title: t("dataSync.noticeError"),
      description: describeError(error, { fallback: t("dataSync.connect.failed") }).body });
  };
  const perform = async (action: HostSyncFlow, operation: (signal?: AbortSignal) => Promise<unknown>) => {
    setWorking(true);
    try { await hostSyncFlows.run(action, operation); close(); }
    catch (error) { failure(error); }
    finally { setWorking(false); }
  };
  const billing = (action: "upgrade" | "billing") => perform(action, async signal => {
    if (!purchaseAllowed) throw new AppError("ui/unavailable", "External purchases are unavailable");
    const status = getSyncStatusSnapshot();
    if (!status.accountConnected || status.backend !== "relay" || getSyncConnectionBusy()) throw new AppError("ui/unavailable", "No available relay account");
    const client = syncRelayClient();
    const generation = getSyncConnectionGeneration();
    const account = await client.account();
    if (account.tier === "staff" || (action === "billing" ? !account.hasBilling : account.tier !== "free")) throw new AppError("ui/unavailable", "This account has no requested billing action");
    let target: string;
    if (action === "billing") target = await client.createPortal();
    else {
      const prefix = LANDING_LOCALE[i18n.language];
      target = `${siteBaseUrl()}${prefix ? `/${prefix}` : ""}/pricing`;
      try { target += `#upgrade=${encodeURIComponent(await client.billingTicket())}`; }
      catch { /* Older/offline relays retain the existing email-bound pricing fallback. */ }
    }
    signal?.throwIfAborted();
    if (generation !== getSyncConnectionGeneration() || getSyncConnectionBusy()) throw new AppError("ui/superseded", "Sync account changed before external handoff");
    await openExternalUrl(target);
  });

  const latest = useRef({ open: (_request: import("@read-aware/core").HostSyncFlowRequest) => {}, close });
  latest.current = {
    close,
    open: request => {
      if (working || getSyncConnectionBusy() || connectOpen || transportDialogRef || disconnectOpen || deleteAccountOpen) throw new AppError("ui/unavailable", "A native sync dialog is already active");
      const status = getSyncStatusSnapshot();
      if (request.action === "connect") {
        if (status.accountConnected && (status.backend !== "relay" || status.state !== "unauthenticated" || request.transportRef)) throw new AppError("ui/unavailable", "Disconnect before connecting another backend");
        if (request.transportRef) {
          if (!sync.transports.some(item => item.ref === request.transportRef)) throw new AppError("sync/transport-unavailable", "Sync backend is not registered");
          setTransportDialogRef(request.transportRef);
        } else setConnectOpen(true);
      } else {
        if (!status.accountConnected || (request.action !== "disconnect" && status.backend !== "relay")) throw new AppError("ui/unavailable", "The requested sync account action is unavailable");
        if (request.action === "disconnect") setDisconnectOpen(true);
        else if (request.action === "delete-account") setDeleteAccountOpen(true);
        else void billing(request.action);
      }
    },
  };
  useLayoutEffect(() => hostSyncFlows.bind({ open: request => latest.current.open(request), close: () => latest.current.close() }), []);

  return {
    connectOpen, setConnectOpen: (open: boolean) => change("connect", open, setConnectOpen),
    transportDialogRef, setTransportDialogRef: (ref: string | null) => {
      if (working || getSyncConnectionBusy()) return;
      if (ref === null) hostSyncFlows.dismiss("connect");
      setTransportDialogRef(ref);
    },
    disconnectOpen, setDisconnectOpen: (open: boolean) => change("disconnect", open, setDisconnectOpen),
    deleteAccountOpen, setDeleteAccountOpen: (open: boolean) => change("delete-account", open, setDeleteAccountOpen),
    working,
    disconnect: () => perform("disconnect", sync.disconnect),
    deleteAccount: () => perform("delete-account", async () => {
      await sync.deleteAccount();
      toast({ title: t("dataSync.noticeDone"), description: t("dataSync.deleteAccount.done") });
    }),
    openPortal: () => billing("billing"), openUpgrade: () => billing("upgrade"),
    sync: { ...sync,
      finishConnect: (...args: Parameters<typeof sync.finishConnect>) => hostSyncFlows.run("connect", () => sync.finishConnect(...args), true),
      connectTransport: (...args: Parameters<typeof sync.connectTransport>) => hostSyncFlows.run("connect", () => sync.connectTransport(...args), true),
    },
  };
}
