/**
 * 会话工具（doc §6）：
 * - search_conversation：历史对话原话检索 ——「你上次怎么说的」必须靠原文，
 *   search_memory 只有提炼后的记忆点。
 * - get_conversation_insights：某书线程的滚动摘要 —— 全局线程"问某本书聊过
 *   什么"的接口，而不是把子线程转录塞进上下文。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";

export function buildConversationTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const searchConversation: AgentTool = {
    name: "search_conversation",
    label: "Search past turns",
    description:
      "Search the verbatim conversation history. Use when the reader asks what was said earlier — quote the actual turns, never reconstruct them from memory.",
    parameters: Type.Object({
      query: Type.String({ description: "Text to look for in past turns" }),
      allThreads: Type.Optional(
        Type.Boolean({
          description:
            "Search every thread instead of only this one (default false; the global thread always searches all)",
        }),
      ),
    }),
    execute: async (_id, params) => {
      const { query, allThreads } = params as { query: string; allThreads?: boolean };
      const results = await deps.conversations.searchTurns({
        query,
        threadKey:
          allThreads || scope.kind === "global" ? undefined : threadScopeKey(scope),
        limit: 10,
      });
      return textResult(results);
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
    execute: async (_id, params) => {
      const { n = 6, bookId } = params as { n?: number; bookId?: string };
      const key = bookId ? `book:${bookId}` : threadScopeKey(scope);
      const records = await deps.conversations.load(key);
      const clamped = Math.min(Math.max(1, Math.floor(n)), 20);
      return textResult(records.slice(-clamped));
    },
  };

  const getConversationInsights: AgentTool = {
    name: "get_conversation_insights",
    label: "Book conversation summary",
    description:
      "Get the rolling summary of one book thread's conversation so far. bookId defaults to the current book.",
    parameters: Type.Object({
      bookId: Type.Optional(Type.String({ description: "Book id" })),
    }),
    execute: async (_id, params) => {
      const { bookId } = params as { bookId?: string };
      const target = bookId ?? (scope.kind === "book" ? scope.bookId : undefined);
      if (!target) throw new Error("bookId is required in the global thread");
      const summary = await deps.conversations.getInsights(`book:${target}`);
      return textResult({ bookId: target, summary: summary ?? null });
    },
  };

  return [searchConversation, getRecentTurns, getConversationInsights];
}
