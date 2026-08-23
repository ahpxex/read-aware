/** Shared, registry-backed domain surface for user, agent, system, and plugins. */
export {
  DOMAIN_REGISTRY,
  createActorDomainView,
  createDomainApi,
  type ActorDomainView,
  type DomainAccess,
  type DomainApi,
  type DomainGrants,
  type DomainId,
} from "./registry";

import { createDomainApi } from "./registry";

/** The product UI has the full domain surface and writes with user origin. */
export const userDomain = createDomainApi("user");

export {
  createLibraryDomain,
  getExtractedChapters,
  getPersistedChapters,
  toBookSummary,
  type LibraryCommands,
  type LibraryDomain,
  type LibraryQueries,
} from "./library";
export {
  createReadingDomain,
  type ReadingCommands,
  type ReadingDomain,
  type ReadingQueries,
} from "./reading";
export {
  createAnnotationsDomain,
  toAnnotationItem,
  type AnnotationCommands,
  type AnnotationQueries,
  type AnnotationsDomain,
} from "./annotations";
export {
  createConversationsDomain,
  type ConversationQueries,
  type ConversationsDomain,
} from "./conversations";
export {
  createSettingsDomain,
  type SettingsDomain,
} from "./settings/domain";
export {
  ANNOTATION_EVENTS,
  CONVERSATION_EVENTS,
  LIBRARY_EVENTS,
  READING_EVENTS,
  domainSubscribe,
  type DomainEventSubscribe,
  type ObservedDomainEvent,
} from "./events";
