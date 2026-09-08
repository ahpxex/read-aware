/**
 * Registry of plugin-provided sync transports (`sync:transport`).
 *
 * A transport is a remote ciphertext mailbox behind the dumb-storage contract
 * of `PluginSyncTransportSession` (@read-aware/plugin-types): the plugin
 * carries sealed envelopes to WebDAV/S3/…, while encryption, the event log,
 * cursors, and merge stay in `platform/sync`. The plugin runtime registers
 * here on activate and unregisters on deactivate; the scheduler resolves the
 * profile's `transport:` account ref against this registry every time it
 * needs the remote side.
 *
 * The registry owns provider generations and their returned sessions. Binding
 * policy (which remote the profile adopts) remains in the scheduler.
 */
import type { PluginSyncTransport, PluginSyncTransportSession, PluginText } from "@read-aware/plugin-types";
import { AppError } from "@read-aware/core";
import { closeTransportSessionValue, ownTransportSession } from "./transport-session";
import { createLogger } from "../logger";

const log = createLogger("sync-transports");

export type RegisteredSyncTransport = {
  /** `plugin:<pluginId>:<transportId>` — stable, and what UI surfaces key on. */
  ref: string;
  pluginId: string;
  transportId: string;
  readonly generation: number;
  /** Raw plugin text; resolve per-locale at the UI layer (plugin-i18n). */
  label: PluginText;
  open(): Promise<PluginSyncTransportSession>;
};

const transports = new Map<string, RegisteredSyncTransport>();
const retirements = new WeakMap<RegisteredSyncTransport, () => Promise<void>>();
const invalidations = new WeakMap<RegisteredSyncTransport, () => Promise<void>>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) {
    try { listener(); } catch (error) { log.warn("Transport observer failed", error); }
  }
}

export function syncTransportRef(pluginId: string, transportId: string): string {
  return `plugin:${pluginId}:${transportId}`;
}

/** Register a transport; returns the unregister. Re-registering a live ref
 *  (plugin update promoting a new instance) replaces the previous entry. */
export function registerSyncTransport(
  pluginId: string,
  transport: PluginSyncTransport,
  release: (value: unknown) => void = () => {},
): () => Promise<void> {
  let retired = false;
  let generation = 0;
  let retirement: Promise<void> | undefined;
  const sessions = new Set<PluginSyncTransportSession>();
  const closeSessions = async () => {
    const results = await Promise.allSettled([...sessions].map(session => session.close()));
    const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, "Sync transport sessions failed to close");
  };
  const retire = () => {
    retired = true;
    return retirement ??= closeSessions();
  };
  const entry: RegisteredSyncTransport = {
    ref: syncTransportRef(pluginId, transport.id),
    pluginId,
    transportId: transport.id,
    get generation() { return generation; },
    label: transport.label,
    async open() {
      if (retired) throw new AppError("plugin/unavailable", "Sync transport is retired");
      const openedGeneration = generation;
      const raw = await transport.open();
      let session: PluginSyncTransportSession;
      try { session = ownTransportSession(raw, release, () => sessions.delete(session)); }
      catch (error) {
        try { await closeTransportSessionValue(raw, release); }
        catch (cleanupError) { log.warn("Invalid transport session cleanup failed", cleanupError); }
        throw error;
      }
      if (retired || generation !== openedGeneration) {
        await session.close();
        throw new AppError("plugin/unavailable", "Sync transport retired while opening");
      }
      sessions.add(session);
      return session;
    },
  };
  const previous = transports.get(entry.ref);
  retirements.set(entry, retire);
  invalidations.set(entry, () => { generation++; return closeSessions(); });
  transports.set(entry.ref, entry);
  if (previous) void retirements.get(previous)?.().catch(error => log.warn("Replaced transport cleanup failed", error));
  notify();
  return () => {
    const closing = retire();
    // Only remove our own registration — a replacement (blue-green update)
    // must not be torn down by the retiring instance's disposer.
    if (transports.get(entry.ref) === entry) {
      transports.delete(entry.ref);
      notify();
    }
    return closing;
  };
}

/** Call only after the Worker has received the new configuration snapshot. */
export function invalidateSyncTransportSessions(pluginId: string): void {
  let changed = false;
  for (const entry of transports.values()) {
    if (entry.pluginId !== pluginId) continue;
    changed = true;
    void invalidations.get(entry)?.().catch(error => log.warn("Transport configuration cleanup failed", error));
  }
  if (changed) notify();
}

export function listSyncTransports(): RegisteredSyncTransport[] {
  return [...transports.values()];
}

export function findSyncTransport(ref: string): RegisteredSyncTransport | null {
  return transports.get(ref) ?? null;
}

export function onSyncTransportsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ── The profile's account-ref encoding for transport connections ─────────────
//
// `sync_profile.remote_account_id` identifies WHICH remote mailbox the local
// push/pull bookkeeping is bound to (`sync_adopt_account` resets it wholesale
// when the id changes). Relay connections store the relay account id; a
// transport connection stores `transport:<pluginId>:<transportId>:<endpointId>`
// so that switching plugin, transport, or endpoint each looks like "a
// different mailbox" and re-pushes history.

export type TransportAccountRef = {
  /** `plugin:<pluginId>:<transportId>` — the registry key. */
  ref: string;
  /** The session identity the connect ritual captured. */
  endpointId: string;
};

export function transportAccountId(ref: string, endpointId: string): string {
  return `transport:${ref.replace(/^plugin:/, "")}:${endpointId}`;
}

export function parseTransportAccountId(
  remoteAccountId: string | null | undefined,
): TransportAccountRef | null {
  if (!remoteAccountId || !remoteAccountId.startsWith("transport:")) return null;
  const rest = remoteAccountId.slice("transport:".length);
  const first = rest.indexOf(":");
  const second = first === -1 ? -1 : rest.indexOf(":", first + 1);
  if (second === -1) return null;
  const pluginId = rest.slice(0, first);
  const transportId = rest.slice(first + 1, second);
  // The endpointId is plugin-authored and may itself contain colons.
  const endpointId = rest.slice(second + 1);
  if (!pluginId || !transportId || !endpointId) return null;
  return { ref: syncTransportRef(pluginId, transportId), endpointId };
}
