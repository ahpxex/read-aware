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
 */
import type { EventOrigin } from "@read-aware/core";
import { createAnnotationsDomain, type AnnotationsDomain } from "./annotations";
import { createBooksDomain, type BooksDomain } from "./books";
import { createCollectionsDomain, type CollectionsDomain } from "./collections";
import { createConversationsDomain, type ConversationsDomain } from "./conversations";
import { createReadingDomain, type ReadingDomain } from "./reading";
import { createVocabularyDomain, type VocabularyDomain } from "./vocabulary";

export type DomainApi = {
  books: BooksDomain;
  collections: CollectionsDomain;
  annotations: AnnotationsDomain;
  reading: ReadingDomain;
  vocabulary: VocabularyDomain;
  conversations: ConversationsDomain;
};

export function createDomainApi(origin: EventOrigin): DomainApi {
  return {
    books: createBooksDomain(origin),
    collections: createCollectionsDomain(origin),
    annotations: createAnnotationsDomain(origin),
    reading: createReadingDomain(origin),
    vocabulary: createVocabularyDomain(origin),
    conversations: createConversationsDomain(origin),
  };
}

/** The app UI's own instance — direct user actions, origin "user". */
export const userDomain: DomainApi = createDomainApi("user");

export type {
  AnnotationsDomain,
  BooksDomain,
  CollectionsDomain,
  ConversationsDomain,
  ReadingDomain,
  VocabularyDomain,
};
export {
  createBooksDomain,
  getExtractedChapters,
  getPersistedChapters,
  toBookSummary,
} from "./books";
export { createAnnotationsDomain, toAnnotationItem } from "./annotations";
export { createCollectionsDomain } from "./collections";
export { createConversationsDomain } from "./conversations";
export { createReadingDomain, toReadingState } from "./reading";
export { createVocabularyDomain, toVocabularySummary } from "./vocabulary";
export {
  ANNOTATION_EVENTS,
  BOOK_EVENTS,
  COLLECTION_EVENTS,
  CONVERSATION_EVENTS,
  READING_EVENTS,
  VOCABULARY_EVENTS,
  domainSubscribe,
  type DomainEventSubscribe,
  type ObservedDomainEvent,
} from "./events";
