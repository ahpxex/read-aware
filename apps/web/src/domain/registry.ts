/** Single runtime registry for every active product domain. */
import type {
  DomainGrants,
  DomainId,
  EventOrigin,
} from "@read-aware/core";
import { createAnnotationsDomain } from "./annotations";
import { createConversationsDomain } from "./conversations";
import {
  ANNOTATION_EVENTS,
  CONVERSATION_EVENTS,
  LIBRARY_EVENTS,
  READING_EVENTS,
} from "./events";
import { createLibraryDomain } from "./library";
import { createReadingDomain } from "./reading";
import { createSettingsDomain } from "./settings/domain";

type DomainSurface = {
  queries: object;
  commands: object;
  events: object;
};

type DomainDefinition<TSurface extends DomainSurface = DomainSurface> = {
  events: readonly string[];
  create(origin: EventOrigin): TSurface;
};

export const DOMAIN_REGISTRY = {
  library: {
    events: LIBRARY_EVENTS,
    create: createLibraryDomain,
  },
  reading: {
    events: READING_EVENTS,
    create: createReadingDomain,
  },
  annotations: {
    events: ANNOTATION_EVENTS,
    create: createAnnotationsDomain,
  },
  conversations: {
    events: CONVERSATION_EVENTS,
    create: createConversationsDomain,
  },
  settings: {
    events: ["settings.changed"],
    create: createSettingsDomain,
  },
} satisfies Record<DomainId, DomainDefinition>;

export type DomainApi = {
  [K in DomainId]: ReturnType<(typeof DOMAIN_REGISTRY)[K]["create"]>;
};

type DomainView<TDomain extends DomainSurface> = {
  queries: TDomain["queries"];
  commands?: TDomain["commands"];
  events: TDomain["events"];
};

export type ActorDomainView = Partial<{
  [K in DomainId]: DomainView<DomainApi[K]>;
}>;

export function createDomainApi(origin: EventOrigin): DomainApi {
  return Object.fromEntries(
    Object.entries(DOMAIN_REGISTRY).map(([id, definition]) => [
      id,
      definition.create(origin),
    ]),
  ) as DomainApi;
}

export type { DomainAccess, DomainGrants, DomainId } from "@read-aware/core";

/**
 * Resolve the registry for a constrained actor. Read exposes queries/events;
 * write additionally exposes commands and implies read.
 */
export function createActorDomainView(
  origin: EventOrigin,
  grants: DomainGrants,
): ActorDomainView {
  const domains = createDomainApi(origin);
  const view: ActorDomainView = {};
  const mutableView = view as Record<string, unknown>;
  for (const id of Object.keys(DOMAIN_REGISTRY) as DomainId[]) {
    const access = grants[id];
    if (!access) continue;
    const domain = domains[id];
    mutableView[id] = {
      queries: domain.queries,
      events: domain.events,
      ...(access === "write" ? { commands: domain.commands } : {}),
    };
  }
  return view;
}
