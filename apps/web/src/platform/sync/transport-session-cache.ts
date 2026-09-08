import { AppError, ERR_SYNC_TRANSPORT_MISMATCH, ERR_SYNC_TRANSPORT_UNAVAILABLE } from "@read-aware/core";
import type { PluginSyncTransportSession } from "@read-aware/plugin-types";
import type { RegisteredSyncTransport, TransportAccountRef } from "./transport-registry";

type Entry = {
  provider: RegisteredSyncTransport;
  endpointId: string;
  generation: number;
  pending: Promise<PluginSyncTransportSession>;
  session?: PluginSyncTransportSession;
  retired: boolean;
};

/** One engine generation owns its cache. Retired engines can never reopen it. */
export class TransportSessionCache {
  private entry?: Entry;
  private stopped = false;

  constructor(
    private readonly find: (ref: string) => RegisteredSyncTransport | null,
    private readonly reportCleanup: (error: unknown) => void,
  ) {}

  private retire(): void {
    const entry = this.entry;
    this.entry = undefined;
    if (!entry) return;
    entry.retired = true;
    if (entry.session) void entry.session.close().catch(this.reportCleanup);
  }

  refresh(): void {
    if (this.entry && (this.find(this.entry.provider.ref) !== this.entry.provider
      || this.entry.generation !== this.entry.provider.generation)) this.retire();
  }

  stop(): void {
    this.stopped = true;
    this.retire();
  }

  get(connection: TransportAccountRef): Promise<PluginSyncTransportSession> {
    if (this.stopped) return Promise.reject(new AppError("plugin/unavailable", "Sync engine session cache stopped"));
    const provider = this.find(connection.ref);
    if (!provider) {
      this.retire();
      return Promise.reject(new AppError(ERR_SYNC_TRANSPORT_UNAVAILABLE, "Sync transport is not registered"));
    }
    if (this.entry?.provider === provider && this.entry.endpointId === connection.endpointId
      && this.entry.generation === provider.generation) return this.entry.pending;
    this.retire();
    const entry: Entry = { provider, generation: provider.generation, endpointId: connection.endpointId, retired: false, pending: undefined! };
    this.entry = entry;
    entry.pending = (async () => {
      const session = await provider.open();
      if (entry.retired || session.endpointId !== connection.endpointId) {
        try { await session.close(); } catch (error) { this.reportCleanup(error); }
        throw entry.retired
          ? new AppError("plugin/unavailable", "Sync transport changed while opening")
          : new AppError(ERR_SYNC_TRANSPORT_MISMATCH, "Sync transport endpoint changed; reconnect to adopt it");
      }
      entry.session = session;
      return session;
    })();
    void entry.pending.catch(() => { if (this.entry === entry) this.entry = undefined; });
    return entry.pending;
  }
}
