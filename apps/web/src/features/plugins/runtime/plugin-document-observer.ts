import { AppError } from "@read-aware/core";
import type {
  PluginDocumentObservation,
  PluginDocumentObservationResult,
  PluginDisposable,
} from "@read-aware/plugin-types";
import { observeQuery } from "../../../domain/query-observation";
import { onAppEvent } from "../../../platform/app-events";
import { createLogger } from "../../../platform/logger";
import { actorCause, copyEventCause, stampEventCause, type DomainActor } from "../../../platform/domain-actor";
import type { PluginLifecycleController } from "./plugin-lifecycle";

const log = createLogger("plugin-documents");
const defaults = {
  /** Paces a retry after a failed read or callback, or a read that spanned a write. */
  schedule(work: () => void) {
    const timer = setTimeout(work, 1000);
    return () => clearTimeout(timer);
  },
  report(error: unknown) {
    log.warn("Private document observation failed", error);
  },
};
type DocumentTarget = { collection: string; id: string };
type DocumentChange = { targets: readonly DocumentTarget[] };
type PendingWrite = { targets: readonly DocumentTarget[]; settled: Promise<void> };

/** One plugin's document writes in this window, whichever activation or
 * surface made them, so every observer of that plugin hears each of them. */
class DocumentWriteChannel {
  readonly changes = new Set<(change: DocumentChange) => void>();
  readonly writes = new Set<PendingWrite>();
}
const channels = new Map<string, DocumentWriteChannel>();
function channelFor(pluginId: string): DocumentWriteChannel {
  let channel = channels.get(pluginId);
  if (!channel) channels.set(pluginId, (channel = new DocumentWriteChannel()));
  return channel;
}

/** Private query snapshots, not write events. Each owner shares one limit.
 * A snapshot is re-read only when something announces a change: a committed
 * write through any observer of the plugin, or a projection invalidation
 * (sync pulls, restores and other processes' commits). Nothing polls. */
export class PluginDocumentObserver {
  private count = 0;
  private readonly channel: DocumentWriteChannel;
  constructor(
    pluginId: string,
    private readonly lifecycle: PluginLifecycleController,
    private readonly deps = defaults,
  ) {
    this.channel = channelFor(pluginId);
  }

  /** Keep native reads behind dispatched local writes until their actual receipt
   * is known. A failed/conflicting commit must never publish a causal change. */
  async write<T>(
    targets: readonly DocumentTarget[],
    actor: DomainActor,
    perform: () => Promise<T>,
    committed: (result: T) => boolean = () => true,
  ): Promise<T> {
    actorCause(actor);
    const settled = Promise.withResolvers<void>();
    const pending: PendingWrite = { targets, settled: settled.promise };
    this.channel.writes.add(pending);
    try {
      const result = await perform();
      if (targets.length && committed(result)) {
        const event = stampEventCause({ targets }, actor);
        for (const change of this.channel.changes) change(event);
      }
      return result;
    } finally {
      this.channel.writes.delete(pending);
      settled.resolve();
    }
  }

  observe<T>(
    read: () => Promise<PluginDocumentObservationResult<T>>,
    handler: (event: PluginDocumentObservation<T>) => unknown,
    matches: (target: DocumentTarget) => boolean = () => true,
    actor?: DomainActor,
  ): PluginDisposable {
    if (typeof handler !== "function")
      throw new AppError("plugin/invalid-argument", "Expected document observation callback");
    return this.lifecycle.stage(() => {
      if (this.lifecycle.signal.aborted) throw new AppError("plugin/cancelled", "Document observer owner retired");
      if (this.count >= 64) throw new AppError("plugin/quota-exceeded", "Too many document observers");
      ++this.count;
      const channel = this.channel;
      // A write may have started before this observer was installed. It is
      // still owned here, so do not mistake its pending receipt for a new root.
      const pendingWrites = () => [...channel.writes].filter((write) => write.targets.some(matches));
      const dispose = observeQuery(
        read,
        // The public observation numbers deliveries as `sequence`.
        (event) => {
          const { revision, ...sample } = event;
          return handler(copyEventCause(event, { ...sample, sequence: revision }) as PluginDocumentObservation<T>);
        },
        {
          schedule: this.deps.schedule,
          report: this.deps.report,
          failureCode: "ipc/unknown",
          release: () => {
            --this.count;
          },
        },
        this.lifecycle.signal,
        {
          origin: actor,
          subscribe: (notify) => {
            const changed = (change: DocumentChange) => {
              if (change.targets.some(matches)) notify(change);
            };
            channel.changes.add(changed);
            const offProjection = onAppEvent("projections-invalidated", notify);
            return () => {
              channel.changes.delete(changed);
              offProjection();
            };
          },
          settle: async (signal) => {
            for (let writes = pendingWrites(); writes.length; writes = pendingWrites()) {
              signal.throwIfAborted();
              await Promise.all(writes.map((write) => write.settled));
            }
          },
          hasPending: () => pendingWrites().length > 0,
        },
      );
      return { dispose };
    });
  }
}
