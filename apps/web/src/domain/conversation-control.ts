import { AppError, normalizeConversationTarget, type ConversationTarget, type ConversationRuntimeSnapshot, type EventOrigin } from "@read-aware/core";
import { getDefaultStore } from "jotai";
import { activeGlobalThreadAtom, selectGlobalThread } from "../features/ai/state/global-thread";
import { clearConversation, listGlobalThreads, newGlobalThreadId } from "../features/ai/lib/conversation-store";
import { getBookRecord } from "../features/library/lib/library-db";
import { emitAppEvent } from "../platform/app-events";
import { createLogger } from "../platform/logger";
import { ConversationRuntime } from "./conversation-runtime";

const log = createLogger("conversation-control");
export const conversationRuntime = new ConversationRuntime(error => log.warn("Conversation lifecycle failed", error));
const store = getDefaultStore();
store.sub(activeGlobalThreadAtom, () => conversationRuntime.changed());
export function conversationSnapshot(): ConversationRuntimeSnapshot {
  return { revision: conversationRuntime.revision, selectedGlobalThreadId: store.get(activeGlobalThreadAtom), sessions: conversationRuntime.snapshot() };
}
export function observeConversations(handler: (value: ConversationRuntimeSnapshot) => unknown) {
  const publish = () => {
    try { Promise.resolve(handler(conversationSnapshot())).catch(error => log.warn("Conversation observer failed", error)); }
    catch (error) { log.warn("Conversation observer failed", error); }
  };
  const off = conversationRuntime.observe(publish); publish(); return off;
}
export function conversationCommands(origin: EventOrigin) {
  const validate = async (input: ConversationTarget, signal?: AbortSignal) => {
    const target = normalizeConversationTarget(input); signal?.throwIfAborted();
    if (target.kind === "book" && !await getBookRecord(target.id)) throw new AppError("library/book-not-found", "Conversation book does not exist");
    signal?.throwIfAborted(); return target;
  };
  return {
    createThread: async (signal?: AbortSignal) => {
      signal?.throwIfAborted(); const id = newGlobalThreadId();
      await selectGlobalThread(id, origin, signal);
      return { status: "completed" as const, target: { kind: "global" as const, id }, draft: true as const };
    },
    selectThread: async (threadId: string, signal?: AbortSignal) => {
      const target = normalizeConversationTarget({ kind: "global", id: threadId }); signal?.throwIfAborted();
      if (store.get(activeGlobalThreadAtom) !== target.id && !(await listGlobalThreads()).some(thread => thread.id === target.id)) {
        throw new AppError("ui/invalid-target", "Global conversation does not exist");
      }
      await selectGlobalThread(target.id, origin, signal);
      return { status: "completed" as const, target };
    },
    stop: async (input: ConversationTarget, signal?: AbortSignal) => {
      const target = await validate(input, signal);
      await conversationRuntime.quiesce(target.id, async () => {}, signal);
      return { status: "completed" as const, target };
    },
    clear: async (input: ConversationTarget, signal?: AbortSignal) => {
      const target = await validate(input, signal);
      await conversationRuntime.quiesce(target.id, async () => {
        // Lazy import avoids making the Agent's port construction import its own runtime.
        const { discardAgentThread } = await import("../features/ai/agent/agent-runtime");
        signal?.throwIfAborted();
        await discardAgentThread(target.kind, target.id);
        signal?.throwIfAborted();
        await clearConversation(target.id, origin);
        emitAppEvent("conversations-changed", {});
      }, signal);
      return { status: "completed" as const, target };
    },
  };
}
