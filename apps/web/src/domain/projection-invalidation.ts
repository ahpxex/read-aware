import { AppError, type ProjectionInvalidation } from "@read-aware/core";
import { onAppEvent, type AppEventName } from "../platform/app-events";
import { onDomainEventBroadcast } from "../platform/domain-events";
import { createLogger } from "../platform/logger";
import { eventCause, ObservationCauses, stampEventCause, type DomainActor } from "../platform/domain-actor";

const log = createLogger("projection-invalidation");

/** Invalidation is a request to re-read, not a reconstructed mutation log. */
export function createProjectionInvalidationObserver(
  accepts: (eventType: string) => boolean,
  appEvents: readonly AppEventName[],
) {
  let observers = 0;
  return (
    handler: (event: ProjectionInvalidation) => unknown,
    lifetime?: AbortSignal,
    actor?: DomainActor,
  ): (() => void) => {
    if (typeof handler !== "function") throw new AppError("ui/invalid-target", "Expected an invalidation callback");
    lifetime?.throwIfAborted();
    if (observers >= 64) throw new AppError("ui/observer-limit", "Too many projection observers");
    let stopped = false,
      running = false,
      queued = false,
      revision = 0;
    const pending = new Set<ProjectionInvalidation["source"]>();
    const causes = new ObservationCauses(actor);
    const drain = async () => {
      queued = false;
      if (stopped || running) return;
      running = true;
      try {
        while (!stopped && pending.size) {
          const source = pending.size === 1 ? [...pending][0]! : "mixed";
          pending.clear();
          try {
            await handler(causes.take({ revision: ++revision, source }));
          } catch (error) {
            log.warn("Projection invalidation callback failed", error);
          }
        }
      } finally {
        running = false;
      }
    };
    const invalidate = (source: ProjectionInvalidation["source"], event: object) => {
      if (stopped) return;
      causes.add(eventCause(event) ? event : stampEventCause({}));
      pending.add(source);
      if (!running && !queued) {
        queued = true;
        queueMicrotask(() => {
          void drain();
        });
      }
    };
    const subscriptions = [
      onDomainEventBroadcast((event) => {
        if (accepts(event.type)) invalidate("local", event);
      }),
      onAppEvent("projections-invalidated", (event) => invalidate(event.source, event)),
      ...appEvents.map((name) => onAppEvent(name, (event) => invalidate("host", event))),
    ];
    observers++;
    const dispose = () => {
      if (stopped) return;
      stopped = true;
      observers--;
      pending.clear();
      subscriptions.forEach((unsubscribe) => unsubscribe());
      lifetime?.removeEventListener("abort", dispose);
    };
    lifetime?.addEventListener("abort", dispose, { once: true });
    pending.add("initial");
    void drain();
    return dispose;
  };
}

export const observeLibraryInvalidation = createProjectionInvalidationObserver(
  (type) => type.startsWith("book.") || type.startsWith("collection."),
  ["library-changed", "book-changed", "book-removed"],
);
export const observeConversationInvalidation = createProjectionInvalidationObserver(
  (type) =>
    type.startsWith("aiConversation.") ||
    type.startsWith("aiMessage.") ||
    type === "book.merged" ||
    type === "book.removed",
  ["conversations-changed"],
);
export const observeFontInvalidation = createProjectionInvalidationObserver(
  (type) => type.startsWith("userFont."),
  ["user-fonts-changed"],
);
