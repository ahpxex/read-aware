/**
 * The shared domain API layer — ONE capability surface over the app's
 * domains, consumed by every programmatic actor:
 *
 * - the plugin runtime (`buildPluginContext`) wraps it in permission gating
 *   and contribution tracking, origin `plugin:<id>`;
 * - the agent's ports (`features/ai/agent/ports`) adapt it into the agent
 *   package's model-ergonomic views, origin `agent`;
 * - app UI paths may adopt it over time (they reach the same seams directly
 *   today), origin `user`.
 *
 * Capability is shared; POLICY stays per actor — manifest permissions for
 * plugins, thread scope for the agent. Commands issue the domains' event
 * verbs through the app's dual-write seams with the constructing actor's
 * origin on every envelope, and own their invalidation signals
 * (library-changed, annotations revision), so no consumer re-implements
 * them. Read models are the canonical shapes from @read-aware/core.
 *
 * Three domains: `shelf` (library management — books, collections, stats),
 * `annotations`, and `conversations`.
 */
import type { EventOrigin } from "@read-aware/core";
import { createAnnotationsDomain, type AnnotationsDomain } from "./annotations";
import { createConversationsDomain, type ConversationsDomain } from "./conversations";
import { createShelfDomain, type ShelfDomain } from "./shelf";

export type DomainApi = {
  shelf: ShelfDomain;
  annotations: AnnotationsDomain;
  conversations: ConversationsDomain;
};

export function createDomainApi(origin: EventOrigin): DomainApi {
  return {
    shelf: createShelfDomain(origin),
    annotations: createAnnotationsDomain(origin),
    conversations: createConversationsDomain(origin),
  };
}

/** The app UI's own instance — direct user actions, origin "user". */
export const userDomain: DomainApi = createDomainApi("user");

export type { AnnotationsDomain } from "./annotations";
export type { ConversationsDomain } from "./conversations";
export type { ShelfBooks, ShelfCollections, ShelfDomain, ShelfStats } from "./shelf";
export {
  createShelfDomain,
  getExtractedChapters,
  getPersistedChapters,
  toBookSummary,
} from "./shelf";
export { createAnnotationsDomain, toAnnotationItem } from "./annotations";
export { createConversationsDomain } from "./conversations";
export {
  ANNOTATION_EVENTS,
  CONVERSATION_EVENTS,
  SHELF_EVENTS,
  domainSubscribe,
  type DomainEventSubscribe,
  type ObservedDomainEvent,
} from "./events";
