import { actorFromEvent, causalActor, ObservationCauses, stampEventCause, type DomainActor } from "../domain-actor";
/**
 * The sync scheduler: owns the singleton engine and its cadence. Started once
 * at boot (App.tsx); the settings panel talks to the same singleton for
 * "sync now", connect/disconnect restarts, and status display.
 *
 * Cadence (relay): pull-push cycle on start, then every PULL_INTERVAL_MS while
 * the app is focused; a commit broadcast nudges a push after a short debounce;
 * window focus pulls (the other device may have moved while we were away);
 * failures back off exponentially (nextSyncDelayMs) instead of hammering the
 * relay.
 *
 * Cadence (plugin transport): none. A transport is dumb storage the user
 * pointed us at — a WebDAV folder on a rate-limited provider, typically — so
 * the scheduler only binds the connection and reports status; every cycle is
 * an explicit "sync now" (settings, header indicator, Agent). No interval, no
 * focus pull, no push-on-write, no retry timer.
 */
import { flushRestoredCredentialPublications } from "../restored-credential-publication";
import { AppError, ERR_SYNC_NETWORK, type OperationCondition } from "@read-aware/core";
import { invoke } from "../ipc";
import { isTauri } from "../environment";
import { emitAppEvent } from "../app-events";
import { hydrateMissingCovers, stopCoverHydration } from "./cover-hydrator";
import { hydrateMissingFonts, stopFontHydration } from "./font-hydrator";
import { reconcileDuplicateBooks } from "../book-dedupe";
import { localDeviceId, observeRemoteHlcStamps, onDomainEventBroadcast } from "../domain-events";
import { localKV, flushLocalKV } from "../local-store";
import { durableWrites } from "../write-settlement";
import { SyncWorkGate } from "./sync-work-gate";
import { createLogger } from "../logger";
import { refreshRoamingPreferences, republishRoamingSecrets } from "../roaming-preferences";
import { afterSecretWrites, deleteSecretAsync, getSecret, setSecretAsync } from "../secret-store";
import { fromBase64 } from "../sync-envelope";
import { classifySyncError } from "./classify-sync-error";
import { createRelayClient, RelayError, RelayMisdirectedError, type RelayClient } from "./relay-client";
import {
  createSyncEngine,
  nextSyncDelayMs,
  type SyncCycleOutcome,
  type SyncCycleProgress,
  type SyncEngine,
} from "./sync-engine";
import { adoptSyncAccount, createIpcSyncStore, getSyncProfile, setSyncProfile } from "./sync-store";
import {
  findSyncTransport,
  onSyncTransportsChanged,
  parseTransportAccountId,
  transportAccountId,
} from "./transport-registry";
import { createTransportFeedRelay, type TransportFeedJournal } from "./transport-feed";
import { TransportSessionCache } from "./transport-session-cache";
import { resolveRelayUrl } from "./relay-url";
import { lastSuccessfulSyncAt } from "./sync-status";

export { DEFAULT_RELAY_URL } from "./relay-url";

const log = createLogger("sync");

/** Dev override (localKV): point the client at `wrangler dev`. */
const RELAY_URL_KV_KEY = "read-aware-sync-relay-url";

const PULL_INTERVAL_MS = 5 * 60_000;
const PUSH_DEBOUNCE_MS = 3_000;

export function relayBaseUrl(): string {
  return resolveRelayUrl(localKV.getItem(RELAY_URL_KV_KEY));
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
  lastCycle: { pulled: number; pushed: number; blobs: number; backfilled?: number } | null;
  /** Pre-frontier events still to backfill behind a snapshot bootstrap;
   *  0 once the log is complete (also 0 when no bootstrap happened). */
  backfillRemaining: number;
};

let status: SyncStatusSnapshot = stampEventCause({
  state: "disabled",
  accountConnected: false,
  backend: null,
  transportRef: null,
  lastSyncAt: null,
  lastErrorCode: null,
  progress: null,
  cycleTotals: null,
  lastCycle: null,
  backfillRemaining: 0,
});
const statusListeners = new Set<(source: object) => void>();

export const getSyncStatusSnapshot = (): SyncStatusSnapshot => status;
export function subscribeSyncStatus(listener: (source: object) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}
function setStatus(next: Partial<SyncStatusSnapshot>, origin: DomainActor = "system"): void {
  status = stampEventCause({ ...status, ...next }, origin);
  const source = status;
  for (const listener of [...statusListeners]) listener(source);
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
      return typeof parsed?.endpointId === "string" && Array.isArray(parsed.devices) && Array.isArray(parsed.order)
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

const newTransportSessions = () =>
  new TransportSessionCache(findSyncTransport, (error) => log.warn("Transport session cleanup failed", error));
let transportSessions = newTransportSessions();
onSyncTransportsChanged(() => transportSessions.refresh());

let engine: SyncEngine | null = null;
// SyncWorkGate serializes physical cycles and blob reads; detach the sink on settlement.
let progressSink: ((progress: SyncCycleProgress) => void) | undefined;

async function resolveEngine(): Promise<SyncEngine> {
  if (engine) return engine;
  const sessions = transportSessions;
  const profile = await getSyncProfile();
  const connection = parseTransportAccountId(profile.remoteAccountId);
  const relay = connection
    ? createTransportFeedRelay({
        session: () => sessions.get(connection),
        deviceId: await localDeviceId(),
        endpointId: connection.endpointId,
        store: transportJournalStore,
      })
    : syncRelayClient();
  if (sessions !== transportSessions)
    throw new AppError("plugin/cancelled", "Sync connection changed while resolving engine");
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
    onProgress: (progress) => progressSink?.(progress),
  });
  return engine;
}

/** 401 = the relay no longer knows this session; nothing but a re-login helps. */
const isAuthRejection = (error: unknown): boolean => error instanceof RelayError && error.status === 401;

const syncWork = new SyncWorkGate();
let running = false;

/** How soon the next cycle runs while a bootstrap's backfill is still owed. */
const BACKFILL_FOLLOW_UP_MS = 1_500;

function runCycle(
  isCurrent = () => true,
  origin: DomainActor = causalActor("system"),
): Promise<SyncCycleOutcome | null> {
  return syncWork.run(() => (isCurrent() ? runAcceptedCycle(origin) : Promise.resolve(null)));
}

async function runAcceptedCycle(origin: DomainActor): Promise<SyncCycleOutcome | null> {
  if (running) return null;
  running = true;
  progressSink = (progress) => setStatus({ progress }, origin);
  // Denominators first: what the outbox holds now is what this cycle's push
  // and blob phases will work through. Best-effort — without them the ring
  // just stays indeterminate.
  let cycleTotals: SyncStatusSnapshot["cycleTotals"] = null;
  try {
    cycleTotals = await invoke<{ events: number; blobs: number }>("sync_outbox_counts");
  } catch {
    // Non-Tauri or transient failure: progress still renders, just unmeasured.
  }
  setStatus(
    {
      state: "syncing",
      progress: {
        phase: "pull",
        pulled: 0,
        pushed: 0,
        verified: 0,
        backfilled: 0,
        backfillFrontier: 0,
        backfillCursor: 0,
        blobsDone: 0,
        blobsTotal: 0,
        blobKey: null,
        blobDirection: null,
        blobPartsDone: 0,
        blobPartsTotal: 0,
      },
      cycleTotals,
    },
    origin,
  );
  try {
    await flushRestoredCredentialPublications();
    const outcome = await (await resolveEngine()).syncOnce();
    const { pulled, pushed, blobs, bootstrapped } = outcome;
    if (pulled > 0 || bootstrapped) {
      // Another device may have imported content this shelf already holds —
      // collapse same-sha records BEFORE announcing, so the reload that
      // follows paints the merged shelf, not a momentary duplicate.
      await reconcileDuplicateBooks();
      // Merged events write projections straight through Rust — nothing else
      // tells the mounted UI. The shelf already reloads on this event.
      emitAppEvent("library-changed", {}, origin);
      // Mounted conversations must re-read too: their save path diffs the
      // in-memory transcript, and a stale one would keep hiding (though never
      // deleting — see ai_chat_commit) freshly merged peer messages.
      emitAppEvent("conversations-changed", {}, origin);
      // Roamed preferences (theme, typography) follow the same wake-up:
      // re-overlay the projection onto KV and announce what moved.
      await refreshRoamingPreferences(origin);
    }
    setStatus(
      {
        state: "idle",
        lastSyncAt: Date.now(),
        lastErrorCode: null,
        progress: null,
        cycleTotals: null,
        lastCycle: { pulled, pushed, blobs, backfilled: outcome.backfilled },
        backfillRemaining: outcome.backfillRemaining,
      },
      origin,
    );
    // Covers other devices extracted: fetch whatever the shelf still lacks.
    // Runs after EVERY cycle (not just pulls) because the peer's cover upload
    // produces no event to pull — only its bytes appearing on the relay.
    void hydrateMissingCovers(fetchRemoteBlob, { reset: pulled > 0 || bootstrapped, origin });
    // Imported fonts converge the same way: fetch missing bytes, release
    // bytes a pulled removal queued up.
    void hydrateMissingFonts(fetchRemoteBlob, { reset: pulled > 0 || bootstrapped, origin });
    return outcome;
  } finally {
    progressSink = undefined;
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

export function fetchRemoteBlob(key: string, origin: DomainActor = "system"): Promise<RemoteBlobFetch> {
  origin = causalActor(origin);
  return syncWork.run(() => fetchAcceptedRemoteBlob(key, origin));
}

/** Read-only local admission used both by discovery and the accepted download.
 * Never resolves an engine, opens a transport, probes, or returns credentials. */
async function remoteBlobAdmission(): Promise<{
  reason?: "not-tauri" | "sync-off" | "not-connected";
  conditions: OperationCondition[];
}> {
  const blocked = (
    reason: "not-tauri" | "sync-off" | "not-connected",
    kind: OperationCondition["kind"],
    detail: string,
  ) => ({
    reason,
    conditions: [
      {
        kind,
        state: reason === "not-tauri" ? ("unavailable" as const) : ("unconfigured" as const),
        reason: detail,
        errorCode: "library/content-unavailable",
      },
    ],
  });
  if (!isTauri()) return blocked("not-tauri", "provider", "desktop-required");
  const profile = await getSyncProfile();
  if (!profile.syncEnabled) return blocked("sync-off", "provider", "source-sync-disabled");
  // A transport connection has no relay session — the master key plus the
  // profile binding are its whole credential set.
  const connection = parseTransportAccountId(profile.remoteAccountId);
  const credentials = await afterSecretWrites(
    () => !!getSecret("sync.master-key") && (!!connection || !!getSecret("sync.session")),
  );
  if (!credentials) return blocked("not-connected", "account", "source-sync-credentials-missing");
  if (connection && !findSyncTransport(connection.ref))
    return blocked("not-connected", "provider", "source-transport-unavailable");
  return {
    conditions: [
      { kind: "account", state: "satisfied", reason: "source-sync-credentials-present" },
      { kind: "provider", state: "unknown", reason: "source-download-not-checked" },
    ],
  };
}

export async function getRemoteBlobFetchConditions(signal?: AbortSignal): Promise<OperationCondition[]> {
  signal?.throwIfAborted();
  const result = await remoteBlobAdmission();
  signal?.throwIfAborted();
  return result.conditions;
}

async function fetchAcceptedRemoteBlob(
  key: string,
  origin: DomainActor = causalActor("system"),
): Promise<RemoteBlobFetch> {
  const admission = await remoteBlobAdmission();
  if (admission.reason) return { outcome: "unavailable", reason: admission.reason };
  // Surface the download like any sync activity: the indicator ring narrates
  // "syncing <book> n/m" while parts stream in, then yields to the prior state.
  const restoreState = status.state === "syncing" ? null : status.state;
  progressSink = (progress) => setStatus({ progress }, origin);
  setStatus({ state: "syncing" }, origin);
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
    progressSink = undefined;
    if (restoreState !== null) setStatus({ state: restoreState, progress: null }, origin);
  }
}

/** Host-only backup admission. Acquire BEFORE plugin-data exclusion: an
 * accepted cycle may still need to finish its roaming preference overlay.
 * The supplied fetcher is valid only within this operation, allowing the v1
 * exporter to retrieve missing source bytes without waiting behind itself. */
export function withSyncBackup<T>(
  operation: (fetchBlob: typeof fetchRemoteBlob) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  return syncWork.withPaused(async (runOwned) => {
    // Transport journals use the write-through KV queue; commit observers can
    // enqueue events after their native receipts. Preserve that causal tail.
    await flushLocalKV();
    // Cancelling backup must not release a cycle's still-dispatched event tail.
    await durableWrites.settle();
    signal?.throwIfAborted();
    return operation((key, origin) => runOwned(() => fetchAcceptedRemoteBlob(key, origin)));
  }, signal);
}

// ── Scheduler lifecycle ──────────────────────────────────────────────────────

let disposeScheduler: (() => void) | null = null;
let connectionGeneration = 0;
export const getSyncConnectionGeneration = () => connectionGeneration;

/** Manual "sync now" (settings panel). Throws so the panel can toast failure. */
export async function syncNow(origin: DomainActor = "user"): Promise<SyncCycleOutcome | null> {
  origin = causalActor(origin);
  try {
    return await runCycle(undefined, origin);
  } catch (error) {
    log.error("manual sync failed", error);
    setStatus(
      {
        state: isAuthRejection(error) ? "unauthenticated" : "error",
        lastErrorCode: classifySyncError(error),
        progress: null,
        cycleTotals: null,
      },
      origin,
    );
    throw error;
  }
}

/**
 * Start the cadence if (and only if) sync is enabled and the credentials are
 * present. Safe to call repeatedly — each call replaces the previous schedule.
 * Returns the disposer (also stored, for restartSyncScheduler).
 */
export function startSyncScheduler(origin: DomainActor = "system"): () => void {
  origin = causalActor(origin);
  connectionGeneration++;
  disposeScheduler?.();
  // Restarting is also the account-boundary transition. Clear the previous
  // account's live status synchronously while the persisted profile loads.
  setStatus(
    {
      state: "disabled",
      accountConnected: false,
      backend: null,
      transportRef: null,
      lastSyncAt: null,
      lastErrorCode: null,
      progress: null,
      cycleTotals: null,
      lastCycle: null,
      backfillRemaining: 0,
    },
    origin,
  );
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

  const schedule = (ms: number, origin?: DomainActor) => {
    if (disposed) return;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => tick(origin), ms);
  };

  // A dead session cannot heal on its own, so retrying (or keeping the
  // doorbell alive) would only hammer the relay with 401s. Go dormant; a
  // reconnect through the settings panel restarts the scheduler fresh.
  const onAuthRejected = (origin: DomainActor = "system") => {
    if (sessionRejected) return;
    sessionRejected = true;
    if (timer !== null) window.clearTimeout(timer);
    if (pushDebounce !== null) window.clearTimeout(pushDebounce);
    if (watchReconnect !== null) window.clearTimeout(watchReconnect);
    if (doorbellDebounce !== null) window.clearTimeout(doorbellDebounce);
    watchSocket?.close();
    watchSocket = null;
    setStatus(
      {
        state: "unauthenticated",
        lastErrorCode: null,
        progress: null,
        cycleTotals: null,
      },
      origin,
    );
  };

  const tick = (origin: DomainActor = causalActor("system")) => {
    if (disposed || sessionRejected) return;
    void runCycle(() => !disposed && !sessionRejected, origin)
      .then((outcome) => {
        if (disposed) return;
        failures = 0;
        // A bootstrapped device owes the pre-frontier log: keep cycling
        // briskly (each cycle backfills a bounded slice) until it is whole.
        const backfill = !!outcome && outcome.backfillRemaining > 0;
        schedule(backfill ? BACKFILL_FOLLOW_UP_MS : PULL_INTERVAL_MS, backfill ? origin : undefined);
      })
      .catch((error) => {
        if (disposed) return;
        if (isAuthRejection(error)) {
          onAuthRejected(origin);
          return;
        }
        failures += 1;
        log.error("sync cycle failed", error);
        // The pull half may well have landed before a later stage failed —
        // covers other devices extracted are still worth fetching. Not when
        // the relay itself is unreachable: that pass could only fail too.
        if (classifySyncError(error) !== ERR_SYNC_NETWORK) {
          void hydrateMissingCovers(fetchRemoteBlob, { origin });
          void hydrateMissingFonts(fetchRemoteBlob, { origin });
        }
        setStatus(
          {
            state: "error",
            lastErrorCode: classifySyncError(error),
            progress: null,
            cycleTotals: null,
          },
          origin,
        );
        // A relay that said when to come back (its per-account request budget)
        // knows better than our backoff curve: resume right as the window
        // reopens, not ten minutes later.
        const retryAfter = error instanceof RelayError ? error.retryAfterMs : null;
        schedule(retryAfter ?? nextSyncDelayMs(failures, { baseMs: PULL_INTERVAL_MS }), origin);
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
      watchReconnect = window.setTimeout(() => {
        void openWatch();
      }, delay);
    };
    socket.onerror = () => socket.close();
  };

  // Registered only once the connection is confirmed below: a local write on
  // a disconnected device (a preference at boot, anything after sign-out)
  // must not wake a cycle that can only fail with "no master key".
  const pushCauses = new ObservationCauses();
  let offBroadcast: (() => void) | null = null;
  const onFocus = () => tick();
  // Mobile lifecycle: a backgrounded webview pauses timers, so a scheduled
  // retry can sleep indefinitely. Coming back to the foreground resumes the
  // cadence immediately (desktop windows fire plain `focus` instead).
  const onVisible = () => {
    if (document.visibilityState === "visible") tick();
  };

  void (async () => {
    const profile = await getSyncProfile().catch((error: unknown) => {
      log.warn("Sync profile unreadable; scheduled sync stays off", error);
      return null;
    });
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
    setStatus(
      {
        state: "idle",
        accountConnected: true,
        backend: connection ? "transport" : "relay",
        transportRef: connection?.ref ?? null,
        lastSyncAt: lastSuccessfulSyncAt(profile),
      },
      origin,
    );
    // Duplicates that predate this build (or arrived while sync was off)
    // reconcile once at start; pull-time detection covers everything after.
    void syncWork.run(() => (disposed ? Promise.resolve(0) : reconcileDuplicateBooks()));
    if (connection) {
      // Manual cadence: the connection is bound and reported, nothing runs
      // until the user (or an Agent tool acting for them) asks. `syncNow`
      // resolves the transport from the registry per cycle, so a plugin that
      // is still activating simply fails that one explicit request with
      // "transport unavailable" instead of being polled for.
      return;
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    offBroadcast = onDomainEventBroadcast((event) => {
      // A local write: push soon, but let a burst (import, batch edit) settle.
      if (disposed) return;
      if (pushDebounce !== null) window.clearTimeout(pushDebounce);
      pushCauses.add(event);
      pushDebounce = window.setTimeout(() => tick(actorFromEvent(pushCauses.take({}))), PUSH_DEBOUNCE_MS);
    });
    // The doorbell socket is a relay feature.
    void openWatch();
    tick(origin);
  })();

  disposeScheduler = () => {
    disposed = true;
    transportSessions.stop();
    transportSessions = newTransportSessions();
    engine = null;
    if (timer !== null) window.clearTimeout(timer);
    if (pushDebounce !== null) window.clearTimeout(pushDebounce);
    if (watchReconnect !== null) window.clearTimeout(watchReconnect);
    if (doorbellDebounce !== null) window.clearTimeout(doorbellDebounce);
    watchSocket?.close();
    watchSocket = null;
    offBroadcast?.();
    stopCoverHydration();
    stopFontHydration();
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisible);
    disposeScheduler = null;
  };
  return disposeScheduler;
}

/** After connect/disconnect: rebuild the engine (new session/key) and rerun. */
export function restartSyncScheduler(origin: DomainActor = "system"): void {
  origin = causalActor(origin);
  engine = null;
  transportSessions.stop();
  transportSessions = newTransportSessions();
  startSyncScheduler(origin);
}

// ── Connect / disconnect bookkeeping (called by the settings panel) ──────────

export async function persistConnection(
  options: {
    session: string;
    accountId: string;
    masterKeyBase64: string;
  },
  origin: DomainActor = "user",
): Promise<void> {
  origin = causalActor(origin);
  return syncWork.run(async () => {
    await setSecretAsync("sync.session", options.session, "local", origin);
    await setSecretAsync("sync.master-key", options.masterKeyBase64, "local", origin);
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
    await republishRoamingSecrets();
    restartSyncScheduler(origin);
  });
}

export async function disconnectSync(origin: DomainActor = "user"): Promise<void> {
  origin = causalActor(origin);
  return syncWork.run(async () => {
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
    await deleteSecretAsync("sync.session", "local", origin);
    await deleteSecretAsync("sync.master-key", "local", origin);
    await setSyncProfile({
      ...profile,
      syncEnabled: false,
      remoteAccountId: null,
      encryptionKeyRef: null,
    });
    restartSyncScheduler(origin);
  });
}

/**
 * Bind sync to a plugin transport's mailbox — the transport-mode counterpart
 * of `persistConnection`. The caller has already run the passphrase ritual
 * against the transport's key material (`establishEncryptionWithStore`);
 * this persists the outcome and hands the cadence over to the scheduler.
 * Mutual exclusion with the relay is structural: one profile row, one
 * master key, one outbox binding.
 */
export async function persistTransportConnection(
  options: {
    ref: string;
    endpointId: string;
    masterKeyBase64: string;
  },
  origin: DomainActor = "user",
): Promise<void> {
  origin = causalActor(origin);
  return syncWork.run(async () => {
    await setSecretAsync("sync.master-key", options.masterKeyBase64, "local", origin);
    // No relay session in transport mode; a leftover one must not linger as a
    // phantom credential.
    await deleteSecretAsync("sync.session", "local", origin);
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
    await republishRoamingSecrets();
    restartSyncScheduler(origin);
  });
}
