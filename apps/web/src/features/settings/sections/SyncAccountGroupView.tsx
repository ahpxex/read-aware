/**
 * The Sync group of the Data & Sync panel, as pure presentation.
 *
 * Disconnected it is one quiet row with a "Connect account" button — the whole
 * sign-in flow lives in SyncConnectDialog. Connected it follows the panel's row
 * grammar, one concern per row with its own control: Account (identity /
 * disconnect), Status (last sync / sync now, or the re-login), Plan (tier +
 * usage / upgrade or manage). The icon-strip detail stays in the header
 * popover.
 *
 * Split from `SyncAccountGroup` because every interesting state here comes from
 * somewhere Storybook cannot reach — a module-level scheduler singleton, the
 * relay, and Tauri IPC. With the data as props, the connected, syncing,
 * rejected, over-quota and rejected-upload states can each be rendered and
 * reviewed on their own.
 */
import { Button, Dialog } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { SyncProfile } from "../../../platform/sync/sync-store";
import type { SyncStatusSnapshot } from "../../../platform/sync/sync-scheduler";
import { PendingBadge } from "../components/PendingBadge";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsRow } from "../components/SettingsRow";
import { syncCycleFraction } from "../../sync/lib/sync-progress";
import type { SyncBacklog, SyncBookBacklogRow } from "../../sync/hooks/useSyncStatus";
import type { SyncAccountInfo } from "../hooks/useSyncAccountInfo";
import type { useSyncConnection } from "../hooks/useSyncConnection";
import { SyncConnectDialog } from "./SyncConnectDialog";

/** "12 345 678" bytes → "11.8 MB": one decimal, sensible unit. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes;
  let unit: (typeof units)[number] = "KB";
  for (const next of units) {
    value /= 1024;
    unit = next;
    if (value < 1024) break;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

type SyncAccountGroupViewProps = {
  /** The web shell has no store and no sync — it keeps the placeholder row. */
  supported: boolean;
  connected: boolean;
  status: SyncStatusSnapshot;
  profile: SyncProfile | null;
  /** Fetched from the relay, so quietly absent while offline. */
  accountInfo: SyncAccountInfo | null;
  backlog: SyncBacklog | null;
  bookBacklog: SyncBookBacklogRow[] | null;
  /** Title of the book whose blob is moving right now, if any. */
  movingBookTitle: string | null;
  connectOpen: boolean;
  onConnectOpenChange: (open: boolean) => void;
  disconnectOpen: boolean;
  onDisconnectOpenChange: (open: boolean) => void;
  onSyncNow: () => void;
  onDisconnect: () => void;
  onOpenPortal: () => void;
  onOpenUpgrade: () => void;
  /** Handed straight to the connect dialog, which drives the sign-in flow. */
  sync: ReturnType<typeof useSyncConnection>;
};

export function SyncAccountGroupView({
  supported,
  connected,
  status,
  profile,
  accountInfo,
  backlog,
  bookBacklog,
  movingBookTitle,
  connectOpen,
  onConnectOpenChange,
  disconnectOpen,
  onDisconnectOpenChange,
  onSyncNow,
  onDisconnect,
  onOpenPortal,
  onOpenUpgrade,
  sync,
}: SyncAccountGroupViewProps) {
  const { t } = useTranslation("settings");
  const sessionRejected = status.state === "unauthenticated";

  if (!supported) {
    return (
      <SettingsGroup
        title={t("dataSync.sync")}
        aside={<PendingBadge>{t("dataSync.desktopBadge")}</PendingBadge>}
      >
        <SettingsRow
          borderless
          title={t("dataSync.account.title")}
          description={t("dataSync.account.description")}
        />
      </SettingsGroup>
    );
  }

  if (!connected) {
    return (
      <SettingsGroup title={t("dataSync.sync")}>
        <SettingsRow
          borderless
          title={t("dataSync.account.title")}
          description={t("dataSync.account.description")}
          control={
            <Button size="sm" onClick={() => onConnectOpenChange(true)}>
              {t("dataSync.connectAccount")}
            </Button>
          }
        />
        <SyncConnectDialog
          open={connectOpen}
          onClose={() => onConnectOpenChange(false)}
          sync={sync}
        />
      </SettingsGroup>
    );
  }

  const syncing = status.state === "syncing";
  // The email is the human name of the account; the opaque id only appears
  // while the relay hasn't answered yet (offline), shortened to stay legible.
  const accountLabel =
    accountInfo?.email ?? `${(profile?.remoteAccountId ?? "").slice(0, 8)}…`;

  // The Status row's one-line description: exactly one voice at a time —
  // a rejected session and a failed cycle speak in the warning tone.
  const fraction = syncCycleFraction(status);
  const pending = backlog !== null && backlog.events + backlog.blobs > 0 ? backlog : null;
  const statusDescription = sessionRejected ? (
    <span className="text-red-700">{t("dataSync.syncStatus.signedOut")}</span>
  ) : status.state === "error" ? (
    <span className="text-red-700">{status.lastError ?? t("dataSync.syncStatus.error")}</span>
  ) : syncing ? (
    [
      fraction === null
        ? t("dataSync.syncStatus.syncing")
        : `${t("dataSync.syncStatus.syncing")} ${Math.round(fraction * 100)}%`,
      // Which book is moving right now, with part progress for chunked files.
      movingBookTitle &&
        status.progress &&
        (status.progress.blobPartsTotal > 0
          ? t(
              status.progress.blobDirection === "down"
                ? "dataSync.progress.bookDownParts"
                : "dataSync.progress.bookUpParts",
              {
                title: movingBookTitle,
                done: status.progress.blobPartsDone,
                total: status.progress.blobPartsTotal,
              },
            )
          : t(
              status.progress.blobDirection === "down"
                ? "dataSync.progress.bookDown"
                : "dataSync.progress.bookUp",
              { title: movingBookTitle },
            )),
    ]
      .filter(Boolean)
      .join(" · ")
  ) : (
    [
      status.lastSyncAt
        ? t("dataSync.syncStatus.lastSync", {
            time: new Date(status.lastSyncAt).toLocaleTimeString(),
          })
        : t("dataSync.syncStatus.never"),
      pending &&
        t("dataSync.progress.pending", { events: pending.events, blobs: pending.blobs }),
    ]
      .filter(Boolean)
      .join(" · ")
  );

  // A currently-paying account manages its plan in Stripe's portal. Free
  // accounts get the upgrade menu even when a past customer exists (checkout
  // reuses it — after a cancellation the portal has nothing left to manage).
  // A paid tier WITHOUT billing was granted by the operator; staff plans are
  // never sold, so staff sees no control at all.
  const planControl =
    accountInfo && accountInfo.tier !== "staff" ? (
      accountInfo.tier !== "free" ? (
        accountInfo.hasBilling ? (
          <Button size="sm" variant="outline" onClick={onOpenPortal}>
            {t("dataSync.billing.manage")}
          </Button>
        ) : null
      ) : (
        // Plans are compared and bought on the landing's pricing page — the
        // app doesn't reprint the catalog, it opens the one source of it.
        <Button size="sm" variant="outline" onClick={onOpenUpgrade}>
          {t("dataSync.billing.upgrade")}
        </Button>
      )
    ) : null;

  const overLimit =
    accountInfo?.limits?.maxAccountBlobBytes != null &&
    accountInfo.blobBytesUsed > accountInfo.limits.maxAccountBlobBytes;

  // The relay's refusals name quotas ("account blob quota exceeded", legacy
  // "blob exceeds N bytes") — the one rejection class a user can act on
  // (free space or upgrade). Anything else is surfaced verbatim.
  const isQuotaRejection = (row: SyncBookBacklogRow) =>
    row.pushState === "rejected" &&
    ((row.lastError ?? "").includes("quota") || (row.lastError ?? "").includes("exceeds"));
  const quotaBlocked = (bookBacklog ?? []).some(isQuotaRejection);

  const bookStateLabel = (row: SyncBookBacklogRow): { text: string; tone?: "error" } => {
    if (!row.localBytes) return { text: t("dataSync.books.awaitingOtherDevice") };
    if (row.pushState === "pending") return { text: t("dataSync.books.pending") };
    if (row.pushState === "failed") return { text: t("dataSync.books.failed") };
    if (isQuotaRejection(row)) return { text: t("dataSync.books.rejectedQuota"), tone: "error" };
    return {
      text: row.lastError
        ? t("dataSync.books.rejectedWith", { reason: row.lastError })
        : t("dataSync.books.rejected"),
      tone: "error",
    };
  };

  return (
    <SettingsGroup title={t("dataSync.sync")}>
      <SettingsRow
        borderless
        title={t("dataSync.account.title")}
        description={accountLabel}
        control={
          <Button size="sm" variant="ghost" onClick={() => onDisconnectOpenChange(true)}>
            {t("dataSync.connected.disconnect")}
          </Button>
        }
      />
      <SettingsRow
        title={t("dataSync.connected.statusTitle")}
        description={statusDescription}
        control={
          // A rejected session makes "sync now" a guaranteed 401 — its slot
          // offers the re-login (the same connect dialog) instead.
          sessionRejected ? (
            <Button size="sm" onClick={() => onConnectOpenChange(true)}>
              {t("dataSync.reauth.action")}
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={syncing} onClick={onSyncNow}>
              {syncing ? t("dataSync.syncStatus.syncing") : t("dataSync.connected.syncNow")}
            </Button>
          )
        }
      />
      {/* Fetched from the relay, so quietly absent while offline. */}
      {accountInfo && (
        <SettingsRow
          title={t("dataSync.connected.planTitle")}
          description={
            <>
              {t(`dataSync.tier.${accountInfo.tier ?? "free"}`)}
              {" · "}
              <span className={overLimit ? "text-red-700" : undefined}>
                {/* A self-hosted relay predating tiers sends no limits — fall
                    back to the plain usage line rather than "of undefined". */}
                {accountInfo.limits?.maxAccountBlobBytes != null
                  ? t("dataSync.connected.storageUsedOfLimit", {
                      used: formatBytes(accountInfo.blobBytesUsed),
                      limit: formatBytes(accountInfo.limits.maxAccountBlobBytes),
                    })
                  : t("dataSync.connected.storageUsed", {
                      used: formatBytes(accountInfo.blobBytesUsed),
                    })}
              </span>
            </>
          }
          control={planControl}
        />
      )}
      {/* Per-book upload backlog: which files the relay doesn't hold yet and
          why. Absent entirely when every book's file made it — the panel says
          nothing when there is nothing to say. */}
      {bookBacklog !== null && (quotaBlocked || overLimit || bookBacklog.length > 0) && (
        <SettingsRow
          title={t("dataSync.books.title")}
          description={
            <span className="block space-y-1.5">
              {(quotaBlocked || overLimit) && (
                <span className="block text-red-700">{t("dataSync.books.quotaFull")}</span>
              )}
              {bookBacklog.map((row) => {
                const state = bookStateLabel(row);
                return (
                  <span key={row.bookId} className="block">
                    <span className="text-fg">{row.title}</span>
                    {row.byteSize != null && ` · ${formatBytes(row.byteSize)}`}
                    {" · "}
                    <span className={state.tone === "error" ? "text-red-700" : undefined}>
                      {state.text}
                    </span>
                  </span>
                );
              })}
            </span>
          }
        />
      )}
      <SettingsRow title={t("dataSync.e2e.title")} description={t("dataSync.e2e.active")} />
      {/* Re-login for a rejected session: the same connect flow, reached from
          the "sign in again" control above (or a deep-linked token). */}
      <SyncConnectDialog
        open={connectOpen}
        onClose={() => onConnectOpenChange(false)}
        sync={sync}
      />
      <Dialog
        open={disconnectOpen}
        onClose={() => onDisconnectOpenChange(false)}
        title={t("dataSync.connected.disconnectTitle")}
      >
        <div className="space-y-4">
          <p>{t("dataSync.connected.disconnectBody")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => onDisconnectOpenChange(false)}>
              {t("dataSync.connected.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                onDisconnectOpenChange(false);
                onDisconnect();
              }}
            >
              {t("dataSync.connected.disconnect")}
            </Button>
          </div>
        </div>
      </Dialog>
    </SettingsGroup>
  );
}
