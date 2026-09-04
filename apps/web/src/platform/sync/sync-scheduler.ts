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
import { AppError, ERR_SYNC_TRANSPORT_MISMATCH, ERR_SYNC_TRANSPORT_UNAVAILABLE } from "@read-aware/core";
import type { PluginSyncTransportSession } from "@read-aware/plugin-types";
import { invoke } from "../ipc";
import { isTauri } from "../environment";
import { emitAppEvent } from "../app-events";
import { hydrateMissingCovers, stopCoverHydration } from "./cover-hydrator";
import { reconcileDuplicateBooks } from "../book-dedupe";
import { localDeviceId, observeRemoteHlcStamps, onDomainEventBroadcast } from "../domain-events";
import { localKV } from "../local-store";
import { createLogger } from "../logger";
import { refreshRoamingPreferences, republishRoamingSecrets } from "../roaming-preferences";
import { deleteSecret, getSecret, setSecret } from "../secret-store";
import { fromBase64 } from "../sync-envelope";
import { classifySyncError } from "./classify-sync-error";
import { clearReauthNoticeDismissal } from "./reauth-notice";
import { createRelayClient, RelayError, RelayMisdirectedError, type RelayClient } from "./relay-client";
import {
  createSyncEngine,
  nextSyncDelayMs,
  type SyncCycleProgress,
  type SyncEngine,
} from "./sync-engine";
import { adoptSyncAccount, createIpcSyncStore, getSyncProfile, setSyncProfile } from "./sync-store";
import {
  findSyncTransport,
  onSyncTransportsChanged,
  parseTransportAccountId,
  transportAccountId,
  type TransportAccountRef,
} from "./transport-registry";
import { createTransportFeedRelay, type TransportFeedJournal } from "./transport-feed";
import { isDevBundle } from "../app-identity";
import { lastSuccessfulSyncAt } from "./sync-status";

const log = createLogger("sync");

export const DEFAULT_RELAY_URL = "https://relay.readaware.app";
/** Dev override (localKV): point the client at `wrangler dev`. */
const RELAY_URL_KV_KEY = "read-aware-sync-relay-url";

/**
 * Dev-session default when no KV override exists: `VITE_READAWARE_RELAY_URL`
 * baked by the dev server. The KV override is DATA, so "Delete all data"
 * rightly wipes it — which used to silently re-point a dev install at
 * production mid-test. Env-var fallback survives any wipe; production builds
 * never see it (DEV-gated, and the release pipeline sets no such var).
 */
/** Where a dev-IDENTIFIED bundle points when nothing else says otherwise. */
const DEV_BUNDLE_RELAY_URL = "http://localhost:8787";

function defaultRelayUrl(): string {
  // Present ONLY when a developer bakes it (dev server env, or a dev-signed
  // bundled build for a device that cannot reach a dev server) — the release
  // pipeline sets no such variable, so production always falls through.
  const dev = import.meta.env.VITE_READAWARE_RELAY_URL as string | undefined;
  if (dev) {
    if (import.meta.env.DEV) {
      // On a phone, "localhost" is the phone — the URL needs the dev
      // machine's address instead. The Tauri CLI knows it exactly
      // (TAURI_DEV_HOST, baked in by vite.config), so prefer that ground
      // truth over any guessing.
      const devHost = import.meta.env.VITE_TAURI_DEV_HOST as string | undefined;
      if (devHost) return dev.replace("localhost", devHost);
      // No TAURI_DEV_HOST: fall back to the page's own hostname — the
      // frontend was served from the dev machine, so on a LAN-served device
      // that hostname reaches it. But NEVER substitute a `*.localhost` host:
      // that is Tauri's own proxy scheme (`tauri.localhost` on mobile dev
      // without TAURI_DEV_HOST), and its interceptor answers EVERY port with
      // the SPA itself — the relay would "reply" 200 index.html and every
      // sync call would fail with a misleading decode error. Keeping
      // "localhost" fails honestly (connection refused) instead.
      const pageHost = window.location.hostname;
      if (
        pageHost &&
        pageHost !== "localhost" &&
        pageHost !== "127.0.0.1" &&
        !pageHost.endsWith(".localhost")
      ) {
        return dev.replace("localhost", pageHost);
      }
    }
    // Bundled dev builds load from tauri://localhost — no page host to
    // follow, so the baked URL must already be the reachable address.
    return dev;
  }
  // The last fallback is gated on runtime identity: a dev-IDENTIFIED bundle
  // built in release mode (`tauri build --config tauri.dev.conf.json`) sees
  // no VITE_* defaults at all, and without this guard would silently point a
  // dev install at the production relay. Local relay or bust — an
  // unreachable local relay fails loudly instead of polluting production.
  if (isDevBundle()) return DEV_BUNDLE_RELAY_URL;
  return DEFAULT_RELAY_URL;
}

const PULL_INTERVAL_MS = 5 * 60_000;
const PUSH_DEBOUNCE_MS = 3_000;

export function relayBaseUrl(): string {
  const raw = localKV.getItem(RELAY_URL_KV_KEY);
  if (!raw) return defaultRelayUrl();
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "string" && parsed.length > 0 ? parsed : defaultRelayUrl();
  } catch {
    return raw;
  }
}

// ── Status (subscribable snapshot for useSyncExternalStore) ──────────────────

export type SyncStatusSnapshot = {
  /**
   * `unauthenticated`: credentials exist locally but the relay rejected the
   * session (401). Unlike `error` it is terminal — no retry heals a dead
   * session — so the scheduler goes dormant until a reconnect restarts it.
   */
  state: "disabled" | "idle" | "syncing" | "error" | "unauthenticated";
  /** The local profile and both credentials identify a connected account. */
  accountConnected: boolean;
  /** Which remote the scheduler is bound to: the first-party relay, a
   *  plugin-provided transport, or nothing (disconnected). */
  backend: "relay" | "transport" | null;
  /** Registry ref (`plugin:<id>:<transport>`) when `backend === "transport"`
   *  — the UI resolves it to the transport's label. */
  transportRef: string | null;
  lastSyncAt: number | null;
  /** Stable code for the last failure (classify-sync-error); raw text is log-only. */
  lastErrorCode: string | null;
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
  accountConnected: false,
  backend: null,
  transportRef: null,
  lastSyncAt: null,
  lastErrorCode: null,
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

// ── Plugin-transport backend plumbing ────────────────────────────────────────

/** Journal for the transport feed (see transport-feed.ts) — device-local
 *  bookkeeping, wiped with the rest of the KV by "Delete all data". */
const TRANSPORT_JOURNAL_KV_KEY = "read-aware-sync-transport-journal";

const transportJournalStore = {
  load(): TransportFeedJournal | null {
    const raw = localKV.getItem(TRANSPORT_JOURNAL_KV_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as TransportFeedJournal;
      return typeof parsed?.endpointId === "string" &&
        Array.isArray(parsed.devices) &&
        Array.isArray(parsed.order)
        ? parsed
        : null;
    } catch {
      // Corrupt bookkeeping heals by re-listing + idempotent re-apply.
      return null;
    }
  },
  save(journal: TransportFeedJournal): void {
    localKV.setItem(TRANSPORT_JOURNAL_KV_KEY, JSON.stringify(journal));
  },
};

/**
 * The live transport session, memoized across engine calls and dropped on
 * failure or on any registry change (plugin restart, update) so the next call
 * re-resolves against whatever is registered NOW. `open()` is contractually
 * network-free, so re-opening is cheap.
 */
let transportSession: Promise<PluginSyncTransportSession> | null = null;
onSyncTransportsChanged(() => {
  transportSession = null;
});

function transportSessionFor(
  connection: TransportAccountRef,
): Promise<PluginSyncTransportSession> {
  if (!transportSession) {
    const opened = (async () => {
      const transport = findSyncTransport(connection.ref);
      if (!transport) {
        throw new AppError(
          ERR_SYNC_TRANSPORT_UNAVAILABLE,
          `sync transport "${connection.ref}" is not registered (plugin disabled or failed)`,
        );
      }
      const session = await transport.open();
      if (session.endpointId !== connection.endpointId) {
        throw new AppError(
          ERR_SYNC_TRANSPORT_MISMATCH,
          `sync transport "${connection.ref}" now points at a different endpoint — reconnect to adopt it`,
        );
      }
      return session;
    })();
    transportSession = opened;
    opened.catch(() => {
      // Never memoize a failure; the next call re-resolves.
      if (transportSession === opened) transportSession = null;
    });
  }
  return transportSession;
}

let engine: SyncEngine | null = null;

async function resolveEngine(): Promise<SyncEngine> {
  if (engine) return engine;
  const profile = await getSyncProfile();
  const connection = parseTransportAccountId(profile.remoteAccountId);
  const relay = connection
    ? createTransportFeedRelay({
        session: () => transportSessionFor(connection),
        deviceId: await localDeviceId(),
        endpointId: connection.endpointId,
        store: transportJournalStore,
      })
    : syncRelayClient();
  engine ??= createSyncEngine({
    store: createIpcSyncStore(),
    relay,
    masterKey: () => {
      const b64 = getSecret("sync.master-key");
      return b64 ? fromBase64(b64) : null;
    },
    observe: observeRemoteHlcStamps,
    // Every page/batch/blob lands in the status snapshot, which is what the
    // header indicator and the Data & Sync panel subscribe to.
    onProgress: (progress) => setStatus({ progress }),
  });
  return engine;
}

/** 401 = the relay no longer knows this session; nothing but a re-login helps. */
const isAuthRejection = (error: unknown): boolean =>
  error instanceof RelayError && error.status === 401;

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
    progress: {
      phase: "pull",
      pulled: 0,
      pushed: 0,
      blobsDone: 0,
      blobsTotal: 0,
      blobKey: null,
      blobDirection: null,
      blobPartsDone: 0,
      blobPartsTotal: 0,
    },
    cycleTotals,
  });
  try {
    const { pulled, pushed, blobs } = await (await resolveEngine()).syncOnce();
    if (pulled > 0) {
      // Another device may have imported content this shelf already holds —
      // collapse same-sha records BEFORE announcing, so the reload that
      // follows paints the merged shelf, not a momentary duplicate.
      await reconcileDuplicateBooks();
      // Merged events write projections straight through Rust — nothing else
      // tells the mounted UI. The shelf already reloads on this event.
      emitAppEvent("library-changed", {});
      // Mounted conversations must re-read too: their save path upserts the
      // in-memory transcript, and a stale one would keep hiding (though no
      // longer deleting — see ai_chat_replace) freshly merged peer messages.
      emitAppEvent("conversations-changed", {});
      // Roamed preferences (theme, typography) follow the same wake-up:
      // re-overlay the projection onto KV and announce what moved.
      await refreshRoamingPreferences();
    }
    setStatus({
      state: "idle",
      lastSyncAt: Date.now(),
      lastErrorCode: null,
      progress: null,
      cycleTotals: null,
      lastCycle: { pulled, pushed, blobs },
    });
    // Covers other devices extracted: fetch whatever the shelf still lacks.
    // Runs after EVERY cycle (not just pulls) because the peer's cover upload
    // produces no event to pull — only its bytes appearing on the relay.
    void hydrateMissingCovers(fetchRemoteBlob, { reset: pulled > 0 });
  } finally {
    running = false;
  }
}

/**
 * Lazy blob download for read paths (library-db). The outcome names WHY the
 * bytes are or aren't available, because the reader's error surface owes the
 * user different words (and different actions) for "sync is off", "the relay
 * never got this file", and "the relay didn't answer":
 *
 * - `fetched`      — the bytes now sit in the local store; re-read them there.
 * - `unavailable`  — this device cannot ask at all (no sync / signed out).
 * - `missing`      — the relay answered: it has no such blob. The origin
 *                    device never (successfully) uploaded it.
 * - `failed`       — the ask itself failed: dead session, wrong server,
 *                    network, or ciphertext this passphrase cannot open.
 */
export type RemoteBlobFetch =
  | { outcome: "fetched" }
  | { outcome: "unavailable"; reason: "not-tauri" | "sync-off" | "not-connected" }
  | { outcome: "missing" }
  | {
      outcome: "failed";
      reason: "unauthenticated" | "misdirected" | "undecodable" | "unreachable";
      detail: string;
    };

export async function fetchRemoteBlob(key: string): Promise<RemoteBlobFetch> {
  if (!isTauri()) return { outcome: "unavailable", reason: "not-tauri" };
  const profile = await getSyncProfile();
  if (!profile.syncEnabled) return { outcome: "unavailable", reason: "sync-off" };
  // A transport connection has no relay session — the master key plus the
  // profile binding are its whole credential set.
  const viaTransport = parseTransportAccountId(profile.remoteAccountId) !== null;
  if (!getSecret("sync.master-key") || (!viaTransport && !getSecret("sync.session"))) {
    return { outcome: "unavailable", reason: "not-connected" };
  }
  // Surface the download like any sync activity: the indicator ring narrates
  // "syncing <book> n/m" while parts stream in, then yields to the prior state.
  const restoreState = status.state === "syncing" ? null : status.state;
  setStatus({ state: "syncing" });
  try {
    const result = await (await resolveEngine()).fetchBlob(key);
    return result === "fetched" ? { outcome: "fetched" } : { outcome: "missing" };
  } catch (error) {
    log.warn(`remote blob fetch failed for "${key}"`, error);
    const detail = error instanceof Error ? error.message : String(error);
    if (isAuthRejection(error)) {
      return { outcome: "failed", reason: "unauthenticated", detail };
    }
    if (error instanceof RelayMisdirectedError) {
      return { outcome: "failed", reason: "misdirected", detail };
    }
    if (detail.startsWith("sync envelope:")) {
      return { outcome: "failed", reason: "undecodable", detail };
    }
    return { outcome: "failed", reason: "unreachable", detail };
  } finally {
    if (restoreState !== null) setStatus({ state: restoreState, progress: null });
  }
}

// ── Scheduler lifecycle ──────────────────────────────────────────────────────

let disposeScheduler: (() => void) | null = null;

/** Manual "sync now" (settings panel). Throws so the panel can toast failure. */
export async function syncNow(): Promise<void> {
  try {
    await runCycle();
  } catch (error) {
    log.error("manual sync failed", error);
    setStatus({
      state: isAuthRejection(error) ? "unauthenticated" : "error",
      lastErrorCode: classifySyncError(error),
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
  // Restarting is also the account-boundary transition. Clear the previous
  // account's live status synchronously while the persisted profile loads.
  setStatus({
    state: "disabled",
    accountConnected: false,
    backend: null,
    transportRef: null,
    lastSyncAt: null,
    lastErrorCode: null,
    progress: null,
    cycleTotals: null,
    lastCycle: null,
  });
  if (!isTauri()) return () => {};

  let disposed = false;
  let timer: number | null = null;
  let pushDebounce: number | null = null;
  let failures = 0;
  let watchSocket: WebSocket | null = null;
  let watchRetries = 0;
  let watchReconnect: number | null = null;
  let doorbellDebounce: number | null = null;
  let sessionRejected = false;

  const schedule = (ms: number) => {
    if (disposed) return;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(tick, ms);
  };

  // A dead session cannot heal on its own, so retrying (or keeping the
  // doorbell alive) would only hammer the relay with 401s. Go dormant; a
  // reconnect through the settings panel restarts the scheduler fresh.
  const onAuthRejected = () => {
    if (sessionRejected) return;
    sessionRejected = true;
    if (timer !== null) window.clearTimeout(timer);
    if (pushDebounce !== null) window.clearTimeout(pushDebounce);
    if (watchReconnect !== null) window.clearTimeout(watchReconnect);
    if (doorbellDebounce !== null) window.clearTimeout(doorbellDebounce);
    watchSocket?.close();
    watchSocket = null;
    setStatus({
      state: "unauthenticated",
      lastErrorCode: null,
      progress: null,
      cycleTotals: null,
    });
  };

  const tick = () => {
    if (sessionRejected) return;
    void runCycle()
      .then(() => {
        failures = 0;
        schedule(PULL_INTERVAL_MS);
      })
      .catch((error) => {
        if (isAuthRejection(error)) {
          onAuthRejected();
          return;
        }
        failures += 1;
        log.error("sync cycle failed", error);
        setStatus({
          state: "error",
          lastErrorCode: classifySyncError(error),
          progress: null,
          cycleTotals: null,
        });
        schedule(nextSyncDelayMs(failures, { baseMs: PULL_INTERVAL_MS }));
      });
  };

  // ── The doorbell: a WebSocket to the account mailbox ───────────────────────
  // The relay rings `{type:"changed",seq}` on every append; the handler just
  // runs the ordinary cycle, so notify-vs-poll never forks the sync logic.
  // The interval cadence stays as the safety net for a dropped socket.
  const openWatch = async () => {
    if (disposed || watchSocket || sessionRejected) return;
    if (!getSecret("sync.session")) return;
    // Trade the session for a one-shot short-TTL ticket over authenticated
    // HTTP: only the ticket rides in the socket URL, and it is consumed on
    // connect — an archived access log holds nothing reusable.
    let ticket: string;
    try {
      ticket = await syncRelayClient().watchTicket();
    } catch (error) {
      if (isAuthRejection(error)) {
        onAuthRejected();
        return;
      }
      log.warn("watch ticket unavailable; falling back to polling", error);
      return;
    }
    if (disposed || watchSocket) return;
    const base = relayBaseUrl().replace(/^http/, "ws");
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${base}/v1/events/watch?ticket=${encodeURIComponent(ticket)}`);
    } catch (error) {
      log.warn("watch socket rejected; falling back to polling", error);
      return;
    }
    watchSocket = socket;
    socket.onopen = () => {
      watchRetries = 0;
      // Catch up on anything that rang while we were disconnected.
      tick();
    };
    socket.onmessage = () => {
      // Coalesce a burst of rings (a big push lands as many appends).
      if (doorbellDebounce !== null) window.clearTimeout(doorbellDebounce);
      doorbellDebounce = window.setTimeout(tick, 300);
    };
    socket.onclose = () => {
      watchSocket = null;
      if (disposed) return;
      const delay = Math.min(60_000, 1_000 * 2 ** watchRetries);
      watchRetries += 1;
      watchReconnect = window.setTimeout(openWatch, delay);
    };
    socket.onerror = () => socket.close();
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

  let offTransports: (() => void) | null = null;

  void (async () => {
    const profile = await getSyncProfile().catch(() => null);
    if (disposed) return;
    const connection = parseTransportAccountId(profile?.remoteAccountId ?? null);
    // A transport connection has no relay session; the master key plus the
    // profile binding are its whole credential set.
    const credentialed = connection
      ? Boolean(getSecret("sync.master-key"))
      : Boolean(getSecret("sync.session") && getSecret("sync.master-key"));
    if (!profile?.syncEnabled || !profile.remoteAccountId || !credentialed) {
      return;
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    setStatus({
      state: "idle",
      accountConnected: true,
      backend: connection ? "transport" : "relay",
      transportRef: connection?.ref ?? null,
      lastSyncAt: lastSuccessfulSyncAt(profile),
    });
    // Duplicates that predate this build (or arrived while sync was off)
    // reconcile once at start; pull-time detection covers everything after.
    void reconcileDuplicateBooks();
    if (!connection) {
      // The doorbell socket is a relay feature; transports poll.
      void openWatch();
      tick();
      return;
    }
    // Plugin activation races scheduler start: when the bound transport is
    // not registered yet, wait for the registry instead of opening with a
    // guaranteed "transport unavailable" error. The interval stays as the
    // safety net; a registration (or plugin restart) ticks immediately.
    offTransports = onSyncTransportsChanged(() => {
      if (!disposed && findSyncTransport(connection.ref)) tick();
    });
    if (findSyncTransport(connection.ref)) tick();
    else schedule(PULL_INTERVAL_MS);
  })();

  disposeScheduler = () => {
    disposed = true;
    if (timer !== null) window.clearTimeout(timer);
    if (pushDebounce !== null) window.clearTimeout(pushDebounce);
    if (watchReconnect !== null) window.clearTimeout(watchReconnect);
    if (doorbellDebounce !== null) window.clearTimeout(doorbellDebounce);
    watchSocket?.close();
    watchSocket = null;
    offBroadcast();
    offTransports?.();
    stopCoverHydration();
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisible);
    disposeScheduler = null;
  };
  return disposeScheduler;
}

/** After connect/disconnect: rebuild the engine (new session/key) and rerun. */
export function restartSyncScheduler(): void {
  engine = null;
  transportSession = null;
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
  // A fresh session opens a fresh epoch: if THIS one ever dies, the "sign in
  // again" notice must prompt anew, whatever the user dismissed before.
  clearReauthNoticeDismissal();
  restartSyncScheduler();
}

export async function disconnectSync(): Promise<void> {
  const profile = await getSyncProfile();
  // Only a relay connection has a server session to revoke; a transport
  // connection tears down locally (its remote is dumb storage).
  if (!parseTransportAccountId(profile.remoteAccountId)) {
    try {
      await syncRelayClient().logout();
    } catch {
      // Best effort — the local teardown must succeed regardless.
    }
  }
  deleteSecret("sync.session");
  deleteSecret("sync.master-key");
  clearReauthNoticeDismissal();
  await setSyncProfile({
    ...profile,
    syncEnabled: false,
    remoteAccountId: null,
    encryptionKeyRef: null,
  });
  restartSyncScheduler();
}

/**
 * Bind sync to a plugin transport's mailbox — the transport-mode counterpart
 * of `persistConnection`. The caller has already run the passphrase ritual
 * against the transport's key material (`establishEncryptionWithStore`);
 * this persists the outcome and hands the cadence over to the scheduler.
 * Mutual exclusion with the relay is structural: one profile row, one
 * master key, one outbox binding.
 */
export async function persistTransportConnection(options: {
  ref: string;
  endpointId: string;
  masterKeyBase64: string;
}): Promise<void> {
  setSecret("sync.master-key", options.masterKeyBase64);
  // No relay session in transport mode; a leftover one must not linger as a
  // phantom credential.
  deleteSecret("sync.session");
  // Different mailbox ⇒ wholesale outbox/cursor reset, same as switching
  // relay accounts — "already pushed" was only ever true of the old remote.
  await adoptSyncAccount(transportAccountId(options.ref, options.endpointId));
  const profile = await getSyncProfile();
  await setSyncProfile({
    ...profile,
    syncEnabled: true,
    remoteAccountId: transportAccountId(options.ref, options.endpointId),
    encryptionKeyRef: "sync.master-key",
  });
  // Credentials that predate this connection (an API key entered while
  // offline) get sealed into the log now, so they roam without waiting for
  // their next edit.
  republishRoamingSecrets();
  restartSyncScheduler();
}
