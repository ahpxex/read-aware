/**
 * 会话工具（doc §6）：
 * - search_conversation：历史对话原话检索 ——「你上次怎么说的」必须靠原文，
 *   search_memory 只有提炼后的记忆点。
 * - get_conversation_insights：某书线程的滚动摘要 —— 全局线程"问某本书聊过
 *   什么"的接口，而不是把子线程转录塞进上下文。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, normalizeConversationTarget } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { normalizeBookIdParam } from "./current-book";
import { textResult } from "./tool-result";
import { readingContextCall, permittedTurnRecords } from "../runtime/reading-context-policy";
import type { AgentTurnState } from "./turn-state";

export function buildConversationTools(scope: ThreadScope, deps: RuntimeDeps, state?: AgentTurnState): AgentTool[] {
  const searchConversation: AgentTool = {
    name: "search_conversation",
    label: "Search past turns",
    description:
      "Search the verbatim conversation history. Use when the reader asks what was said earlier — quote the actual turns, never reconstruct them from memory. Pass SEVERAL phrasings/synonyms in `queries` in this ONE call (results are merged); recall depends on wording and each retry costs a whole round trip.",
    parameters: Type.Object({
      queries: Type.Array(Type.String(), {
        minItems: 1,
        description: "Query variants, searched together. 2-4 focused variants beat one broad phrase.",
      }),
      allThreads: Type.Optional(
        Type.Boolean({
          description:
            "Search every thread instead of only this one (default false; the global thread always searches all)",
        }),
      ),
    }),
    execute: async (_id, params, signal) => {
      const { queries, allThreads } = params as { queries: string[]; allThreads?: boolean };
      const call = readingContextCall(deps.readingContextPolicy, signal, state?.readingContextPermissions);
      try {
        call.assertAllowed();
        const results = await call.wait(deps.conversations.searchTurns({
          queries: queries.slice(0, 8),
          threadKey:
            allThreads || scope.kind === "global" ? undefined : threadScopeKey(scope),
          limit: 10,
          includeAttachments: call.permissions.selection,
        }));
        call.assertAllowed();
        return textResult(permittedTurnRecords(results, call.permissions));
      } finally { call.dispose(); }
    },
  };

  const getRecentTurns: AgentTool = {
    name: "get_recent_turns",
    label: "Recent turns",
    description:
      "Rewind: fetch the last N verbatim messages of this conversation. Your context only carries the immediately previous exchange — when the user follows up on anything older (\"你上次说的那个…\", \"back to your earlier point\"), call this FIRST instead of answering from guesswork. bookId reads another book thread's tail (global thread only).",
    parameters: Type.Object({
      n: Type.Optional(
        Type.Number({ description: "How many recent messages to fetch (default 6, max 20)" }),
      ),
      bookId: Type.Optional(Type.String({ description: "Book id (global thread only)" })),
    }),
    execute: async (_id, params, signal) => {
      const { n = 6, bookId } = params as { n?: number; bookId?: string };
      const normalized = normalizeBookIdParam(bookId);
      const key = normalized ? `book:${normalized}` : threadScopeKey(scope);
      const call = readingContextCall(deps.readingContextPolicy, signal, state?.readingContextPermissions);
      try {
        call.assertAllowed();
        const records = await call.wait(deps.conversations.load(key));
        const clamped = Math.min(Math.max(1, Math.floor(n)), 20);
        call.assertAllowed();
        return textResult(permittedTurnRecords(records.slice(-clamped), call.permissions));
      } finally { call.dispose(); }
    },
  };

  const getConversationInsights: AgentTool = {
    name: "get_conversation_insights",
    label: "Conversation summary",
    description:
      "Read a stored rolling conversation summary, not verbatim history or a freshly generated summary. Choose bookId or threadId (global thread id), never both; omit both for this conversation. null means no stored summary, not no conversation. Summaries can lag recent turns. Available in global scope only; book scopes already receive their own rolling context.",
    parameters: Type.Object({
      bookId: Type.Optional(Type.String({ minLength: 1, maxLength: 256, description: "Book id" })),
      threadId: Type.Optional(Type.String({ minLength: 1, maxLength: 256, description: "Global thread id from get_conversation_state" })),
    }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      signal?.throwIfAborted();
      const input = params as { bookId?: string; threadId?: string };
      if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).some(key => key !== "bookId" && key !== "threadId")
        || input.bookId !== undefined && input.threadId !== undefined) throw new AppError("ui/invalid-target", "Choose one conversation target");
      const target = normalizeConversationTarget(input.bookId !== undefined ? { kind: "book", id: input.bookId }
        : input.threadId !== undefined ? { kind: "global", id: input.threadId }
        : scope.kind === "book" ? { kind: "book", id: scope.bookId } : { kind: "global", id: scope.threadId });
      const summary = await deps.conversations.getInsights(`${target.kind}:${target.id}`);
      signal?.throwIfAborted();
      return textResult({ ...(target.kind === "book" ? { bookId: target.id } : { threadId: target.id }), summary: summary ?? null });
    },
  };

  return scope.kind === "book"
    ? [searchConversation, getRecentTurns]
    : [searchConversation, getRecentTurns, getConversationInsights];
}
