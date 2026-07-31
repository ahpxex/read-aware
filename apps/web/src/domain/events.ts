/**
 * Domain event subscription — the observation side of the shared domain
 * layer. Rosters name which canonical events belong to which domain; the
 * subscribe helper delivers broadcasts (platform/domain-events.ts) with
 * handler isolation, so one failing consumer never breaks the emitter or
 * its peers.
 */
import type { DomainEventType } from "@read-aware/core";
import {
  onDomainEventBroadcast,
  type DomainEventBroadcast,
} from "../platform/domain-events";

/**
 * Everything library management emits: book lifecycle, collection membership,
 * and the recorded reading facts behind the stats face (`book.progressed`,
 * `book.timeRecorded`).
 */
export const SHELF_EVENTS = [
  "book.imported",
  "book.metadataEdited",
  "book.coverExtracted",
  "book.opened",
  "book.starred",
  "book.finished",
  "book.removed",
  "collection.created",
  "collection.renamed",
  "collection.removed",
  "book.addedToCollection",
  "book.removedFromCollection",
  "book.progressed",
  "book.timeRecorded",
] as const;

export const ANNOTATION_EVENTS = [
  "highlight.created",
  "highlight.recolored",
  "highlight.removed",
  "note.created",
  "note.updated",
  "note.removed",
  "ask.recorded",
  "ask.removed",
] as const;

export const CONVERSATION_EVENTS = [
  "aiConversation.started",
  "aiMessage.appended",
  "aiMessage.removed",
  "aiConversation.cleared",
] as const;

/** A domain event as observers receive it (canonical type + payload + origin). */
export type ObservedDomainEvent<K extends DomainEventType = DomainEventType> = Extract<
  DomainEventBroadcast,
  { type: K }
>;

/**
 * One domain's `on`: a subscription over that domain's roster, fully typed
 * per event name. Returns the unsubscribe.
 */
export type DomainEventSubscribe<E extends DomainEventType> = <K extends E>(
  event: K,
  handler: (event: ObservedDomainEvent<K>) => void,
) => () => void;

/**
 * Build a domain's subscribe function. `consumerLabel` names the observer in
 * error logs (e.g. `plugin:rss-reader`, `agent`).
 */
export function domainSubscribe<E extends DomainEventType>(
  roster: readonly E[],
  consumerLabel: string,
): DomainEventSubscribe<E> {
  return ((event: DomainEventType, handler: (event: DomainEventBroadcast) => void) => {
    if (!(roster as readonly DomainEventType[]).includes(event)) {
      throw new Error(`"${event}" is not an event of this domain`);
    }
    return onDomainEventBroadcast((broadcast) => {
      if (broadcast.type !== event) return;
      const report = (error: unknown) =>
        console.error(`[domain] event handler from "${consumerLabel}" failed`, error);
      try {
        // A sandboxed consumer's handler is an async proxy into its Worker —
        // its failures arrive as a rejection, not a throw.
        const result = handler(broadcast) as unknown;
        if (result instanceof Promise) result.catch(report);
      } catch (error) {
        report(error);
      }
    });
  }) as never;
}
