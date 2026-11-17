import { observeSnapshot } from "../../../domain/snapshot-observation";
import {
  actorOrigin,
  copyEventCause,
  eventCause,
  ObservationCauses,
  stampEventCause,
  type DomainActor,
} from "../../../platform/domain-actor";
import {
  AppError,
  normalizeConversationTarget,
  normalizeConversationTurnRequest,
  type ConversationRuntimeSnapshot,
  type ConversationTarget,
  type ProjectionInvalidation,
} from "@read-aware/core";
import type {
  PluginConversationsDomain,
  PluginConversationRuntimeSnapshot,
  ConversationDomainEventType,
  PluginDomainEvent,
} from "@read-aware/plugin-types";
import type { ActorDomainView } from "../../../domain/registry";
import {
  pluginObjectAccessDenied,
  runFenced,
  type CurrentBookSnapshot,
  type PluginBookAccessPolicy,
} from "../../../domain/plugin-object-access";
import { createLogger } from "../../../platform/logger";
import type { PluginLifecycleController } from "./plugin-lifecycle";
import { restricted, restrictSurface, type RestrictedPolicy } from "./plugin-restricted-surface";
import { settled } from "../../../platform/write-settlement";

type Reader = {
  current(): CurrentBookSnapshot;
  observe(handler: (event?: object) => void): () => void;
};
const log = createLogger("scoped-conversations");

/** Book threads are keyed by the book, while global threads remain a distinct
 * authority. A pending proposal retains its book fence until the host adopts
 * or retires it; accepting it is still exclusively a host UI action. */
export function scopePluginConversations(
  domain: NonNullable<ActorDomainView["conversations"]>,
  policy: PluginBookAccessPolicy,
  lifecycle: PluginLifecycleController,
  reader: Reader,
  origin: DomainActor,
  state: { revision: number; projectedKey?: string } = { revision: 0 },
): PluginConversationsDomain {
  const denied = (operation: string): never => {
    throw pluginObjectAccessDenied(`conversations.${operation}`);
  };
  const book = () => (policy.grant.mode === "book" ? policy.grant.bookId : reader.current().bookId);
  const requireBook = () => book() ?? denied("current book");
  const target = (input: ConversationTarget) => {
    const value = normalizeConversationTarget(input);
    if (value.kind !== "book") return denied("global thread");
    policy.assertBook(value.id, "conversation target");
    return value;
  };
  async function run<T>(
    operation: string,
    bookId: string,
    work: (signal: AbortSignal, release: () => void) => Promise<T>,
    mode: "read" | "write" | "proposal" = "read",
  ) {
    lifecycle.assertActive(`conversations.${operation}`);
    // A proposal keeps its fence until the reader answers; `release` ends it.
    return runFenced(
      policy.beginBook(bookId, `conversations.${operation}`),
      (access) => {
        const pending =
          mode === "read"
            ? lifecycle.read(`conversations.${operation}`, () => work(access.signal, access.dispose), access.signal)
            : work(access.signal, access.dispose);
        if (mode !== "read") lifecycle.trackCleanup(settled(pending));
        return pending;
      },
      { signals: [lifecycle.signal], retain: mode === "proposal" },
    );
  }

  const project = (snapshot: Pick<ConversationRuntimeSnapshot, "sessions">): PluginConversationRuntimeSnapshot => {
    const bookId = book(),
      sessions = snapshot.sessions.filter((session) => session.kind === "book" && session.id === bookId);
    const key = JSON.stringify([bookId, policy.grant.mode === "current" ? reader.current().sessionId : null, sessions]);
    if (key !== state.projectedKey) {
      state.projectedKey = key;
      state.revision++;
    }
    return copyEventCause(snapshot, {
      revision: state.revision,
      selectedGlobalThreadId: null,
      sessions: structuredClone(sessions),
    });
  };
  const commands = domain.commands;
  const commandPolicy = (
    commands: NonNullable<typeof domain.commands>,
  ): RestrictedPolicy<NonNullable<PluginConversationsDomain["commands"]>> => ({
    createThread: restricted.deny,
    selectThread: restricted.deny,
    requestTurn: restricted.command((input) => {
      const request = normalizeConversationTurnRequest(input),
        value = target(request.target);
      return run(
        "requestTurn",
        value.id,
        (signal, release) => commands.requestTurn(request, signal, release),
        "proposal",
      );
    }),
    cancelTurnRequest: restricted.command((id) =>
      run(
        "cancelTurnRequest",
        requireBook(),
        async (signal) => {
          const request = (await domain.queries.turnRequests()).find((request) => request.id === id);
          signal.throwIfAborted();
          if (!request) throw new AppError("ui/invalid-target", "Conversation request does not exist for this actor");
          target(request.target);
          return commands.cancelTurnRequest(id, signal);
        },
        "write",
      ),
    ),
    stop: restricted.command((input) => {
      const value = target(input);
      return run("stop", value.id, (signal) => commands.stop(value, signal), "write");
    }),
    clear: restricted.command((input) => {
      const value = target(input);
      return run("clear", value.id, (signal) => commands.clear(value, signal), "write");
    }),
  });
  return restrictSurface<PluginConversationsDomain>(lifecycle, "domains.conversations", {
    queries: {
      listThreads: restricted.deny,
      getThread: restricted.deny,
      getInsights: restricted.read((input) => {
        const value = target(input);
        return run("getInsights", value.id, () => domain.queries.getInsights(value));
      }),
      getBookThread: restricted.read((bookId) => {
        const value = target({ kind: "book", id: bookId });
        return run("getBookThread", value.id, () => domain.queries.getBookThread(value.id));
      }),
      turnRequests: restricted.read(async () => {
        lifecycle.assertActive("conversations.turnRequests");
        const bookId = book();
        if (bookId === null) return [];
        return run("turnRequests", bookId, async () =>
          (await domain.queries.turnRequests()).filter(
            (request) => request.target.kind === "book" && request.target.id === bookId,
          ),
        );
      }),
      runtime: restricted.read(async () => {
        lifecycle.assertActive("conversations.runtime");
        const bookId = book();
        if (bookId === null) return project({ sessions: [] });
        return run("runtime", bookId, async () => project(await domain.queries.runtime()));
      }),
    },
    events: {
      subscribe: restricted.observe((event, handler, options) => {
        if (typeof handler !== "function")
          throw new AppError("ui/invalid-target", "Expected a conversation event callback");
        return () => ({
          dispose: domain.events.subscribe<ConversationDomainEventType>(event, (broadcast) => {
            if (lifecycle.signal.aborted || (options?.ignoreSelf && broadcast.origin === actorOrigin(origin))) return;
            try {
              target({ kind: "book", id: broadcast.payload.conversationId });
              if (
                "bookId" in broadcast.payload &&
                broadcast.payload.bookId !== undefined &&
                broadcast.payload.bookId !== broadcast.payload.conversationId
              )
                return;
              // An event outside the book grant is withheld, not an error.
            } catch {
              return;
            }
            // The shared subscription already matched the exact requested event.
            return handler(copyEventCause(broadcast, structuredClone(broadcast)) as PluginDomainEvent<typeof event>);
          }),
        });
      }),
      observeRuntime: restricted.observe((handler) => {
        if (typeof handler !== "function")
          throw new AppError("ui/invalid-target", "Expected a conversation runtime callback");
        return () => {
          let seen = -1,
            latest: ConversationRuntimeSnapshot | undefined;
          return {
            dispose: observeSnapshot(
              () => project(latest ?? { sessions: [] }),
              (notify) => {
                const offRuntime = domain.events.observeRuntime((snapshot, source) => {
                  latest = snapshot;
                  notify(source ?? snapshot);
                });
                try {
                  const offReader = reader.observe((source) => notify(source ?? stampEventCause({}, "system")));
                  return () => {
                    offRuntime();
                    offReader();
                  };
                } catch (error) {
                  offRuntime();
                  throw error;
                }
              },
              async (snapshot, source) => {
                if (lifecycle.signal.aborted || snapshot.revision === seen) return;
                await handler(snapshot, source);
                seen = snapshot.revision;
              },
              (error) => log.warn("Conversation scope observer failed", error),
              origin,
            ),
          };
        };
      }),
      // These hints contain no object, transcript or global thread identities.
      // Remote/restore invalidation asks the actor to rerun its authorized query.
      observeInvalidation: restricted.observe((handler) => {
        if (typeof handler !== "function")
          throw new AppError("ui/invalid-target", "Expected a conversation invalidation callback");
        return () => {
          let revision = 0,
            running = false,
            stopped = false;
          const pending = new Set<ProjectionInvalidation["source"]>(),
            causes = new ObservationCauses(origin);
          const publish = async (source: ProjectionInvalidation["source"], event?: object) => {
            if (stopped || lifecycle.signal.aborted) return;
            pending.add(source);
            causes.add(event && eventCause(event) ? event : stampEventCause({}));
            if (running) return;
            running = true;
            try {
              while (pending.size && !stopped && !lifecycle.signal.aborted) {
                const source = pending.size === 1 ? [...pending][0]! : "mixed";
                pending.clear();
                try {
                  await handler(causes.take({ revision: ++revision, source }));
                } catch (error) {
                  log.warn("Conversation invalidation failed", error);
                }
              }
            } finally {
              running = false;
            }
          };
          const offDomain = domain.events.observeInvalidation((event) => publish(event.source, event));
          const offReader = reader.observe((event) => {
            void publish("host", event);
          });
          return {
            dispose: () => {
              stopped = true;
              pending.clear();
              offDomain();
              offReader();
            },
          };
        };
      }),
    },
    commands: commands ? commandPolicy(commands) : restricted.absent,
  });
}
