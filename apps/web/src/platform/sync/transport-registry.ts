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
 * The registry is deliberately dumb state + a change signal — policy (which
 * transport the profile is bound to, what happens when it disappears) lives
 * in the scheduler.
 */
import type { PluginSyncTransport, PluginSyncTransportSession, PluginText } from "@read-aware/plugin-types";

export type RegisteredSyncTransport = {
  /** `plugin:<pluginId>:<transportId>` — stable, and what UI surfaces key on. */
  ref: string;
  pluginId: string;
  transportId: string;
  /** Raw plugin text; resolve per-locale at the UI layer (plugin-i18n). */
  label: PluginText;
  open(): Promise<PluginSyncTransportSession>;
};

const transports = new Map<string, RegisteredSyncTransport>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function syncTransportRef(pluginId: string, transportId: string): string {
  return `plugin:${pluginId}:${transportId}`;
}

/** Register a transport; returns the unregister. Re-registering a live ref
 *  (plugin update promoting a new instance) replaces the previous entry. */
export function registerSyncTransport(
  pluginId: string,
  transport: PluginSyncTransport,
): () => void {
  const entry: RegisteredSyncTransport = {
    ref: syncTransportRef(pluginId, transport.id),
    pluginId,
    transportId: transport.id,
    label: transport.label,
    open: () => Promise.resolve(transport.open()),
  };
  transports.set(entry.ref, entry);
  notify();
  return () => {
    // Only remove our own registration — a replacement (blue-green update)
    // must not be torn down by the retiring instance's disposer.
    if (transports.get(entry.ref) === entry) {
      transports.delete(entry.ref);
      notify();
    }
  };
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
