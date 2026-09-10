import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, normalizeConversationTarget, normalizeConversationTurnRequest, type ConversationTarget, type ConversationTurnRequest } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { requestUserInteraction } from "./user-interaction";
import { textResult } from "./tool-result";

export function buildConversationControlTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const tools: AgentTool[] = [{
    name: "get_conversation_state", label: "Conversation state",
    description: "Read live mounted conversation loading/streaming state and selected global draft identity. Book scope sees only its own session. Global scope also lists up to 100 persisted non-empty threads; empty drafts have no transcript row. Selection does not mean the conversation page is visible. No message text or private settings are returned.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async (_id, _params, signal) => {
      signal?.throwIfAborted(); const state = await deps.conversationControl.snapshot();
      const threads = scope.kind === "global" ? await deps.conversationControl.listThreads() : [];
      const requests = await deps.conversationControl.turnRequests();
      const visibleRequests = requests.filter(request => scope.kind === "global" || (request.target.kind === "book" && request.target.id === scope.bookId));
      signal?.throwIfAborted();
      return textResult({ ...state, selectedGlobalThreadId: scope.kind === "global" ? state.selectedGlobalThreadId : null,
        sessions: scope.kind === "global" ? state.sessions : state.sessions.filter(item => item.kind === "book" && item.id === scope.bookId),
        threads: threads.slice(0, 100).map(({ id, updatedAt }) => ({ id, updatedAt })), moreThreads: threads.length > 100,
        turnRequests: visibleRequests.slice(-20), moreTurnRequests: visibleRequests.length > 20 });
    },
  }, {
    name: "manage_conversation", label: "Manage conversation", executionMode: "sequential",
    description: "Create a selected empty global draft, select an existing global thread, stop another live conversation, or clear a transcript after user approval. Creating/selecting changes the saved selection, not app navigation; use navigate_app to show the Context page. This management tool is available only in global scope. Stop/clear of the thread executing this tool is refused to prevent self-cancellation or deadlock; use the host chat controls for that. Clear drains live turns before removal, clears hidden thread state/insights, but does not erase long-term memories, event history, or completed tool effects. Never sends or fabricates a user message.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("create"), Type.Literal("select"), Type.Literal("stop"), Type.Literal("clear")]),
      target: Type.Optional(Type.Object({ kind: Type.Union([Type.Literal("book"), Type.Literal("global")]), id: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false })) }, { additionalProperties: false }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      signal?.throwIfAborted();
      const input = params as { action: string; target?: ConversationTarget };
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "action" && key !== "target")) throw new AppError("ui/invalid-target", "Invalid conversation command");
      if (input.action === "create") {
        if (scope.kind !== "global" || input.target !== undefined) throw new AppError("ui/invalid-target", "Only global threads create drafts without a target");
        return textResult(await deps.conversationControl.createThread(signal));
      }
      const target = normalizeConversationTarget(input.target!);
      if (scope.kind === "book" && (target.kind !== "book" || target.id !== scope.bookId)) throw new AppError("reader/out-of-scope", "Conversation is outside this book");
      if (input.action === "select") {
        if (scope.kind !== "global" || target.kind !== "global") throw new AppError("ui/invalid-target", "Select requires a global thread");
        return textResult(await deps.conversationControl.selectThread(target.id, signal));
      }
      if (!["stop", "clear"].includes(input.action)) throw new AppError("ui/invalid-target", "Unknown conversation action");
      if (threadScopeKey(scope) === `${target.kind}:${target.id}`) throw new AppError("ui/unavailable", "Use host controls to stop or clear the conversation running this tool");
      if (input.action === "stop") return textResult(await deps.conversationControl.stop(target, signal));
      const { answer, details } = await requestUserInteraction({ deps, toolCallId, threadKey: threadScopeKey(scope), signal, onUpdate,
        request: { kind: "permission", action: "clear-conversation", subject: `${target.kind}:${target.id}` } });
      if (answer.cancelled || answer.optionId !== "approve") return { ...textResult({ cleared: false }), details };
      return { ...textResult(await deps.conversationControl.clear(target, signal)), details };
    },
  }];
  return [...(scope.kind === "book" ? tools.slice(0, 1) : tools), {
    name: "request_conversation_turn", label: "Propose a conversation turn", executionMode: "sequential",
    description: "Propose text for an empty composer, a new send, or retry of the last user turn in a mounted conversation. Nothing is sent until the user confirms on the host chat surface. Draft adoption never overwrites typed text. Send/retry require an idle unchanged transcript; retry preserves the original user message and attachments and does not undo tool effects. Requests expire after five minutes or on surface close/actor cancellation. Receipt pending is not user acceptance; started is not a finished model reply. Use get_conversation_state to read your request outcomes and cancel with requestId. Book scope is restricted to this book. Never claim a request was sent merely because it was proposed.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("draft"), Type.Literal("send"), Type.Literal("retry"), Type.Literal("cancel")]),
      target: Type.Optional(Type.Object({ kind: Type.Union([Type.Literal("book"), Type.Literal("global")]), id: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false })),
      text: Type.Optional(Type.String({ minLength: 1, maxLength: 65_536 })),
      requestId: Type.Optional(Type.String({ minLength: 1 })),
    }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const input = params as { action: string; target?: ConversationTarget; text?: string; requestId?: string };
      if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).some(key => !["action", "target", "text", "requestId"].includes(key))) throw new AppError("ui/invalid-target", "Invalid conversation request");
      if (input.action === "cancel") {
        if (!input.requestId || input.target !== undefined || input.text !== undefined) throw new AppError("ui/invalid-target", "Cancel requires only requestId");
        const owned = (await deps.conversationControl.turnRequests()).find(request => request.id === input.requestId);
        if (!owned || (scope.kind === "book" && (owned.target.kind !== "book" || owned.target.id !== scope.bookId))) throw new AppError("ui/invalid-target", "Conversation request is outside this scope");
        return textResult(await deps.conversationControl.cancelTurnRequest(input.requestId, signal));
      }
      if (input.requestId !== undefined) throw new AppError("ui/invalid-target", "New proposals cannot specify requestId");
      const request = normalizeConversationTurnRequest(input as ConversationTurnRequest);
      if (scope.kind === "book" && (request.target.kind !== "book" || request.target.id !== scope.bookId)) throw new AppError("reader/out-of-scope", "Conversation is outside this book");
      return textResult(await deps.conversationControl.requestTurn(request, signal));
    },
  }];
}
