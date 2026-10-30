import { stampEventCause } from "../../../../platform/domain-actor";
import { scopePluginConversations } from "../plugin-scoped-conversations";
import type { PluginContext } from "../../lib/plugin-types";
import { readingRuntime } from "../../../../domain/reading-runtime";
import type { PluginActorKit } from "./kit";

/** The conversations domain, scoped to the book grant when restricted. */
export function installConversationsDomain(kit: PluginActorKit, ctx: PluginContext): void {
  const { lifecycle, currentBook, objectAccess, scopedConversationState, operationActor, domain, track, trackedOn } =
    kit;
  if (domain.conversations) {
    ctx.domains.conversations = {
      queries: {
        ...domain.conversations.queries,
        getInsights: (target) =>
          lifecycle.read("conversations.getInsights", () => domain.conversations!.queries.getInsights(target)),
      },
      events: {
        observeRuntime: (handler) => track(() => ({ dispose: domain.conversations!.events.observeRuntime(handler) })),
        observeInvalidation: (handler) =>
          track(() => ({ dispose: domain.conversations!.events.observeInvalidation(handler) })),
        subscribe: trackedOn(domain.conversations.events.subscribe),
      },
      ...(domain.conversations.commands
        ? {
            commands: {
              requestTurn: (request: import("@read-aware/core").ConversationTurnRequest) => {
                lifecycle.assertActive("conversations.requestTurn");
                return domain.conversations!.commands!.requestTurn(request, lifecycle.signal);
              },
              cancelTurnRequest: (id: string) => {
                lifecycle.assertActive("conversations.cancelTurnRequest");
                return domain.conversations!.commands!.cancelTurnRequest(id, lifecycle.signal);
              },
              createThread: () => {
                lifecycle.assertActive("conversations.createThread");
                return domain.conversations!.commands!.createThread(lifecycle.signal);
              },
              selectThread: (id: string) => {
                lifecycle.assertActive("conversations.selectThread");
                return domain.conversations!.commands!.selectThread(id, lifecycle.signal);
              },
              stop: (target: import("@read-aware/core").ConversationTarget) => {
                lifecycle.assertActive("conversations.stop");
                return domain.conversations!.commands!.stop(target, lifecycle.signal);
              },
              clear: (target: import("@read-aware/core").ConversationTarget) => {
                lifecycle.assertActive("conversations.clear");
                return domain.conversations!.commands!.clear(target, lifecycle.signal);
              },
            },
          }
        : {}),
    };
  }

  if (objectAccess.restricted && domain.conversations) {
    ctx.domains.conversations = scopePluginConversations(
      domain.conversations,
      objectAccess,
      lifecycle,
      {
        current: () => currentBook(),
        observe: (handler) => {
          let initial = true;
          return readingRuntime.observe((snapshot) => {
            const source = initial ? stampEventCause({}, operationActor) : snapshot;
            initial = false;
            return handler(source);
          });
        },
      },
      operationActor,
      scopedConversationState,
    );
  }
}
