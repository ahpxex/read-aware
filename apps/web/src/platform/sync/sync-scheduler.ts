/**
 * The sync scheduler: owns the singleton engine and its cadence. Started once
 * at boot (App.tsx); the settings panel talks to the same singleton for
 * "sync now", connect/disconnect restarts, and status display.
 *
 * Cadence: pull-push cycle on start, then every PULL_INTERVAL_MS while the app
 * is focused; a commit broadcast nudges a push after a short debounce; window
 * focus pulls (the other device may have moved while we were away); failures
 * back off exponentially (nextSyncDelayMs) instead of hammering the relay.
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../environment";
import { emitAppEvent } from "../app-events";
import { observeRemoteHlcStamps, onDomainEventBroadcast } from "../domain-events";
import { localKV } from "../local-store";
import { refreshRoamingPreferences, republishRoamingSecrets } from "../roaming-preferences";
import { deleteSecret, getSecret, setSecret } from "../secret-store";
import { fromBase64 } from "../sync-envelope";
import { createRelayClient, type RelayClient } from "./relay-client";
import {
  createSyncEngine,
  nextSyncDelayMs,
  type SyncCycleProgress,
  type SyncEngine,
} from "./sync-engine";
import { adoptSyncAccount, createIpcSyncStore, getSyncProfile, setSyncProfile } from "./sync-store";

export const DEFAULT_RELAY_URL = "https://relay.readaware.app";
/** Dev override (localKV): point the client at `wrangler dev`. */
const RELAY_URL_KV_KEY = "read-aware-sync-relay-url";

const PULL_INTERVAL_MS = 5 * 60_000;
const PUSH_DEBOUNCE_MS = 3_000;

export function relayBaseUrl(): string {
  const raw = localKV.getItem(RELAY_URL_KV_KEY);
  if (!raw) return DEFAULT_RELAY_URL;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" && parsed.length > 0 ? parsed : DEFAULT_RELAY_URL;
  } catch {
    return raw;
  }
}

// ── Status (subscribable snapshot for useSyncExternalStore) ──────────────────

export type SyncStatusSnapshot = {
  state: "disabled" | "idle" | "syncing" | "error";
  lastSyncAt: number | null;
  lastError: string | null;
  /** Live counters while `state === "syncing"`, null otherwise. */
  progress: SyncCycleProgress | null;
  /**
   * Outbox size measured at cycle start — the denominators that turn the live
   * counters into a fraction. Pull has no denominator (the relay never says
   * how much is left), so pull renders indeterminate.
   */
  cycleTotals: { events: number; blobs: number } | null;
  /** What the last completed cycle moved (for the detail surfaces). */
  lastCycle: { pulled: number; pushed: number; blobs: number } | null;
};

let status: SyncStatusSnapshot = {
  state: "disabled",
  lastSyncAt: null,
  lastError: null,
  progress: null,
  cycleTotals: null,
  lastCycle: null,
};
const statusListeners = new Set<() => void>();

export const getSyncStatusSnapshot = (): SyncStatusSnapshot => status;
export function subscribeSyncStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}
function setStatus(next: Partial<SyncStatusSnapshot>): void {
  status = { ...status, ...next };
  for (const listener of [...statusListeners]) listener();
}

// ── The singleton engine ─────────────────────────────────────────────────────

export function syncRelayClient(): RelayClient {
  return createRelayClient({
    baseUrl: relayBaseUrl(),
    session: () => getSecret("sync.session") || null,
  });
}

function buildEngine(): SyncEngine {
  return createSyncEngine({
    store: createIpcSyncStore(),
    relay: syncRelayClient(),
    masterKey: () => {
      const b64 = getSecret("sync.master-key");
      return b64 ? fromBase64(b64) : null;
    },
    observe: observeRemoteHlcStamps,
    // Every page/batch/blob lands in the status snapshot, which is what the
    // header indicator and the Data & Sync panel subscribe to.
    onProgress: (progress) => setStatus({ progress }),
  });
}

let engine: SyncEngine | null = null;
const getEngine = (): SyncEngine => (engine ??= buildEngine());

let running = false;

async function runCycle(): Promise<void> {
  if (running) return;
  running = true;
  // Denominators first: what the outbox holds now is what this cycle's push
  // and blob phases will work through. Best-effort — without them the ring
  // just stays indeterminate.
  let cycleTotals: SyncStatusSnapshot["cycleTotals"] = null;
  try {
    cycleTotals = await invoke<{ events: number; blobs: number }>("sync_outbox_counts");
  } catch {
    // Non-Tauri or transient failure: progress still renders, just unmeasured.
  }
  setStatus({
    state: "syncing",
    progress: { phase: "pull", pulled: 0, pushed: 0, blobsDone: 0, blobsTotal: 0 },
    cycleTotals,
  });
  try {
    const { pulled, pushed, blobs } = await getEngine().syncOnce();
    if (pulled > 0) {
      // Merged events write projections straight through Rust — nothing else
      // tells the mounted UI. The shelf already reloads on this event.
      emitAppEvent("library-changed", {});
      // Roamed preferences (theme, typography) follow the same wake-up:
      // re-overlay the projection onto KV and announce what moved.
      await refreshRoamingPreferences();
    }
    setStatus({
      state: "idle",
      lastSyncAt: Date.now(),
      lastError: null,
      progress: null,
      cycleTotals: null,
      lastCycle: { pulled, pushed, blobs },
    });
  } finally {
    running = false;
  }
}

/**
 * Lazy blob download for read paths (library-db): returns null when sync is
 * off, not connected, or the relay has no such blob — callers treat every
 * null identically as "not available".
 */
export async function fetchRemoteBlob(key: string): Promise<Uint8Array | null> {
  if (!isTauri()) return null;
  if (!getSecret("sync.master-key") || !getSecret("sync.session")) return null;
  const profile = await getSyncProfile();
  if (!profile.syncEnabled) return null;
  try {
    return await getEngine().fetchBlob(key);
  } catch (error) {
    console.warn(`[sync] remote blob fetch failed for "${key}"`, error);
    return null;
  }
}

// ── Scheduler lifecycle ──────────────────────────────────────────────────────

let disposeScheduler: (() => void) | null = null;

/** Manual "sync now" (settings panel). Throws so the panel can toast failure. */
export async function syncNow(): Promise<void> {
  try {
    await runCycle();
  } catch (error) {
    setStatus({
      state: "error",
      lastError: error instanceof Error ? error.message : String(error),
      progress: null,
      cycleTotals: null,
    });
    throw error;
  }
}

/**
 * Start the cadence if (and only if) sync is enabled and the credentials are
 * present. Safe to call repeatedly — each call replaces the previous schedule.
 * Returns the disposer (also stored, for restartSyncScheduler).
 */
export function startSyncScheduler(): () => void {
  disposeScheduler?.();
  if (!isTauri()) return () => {};

  let disposed = false;
  let timer: number | null = null;
  let pushDebounce: number | null = null;
  let failures = 0;

  const schedule = (ms: number) => {
    if (disposed) return;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(tick, ms);
  };

  const tick = () => {
    void runCycle()
      .then(() => {
        failures = 0;
        schedule(PULL_INTERVAL_MS);
      })
      .catch((error) => {
        failures += 1;
        setStatus({
          state: "error",
          lastError: error instanceof Error ? error.message : String(error),
          progress: null,
          cycleTotals: null,
        });
        schedule(nextSyncDelayMs(failures, { baseMs: PULL_INTERVAL_MS }));
      });
  };

  const offBroadcast = onDomainEventBroadcast(() => {
    // A local write: push soon, but let a burst (import, batch edit) settle.
    if (disposed) return;
    if (pushDebounce !== null) window.clearTimeout(pushDebounce);
    pushDebounce = window.setTimeout(tick, PUSH_DEBOUNCE_MS);
  });
  const onFocus = () => tick();
  // Mobile lifecycle: a backgrounded webview pauses timers, so a scheduled
  // retry can sleep indefinitely. Coming back to the foreground resumes the
  // cadence immediately (desktop windows fire plain `focus` instead).
  const onVisible = () => {
    if (document.visibilityState === "visible") tick();
  };

  void (async () => {
    const profile = await getSyncProfile().catch(() => null);
    if (disposed) return;
    if (!profile?.syncEnabled || !getSecret("sync.session") || !getSecret("sync.master-key")) {
      setStatus({ state: "disabled" });
      return;
    }
    window.addEventListener("focus", onFocus);
    setStatus({ state: "idle" });
    tick();
  })();

  disposeScheduler = () => {
    disposed = true;
    if (timer !== null) window.clearTimeout(timer);
    if (pushDebounce !== null) window.clearTimeout(pushDebounce);
    offBroadcast();
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisible);
    disposeScheduler = null;
  };
  return disposeScheduler;
}

/** After connect/disconnect: rebuild the engine (new session/key) and rerun. */
export function restartSyncScheduler(): void {
  engine = null;
  startSyncScheduler();
}

// ── Connect / disconnect bookkeeping (called by the settings panel) ──────────

export async function persistConnection(options: {
  session: string;
  accountId: string;
  masterKeyBase64: string;
}): Promise<void> {
  setSecret("sync.session", options.session);
  setSecret("sync.master-key", options.masterKeyBase64);
  // Before the scheduler wakes up against this account: if the bookkeeping
  // belongs to a different one, it resets here — otherwise "already pushed"
  // marks earned against the OLD account's mailbox would silently withhold
  // the entire history from the new one.
  await adoptSyncAccount(options.accountId);
  const profile = await getSyncProfile();
  await setSyncProfile({
    ...profile,
    syncEnabled: true,
    remoteAccountId: options.accountId,
    encryptionKeyRef: "sync.master-key",
  });
  // Credentials that predate this connection (an API key entered while
  // offline) get sealed into the log now, so they roam without waiting for
  // their next edit.
  republishRoamingSecrets();
  restartSyncScheduler();
}

export async function disconnectSync(): Promise<void> {
  try {
    await syncRelayClient().logout();
  } catch {
    // Best effort — the local teardown must succeed regardless.
  }
  deleteSecret("sync.session");
  deleteSecret("sync.master-key");
  const profile = await getSyncProfile();
  await setSyncProfile({
    ...profile,
    syncEnabled: false,
    remoteAccountId: null,
    encryptionKeyRef: null,
  });
  restartSyncScheduler();
}
