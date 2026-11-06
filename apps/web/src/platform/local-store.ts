import {
  actorCause,
  actorOrigin,
  causalActor,
  copyEventCause,
  stampEventCause,
  type DomainActor,
} from "./domain-actor";
/**
 * The device-local persistence seam.
 *
 * Every `read-aware-*` preference module reads/writes through `localKV` instead
 * of `localStorage` directly. `localKV` mirrors the synchronous `localStorage`
 * interface (`getItem`/`setItem`/`removeItem`) so those modules — and the Jotai
 * atoms that seed synchronously from them at module-eval — need no shape change.
 *
 * Two backings, resolved by `isTauri()`:
 * - **Browser (vite dev / Storybook):** delegate straight to `localStorage`.
 *   No native runtime, fully synchronous, unchanged from before.
 * - **Desktop (Tauri):** an in-memory snapshot hydrated once at boot from the
 *   SQLite `app_kv` table (`load_kv_all`), read synchronously; writes update the
 *   snapshot immediately and persist through an ordered write-through queue.
 *   Async setters and flushLocalKV await durability; legacy synchronous
 *   setters report failures through the logger and local-write-failed event.
 *
 * `hydrateLocalStore()` MUST be awaited before the app module graph (which seeds
 * atoms synchronously) is imported — see main.tsx. Until it resolves under
 * Tauri, the snapshot is empty and reads fall back to defaults.
 */
import { runObservedDomainWrite, runDomainWrite, type RunDomainWrite } from "./domain-write-gate";
import { AppError, errorCode } from "@read-aware/core";
import { invoke } from "./ipc";
import { emitAppEvent } from "./app-events";
import { isTauri } from "./environment";
import {
  importDesktopDataIntoSqlite,
  importKvConversationsIntoSqlite,
  importWebviewMemoriesIntoSqlite,
} from "./desktop-import";
import { reconcileGenesisEvents } from "./event-genesis";
import { hydrateInterimProjections } from "./interim-projections";
import { createLogger } from "./logger";
import { hydrateSecrets } from "./secret-store";
import { initializeUserProfile, LEGACY_PROFILE_KEY } from "../domain/user-profile";
import { KVWriteQueue, type KVWriteOrigin, type KVCommit, type KVFailureOwner } from "./kv-write-queue";
import { broadcastDomainEventDrafts, dispatchMinted, type DomainEventDraft } from "./domain-events";
import { clearWebviewStorage } from "./clear-webview-storage";
export type { KVCommit } from "./kv-write-queue";

const log = createLogger("local-store");

const MIGRATED_FLAG = "read-aware-migrated-v1";
const MEMORIES_MIGRATED_FLAG = "read-aware-migrated-memories-v1";
const CONVERSATIONS_KV_KEY = "read-aware-conversations";

let snapshot: Map<string, string> | null = null;
let hydrated = false;

/**
 * Write observation — the roaming layer's single seam. Every durable KV
 * write (set or remove) flows through here, so "which namespaces roam" can
 * be pure policy instead of a publish call hand-planted in every save
 * function. Listeners must never write KV synchronously (recursion).
 */
type KVWriteListener = (key: string, value: string | null, origin: KVWriteOrigin, actor: DomainActor) => void;
const writeListeners = new Set<KVWriteListener>();
export function onLocalKVWrite(listener: KVWriteListener): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}
function notifyWrite(key: string, value: string | null, origin: KVWriteOrigin, actor: DomainActor): void {
  for (const listener of [...writeListeners]) {
    try {
      listener(key, value, origin, actor);
    } catch (error) {
      log.error("KV commit observer failed", error);
    }
  }
}

const commitListeners = new Set<(commit: KVCommit) => void>();
/** One notification per durable transaction, including restore; never optimistic values or failed writes. */
export function onLocalKVCommit(listener: (commit: KVCommit) => void): () => void {
  commitListeners.add(listener);
  return () => commitListeners.delete(listener);
}
function notifyCommit(commit: KVCommit): void {
  for (const listener of [...commitListeners]) {
    try {
      listener(copyEventCause(commit, structuredClone(commit)));
    } catch (error) {
      log.error("KV transaction observer failed", error);
    }
  }
}

const changeListeners = new Set<(key: string, value: string | null, origin: DomainActor) => void>();
const changing = new Map<string, object>();
/** Optimistic changes and rollbacks, for UI and Worker mirrors; not a durable-write feed. */
export function onLocalKVChange(
  listener: (key: string, value: string | null, origin: DomainActor) => void,
): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}
function notifyChange(key: string, value: string | null, origin: DomainActor = causalActor("system")): void {
  const notification = {};
  changing.set(key, notification);
  try {
    for (const listener of [...changeListeners]) {
      // A reentrant write already delivered the newer value and its own source.
      if (changing.get(key) !== notification) break;
      try {
        listener(key, value, origin);
      } catch (error) {
        log.error("KV mirror observer failed", error);
      }
    }
  } finally {
    if (changing.get(key) === notification) changing.delete(key);
  }
}
/**
 * Events that must commit in the SAME native transaction as a local KV write.
 * The roaming layer registers its `preference.changed` policy here, so a
 * roaming save either lands in KV together with its log entry or fails as a
 * whole — the queue then rolls back the optimistic value and emits
 * `local-write-failed`. A source must be pure: it cannot write KV.
 */
type KVEventSource = (entries: ReadonlyMap<string, string | null>, actor: DomainActor) => DomainEventDraft[];
let kvEventSource: KVEventSource | null = null;
export function setLocalKVEventSource(source: KVEventSource | null): void {
  kvEventSource = source;
}
/** The events a local write of `entries` must carry (empty for non-roaming keys). */
export function localKVEventDrafts(
  entries: ReadonlyMap<string, string | null>,
  actor: DomainActor,
): DomainEventDraft[] {
  return kvEventSource?.(entries, actor) ?? [];
}

/** Persist local entries, joining any required events to one native transaction. */
async function persistLocalEntries(
  values: ReadonlyMap<string, string | null>,
  actor: DomainActor,
  plain: () => Promise<void>,
): Promise<void> {
  const drafts = localKVEventDrafts(values, actor);
  if (!drafts.length) return plain();
  await dispatchMinted(drafts, (events) => invoke<void>("set_kv_batch", { entries: [...values], events }));
  // Observers see only events the store accepted.
  broadcastDomainEventDrafts(drafts);
}

const writes = new KVWriteQueue({
  read: (key) => snapshot?.get(key) ?? null,
  mirror: (key, value, origin) => {
    const previous = snapshot?.get(key) ?? null;
    if (value === null) snapshot?.delete(key);
    else (snapshot ??= new Map()).set(key, value);
    if (value !== previous) notifyChange(key, value, origin);
  },
  persist: (key, value, origin, actor) => {
    const plain = () => (value === null ? invoke<void>("delete_kv", { key }) : invoke<void>("set_kv", { key, value }));
    // Remote overlays already came from the log; only local edits publish.
    return origin === "local" ? persistLocalEntries(new Map([[key, value]]), actor, plain) : plain();
  },
  committed: notifyWrite,
  settled: notifyCommit,
  failed: (key, error, owner) => {
    log.error(`KV write failed for "${key}"`, error);
    emitAppEvent("local-write-failed", { kind: "kv", code: errorCode(error), owner });
  },
});

/** Preserve the queue's optimistic and failure contracts before native dispatch. */
function writeLocal<T>(
  keys: Iterable<string>,
  operation: () => T | Promise<T>,
  owner: KVFailureOwner = "store",
  run: RunDomainWrite = runDomainWrite,
): Promise<T> {
  return runObservedDomainWrite(
    operation,
    (error) => {
      // Synchronous UI setters may have optimistically changed their own atom
      // even though no queue mutation was admitted. Re-publish current values.
      for (const key of keys) notifyChange(key, snapshot?.get(key) ?? null);
      log.warn("KV write admission failed", error);
      emitAppEvent("local-write-failed", { kind: "kv", code: errorCode(error), owner });
    },
    run,
  );
}

/** A durability barrier for writes already accepted by this process. */
export async function flushLocalKV(prefix = ""): Promise<void> {
  if (isTauri()) await writes.flush(prefix);
}

/** Read and enqueue a settings patch after prior UI/remote writes have committed or rolled back. */
export function afterLocalKVWrites<T>(operation: () => T | Promise<T>): Promise<T> {
  return isTauri() ? writes.afterPending(operation) : Promise.resolve().then(operation);
}
export function hasPendingLocalKVWrites(): boolean {
  return isTauri() && writes.pending;
}

async function loadKvSnapshot(): Promise<Map<string, string>> {
  const all = await invoke<Record<string, string>>("load_kv_all");
  return new Map(Object.entries(all));
}

/** A `localStorage`-shaped facade over the resolved device-local backing. */
export const localKV = {
  getItem(key: string): string | null {
    if (!isTauri()) return localStorage.getItem(key);
    return snapshot?.get(key) ?? null;
  },

  setItem(key: string, value: string, origin: KVWriteOrigin = "local", actor: DomainActor | null = null): void {
    actorCause(actor ?? undefined);
    if (!isTauri()) {
      localStorage.setItem(key, value);
      const cause = causalActor(actor ?? "system");
      notifyChange(key, value, cause);
      notifyCommit(
        stampEventCause(
          { entries: [{ key, value }], source: origin, actor: actor === null ? null : actorOrigin(actor) },
          cause,
        ),
      );
      return;
    }
    void writeLocal([key], () => writes.write(key, value, origin, actor));
  },

  removeItem(key: string, origin: KVWriteOrigin = "local", actor: DomainActor | null = null): void {
    actorCause(actor ?? undefined);
    if (!isTauri()) {
      localStorage.removeItem(key);
      const cause = causalActor(actor ?? "system");
      notifyChange(key, null, cause);
      notifyCommit(
        stampEventCause(
          { entries: [{ key, value: null }], source: origin, actor: actor === null ? null : actorOrigin(actor) },
          cause,
        ),
      );
      return;
    }
    void writeLocal([key], () => writes.write(key, null, origin, actor));
  },

  setItemAsync(key: string, value: string, actor: DomainActor | null = null): Promise<void> {
    actorCause(actor ?? undefined);
    if (isTauri()) return writeLocal([key], () => writes.write(key, value, "local", actor));
    localStorage.setItem(key, value);
    const cause = causalActor(actor ?? "system");
    notifyChange(key, value, cause);
    notifyCommit(
      stampEventCause(
        { entries: [{ key, value }], source: "local", actor: actor === null ? null : actorOrigin(actor) },
        cause,
      ),
    );
    return Promise.resolve();
  },
  removeItemAsync(key: string, actor: DomainActor | null = null): Promise<void> {
    actorCause(actor ?? undefined);
    if (isTauri()) return writeLocal([key], () => writes.write(key, null, "local", actor));
    localStorage.removeItem(key);
    const cause = causalActor(actor ?? "system");
    notifyChange(key, null, cause);
    notifyCommit(
      stampEventCause(
        { entries: [{ key, value: null }], source: "local", actor: actor === null ? null : actorOrigin(actor) },
        cause,
      ),
    );
    return Promise.resolve();
  },

  /**
   * Every entry under `prefix`, with the prefix stripped from the keys.
   *
   * Backs the plugin sandbox: a plugin's `storage.get()` is synchronous, so its
   * Worker gets the whole namespace up front instead of a round trip per read.
   */
  entries(prefix: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (!isTauri()) {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          const value = localStorage.getItem(key);
          if (value != null) out[key.slice(prefix.length)] = value;
        }
      }
      return out;
    }
    for (const [key, value] of snapshot ?? []) {
      if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
    }
    return out;
  },
};

/** Join host-owned KV metadata to a native domain transaction using the same
 * ordered optimistic mirror and rollback as ordinary KV writes. Desktop only. */
export function commitLocalKVTransaction(
  entries: ReadonlyMap<string, string | null>,
  persist: () => Promise<void>,
  actor: DomainActor,
): Promise<void> {
  if (!isTauri()) return Promise.reject(new AppError("plugin/unavailable", "Native KV transaction requires desktop"));
  const values = new Map(entries);
  return writeLocal(values.keys(), () => writes.batch(values, persist, actor, "local", "caller"), "caller");
}

/** Host-only multi-record settings commit; never exposes raw KV authority to actors. */
export function setLocalKVBatch(
  entries: ReadonlyMap<string, string | null>,
  actor: DomainActor | null = null,
  source: "local" | "restore" = "local",
  failureOwner: KVFailureOwner = "store",
  run: RunDomainWrite = runDomainWrite,
): Promise<void> {
  actorCause(actor ?? undefined);
  if (entries.size === 0) return Promise.resolve();
  const values = new Map(entries);
  if (isTauri()) {
    return writeLocal(
      values.keys(),
      () =>
        writes.batch(
          values,
          (cause) => persistLocalEntries(values, cause, () => invoke("set_kv_batch", { entries: [...values] })),
          actor,
          source,
          failureOwner,
        ),
      failureOwner,
      run,
    );
  }
  // Storybook has no SQLite transaction. Restore its prior records on failure,
  // and do not notify observers until all writes have succeeded.
  const previous = new Map([...values.keys()].map((key) => [key, localStorage.getItem(key)]));
  try {
    for (const [key, value] of values) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  } catch (error) {
    for (const [key, value] of previous) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    return Promise.reject(error);
  }
  const cause = causalActor(actor ?? "system");
  for (const [key, value] of values) notifyChange(key, value, cause);
  notifyCommit(
    stampEventCause(
      {
        entries: [...values].map(([key, value]) => ({ key, value })),
        source,
        actor: actor === null ? null : actorOrigin(actor),
      },
      cause,
    ),
  );
  return Promise.resolve();
}

/**
 * Load the SQLite config snapshot before any settings module reads it. No-op in
 * the browser (`localKV` delegates straight to `localStorage`). Idempotent.
 */
export async function hydrateLocalStore(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  if (!isTauri()) return;

  try {
    snapshot = await loadKvSnapshot();
  } catch (err) {
    hydrated = false;
    log.error("hydrate failed; refusing legacy imports without native state", err);
    throw err;
  }

  // A previous wipe committed its database transaction but did not finish
  // removing files. Recover before legacy imports, secrets, plugins or UI boot.
  if (snapshot.get("read-aware-wipe-pending") || snapshot.get("read-aware-wipe-webview-pending")) {
    try {
      if (snapshot.get("read-aware-wipe-pending")) await invoke("wipe_all_data");
      await clearWebviewStorage();
      await invoke("delete_kv", { key: "read-aware-wipe-webview-pending" });
      snapshot = await loadKvSnapshot();
    } catch (error) {
      hydrated = false;
      throw error;
    }
  }

  // First launch after SQLite lands: sweep the old in-webview data into SQLite.
  // Guarded so a failure doesn't block boot — the flag stays unset and it
  // retries next launch; the snapshot keeps whatever app_kv already had.
  if (snapshot && !snapshot.get(MIGRATED_FLAG)) {
    try {
      await importDesktopDataIntoSqlite();
      snapshot = await loadKvSnapshot();
    } catch (err) {
      log.error("one-time import failed; will retry next launch", err);
    }
  }

  // Second wave: agent memories moved from webview IndexedDB into the SQLite
  // `memories` table (migration v5). Same guarded once-only pattern.
  if (snapshot && !snapshot.get(MEMORIES_MIGRATED_FLAG)) {
    try {
      await importWebviewMemoriesIntoSqlite();
      await invoke("set_kv", { key: MEMORIES_MIGRATED_FLAG, value: "1" });
      snapshot.set(MEMORIES_MIGRATED_FLAG, "1");
    } catch (err) {
      log.error("memories import failed; will retry next launch", err);
    }
  }

  // Third wave: chat transcripts moved from the app_kv JSON blob into the
  // ai_conversations/ai_messages tables (migration v6). The old key's presence
  // is the trigger; deleting it after import is what makes this once-only.
  const legacyConversations = snapshot?.get(CONVERSATIONS_KV_KEY);
  if (snapshot && legacyConversations) {
    try {
      await importKvConversationsIntoSqlite(legacyConversations);
      await invoke("delete_kv", { key: CONVERSATIONS_KV_KEY });
      snapshot.delete(CONVERSATIONS_KV_KEY);
    } catch (err) {
      log.error("conversations import failed; will retry next launch", err);
    }
  }

  // Fourth wave: vocabulary + reading-time move from app_kv JSON blobs into
  // their SQLite projection tables (migration v9), then hydrate the sync
  // snapshots feature code reads at module-eval.
  await hydrateInterimProjections({
    read: (key) => localKV.getItem(key),
    clear: (key) => localKV.removeItem(key),
  });

  // Fifth wave: the BYO API key leaves the webview-readable localStorage slot
  // for the OS credential store, and the in-memory snapshot the synchronous
  // config readers use is filled.
  await hydrateSecrets();

  // The old summary is no longer a settings snapshot, even when migration must retry.
  snapshot?.delete(LEGACY_PROFILE_KEY);
  try {
    await initializeUserProfile();
  } catch (err) {
    log.error("profile initialization failed; profile operations will retry", err);
  }

  // Off the boot-critical path: synthesize creation events for projection rows
  // the event log has never seen (pre-event-era data, rows left by retired v1
  // backup restores, dropped best-effort appends). Idempotent; a failure
  // retries next launch.
  void reconcileGenesisEvents().catch((err) => {
    log.error("genesis event reconciliation failed", err);
  });
}

/** Host rollback spanning KV and other SQLite tables, with the same queue/mirror contract. */
export function restoreLocalKVTransaction(
  prefix: string,
  entries: Record<string, string>,
  exact: ReadonlyMap<string, string | null>,
  persist: () => Promise<void>,
): Promise<void> {
  if (!isTauri()) return Promise.reject(new AppError("plugin/unavailable", "Native rollback requires desktop storage"));
  const replacement = { ...entries };
  const extra = new Map(exact);
  return writes.afterPending(() => {
    const previous = localKV.entries(prefix);
    const values = new Map(
      [...new Set([...Object.keys(previous), ...Object.keys(replacement)])].map(
        (suffix) =>
          [
            prefix + suffix,
            Object.prototype.hasOwnProperty.call(replacement, suffix) ? replacement[suffix]! : null,
          ] as const,
      ),
    );
    for (const [key, value] of extra) values.set(key, value);
    return writeLocal(values.keys(), () => writes.replace(values, persist));
  });
}

/** Atomically replace a namespace, ordered with all accepted KV writes. */
export async function replaceLocalKVPrefix(prefix: string, entries: Record<string, string>): Promise<void> {
  if (!isTauri()) {
    const previous = localKV.entries(prefix);
    const values = new Map(
      [...new Set([...Object.keys(previous), ...Object.keys(entries)])].map(
        (suffix) => [prefix + suffix, entries[suffix] ?? null] as const,
      ),
    );
    for (const [key, value] of values) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    const cause = causalActor("system");
    for (const [key, value] of values) notifyChange(key, value, cause);
    notifyCommit(
      stampEventCause(
        { entries: [...values].map(([key, value]) => ({ key, value })), source: "restore", actor: null },
        cause,
      ),
    );
    return;
  }

  const previous = localKV.entries(prefix);
  const values = new Map(
    [...new Set([...Object.keys(previous), ...Object.keys(entries)])].map(
      (suffix) => [prefix + suffix, entries[suffix] ?? null] as const,
    ),
  );
  await writeLocal(values.keys(), () => writes.replace(values, () => invoke("replace_kv_prefix", { prefix, entries })));
}
