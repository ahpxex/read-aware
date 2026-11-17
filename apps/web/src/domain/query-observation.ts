import { errorCode } from "@read-aware/core";
import { copyEventCause, mergeEventCauses, ObservationCauses, type DomainActor } from "../platform/domain-actor";

export type QueryObservation<T> = { revision: number } & (
  | { status: "ready"; result: T }
  | { status: "error"; errorCode: string }
);

/** Host-private dependencies. Neither changes nor their causal identities enter
 * the query payload or enlarge the reader's authorization. */
export type QueryObservationSources = {
  origin?: DomainActor;
  subscribe(notify: (source: object) => void): () => void;
  settle(signal: AbortSignal): Promise<void>;
  hasPending(): boolean;
};

/** One bounded poll and callback at a time. Keep write provenance through
 * coalescing, failed reads and callback retries, without keeping an event log.
 *
 * A tracked change (a domain broadcast, a projection invalidation) announced
 * while no poll is running is read at once, so a reader who just made a mark
 * sees it as soon as the store answers rather than at the next scheduled tick.
 * Changes announced during a poll invalidate its sample and wait for the
 * scheduler: a burst of announcements costs one read per tick, never a read
 * per announcement. The scheduler also paces retries of a failed read or
 * callback. With sources, nothing is re-read on a timer: every writer announces
 * (domain broadcasts; sync pulls, restores and other processes' commits as
 * projection invalidations). Only an observation without sources polls. */
export function observeQuery<T>(
  read: () => Promise<T>,
  handler: (event: QueryObservation<T>) => unknown,
  deps: { schedule(work: () => void): () => void; report(error: unknown): void; failureCode: string; release(): void },
  lifetime?: AbortSignal,
  sources?: QueryObservationSources,
): () => void {
  const controller = new AbortController(),
    causes = new ObservationCauses(sources?.origin);
  let disposed = false,
    polling = false,
    revision = 0,
    delivered: string | undefined;
  let cancelTimer: (() => void) | undefined, unsubscribe: (() => void) | undefined;
  let retry: { identity: string; source: object } | undefined, unread: object | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    cancelTimer?.();
    cancelTimer = undefined;
    lifetime?.removeEventListener("abort", dispose);
    try {
      unsubscribe?.();
    } finally {
      deps.release();
    }
  };
  const schedule = () => {
    if (!disposed)
      cancelTimer = deps.schedule(() => {
        cancelTimer = undefined;
        void poll();
      });
  };
  // A change announced while a poll is running is caught by that poll's
  // revision check and read at the next tick; otherwise read it now.
  const pollNow = () => {
    if (disposed || polling) return;
    cancelTimer?.();
    cancelTimer = undefined;
    void poll();
  };
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      await pollOnce();
    } finally {
      polling = false;
    }
  };
  const pollOnce = async () => {
    // Native writes can be visible before their completion broadcast. Await
    // short durable work only, never model tasks or observation callbacks.
    if (sources) {
      try {
        await sources.settle(controller.signal);
      } catch (error) {
        if (!disposed) {
          deps.report(error);
          schedule();
        }
        return;
      }
    }
    if (disposed) return;
    const sourceRevision = causes.revision;
    let sample:
      | Omit<Extract<QueryObservation<T>, { status: "ready" }>, "revision">
      | Omit<Extract<QueryObservation<T>, { status: "error" }>, "revision">;
    try {
      sample = { status: "ready", result: await read() };
    } catch (error) {
      if (disposed) return;
      deps.report(error);
      sample = { status: "error", errorCode: errorCode(error) ?? deps.failureCode };
    }
    if (disposed) return;
    let retryLater = !sources || sample.status === "error";
    // Retain pending causes until a sample spans no tracked changes. A write
    // during the read can invalidate even a successful or failed query result.
    if (sourceRevision !== causes.revision || sources?.hasPending()) {
      schedule();
      return;
    }
    const identity = JSON.stringify(sample);
    const retained = [unread, retry?.identity === identity ? retry.source : undefined].filter(
      (source): source is object => !!source,
    );
    const event = causes.take(
      { ...structuredClone(sample), revision: revision + 1 },
      retained.length ? mergeEventCauses(retained, {}) : undefined,
    );
    unread = sample.status === "error" ? copyEventCause(event, {}) : undefined;
    if (identity !== delivered) {
      revision++;
      retry = { identity, source: copyEventCause(event, {}) };
      try {
        await handler(event);
        delivered = identity;
        retry = undefined;
      } catch (error) {
        deps.report(error);
        retryLater = true;
      }
    } else retry = undefined;
    // A change announced while the callback ran found a poll in progress and
    // was not read; it is read at the next tick.
    if (retryLater || sourceRevision !== causes.revision || sources?.hasPending()) schedule();
  };
  try {
    unsubscribe = sources?.subscribe((source) => {
      if (!disposed) {
        causes.add(source);
        pollNow();
      }
    });
    lifetime?.addEventListener("abort", dispose, { once: true });
    if (lifetime?.aborted) dispose();
    else void poll();
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
