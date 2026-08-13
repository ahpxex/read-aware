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
import { isTauri } from "../environment";
import { observeRemoteHlcStamps, onDomainEventBroadcast } from "../domain-events";
import { localKV } from "../local-store";
import { deleteSecret, getSecret, setSecret } from "../secret-store";
import { fromBase64 } from "../sync-envelope";
import { createRelayClient, type RelayClient } from "./relay-client";
import { createSyncEngine, nextSyncDelayMs, type SyncEngine } from "./sync-engine";
import { createIpcSyncStore, getSyncProfile, setSyncProfile } from "./sync-store";

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
};

let status: SyncStatusSnapshot = { state: "disabled", lastSyncAt: null, lastError: null };
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
  });
}

let engine: SyncEngine | null = null;
const getEngine = (): SyncEngine => (engine ??= buildEngine());

let running = false;

async function runCycle(): Promise<void> {
  if (running) return;
  running = true;
  setStatus({ state: "syncing" });
  try {
    await getEngine().syncOnce();
    setStatus({ state: "idle", lastSyncAt: Date.now(), lastError: null });
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
  const profile = await getSyncProfile();
  await setSyncProfile({
    ...profile,
    syncEnabled: true,
    remoteAccountId: options.accountId,
    encryptionKeyRef: "sync.master-key",
  });
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
