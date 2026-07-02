/**
 * 记忆工具（doc §6）：search_memory 检索、remember 显式写入。
 * remember 在回合内执行，写入即刻可见（doc 明确的顺序保证）；
 * tool-step chunk 自然流到 UI，就是"已记住"的第一版可见性。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { MemoryKind, MemoryScope, RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: undefined,
  };
}

/** 线程默认可见的 scope 集合（doc §3 的检索默认值）。 */
export function visibleScopes(scope: ThreadScope): MemoryScope[] {
  return scope.kind === "book" ? [`book:${scope.bookId}`, "user", "global"] : ["user", "global"];
}

export function buildMemoryTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const searchMemory: AgentTool = {
    name: "search_memory",
    label: "Search memory",
    description:
      "Search your long-term memory about this reader (their preferences, past insights, book takeaways). Omit query to list the strongest memories.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Text filter; omit to list top memories" })),
      bookId: Type.Optional(
        Type.String({ description: "Restrict to one book's memories (global thread only)" }),
      ),
    }),
    execute: async (_id, params) => {
      const { query, bookId } = params as { query?: string; bookId?: string };
      const scopes: MemoryScope[] =
        bookId && scope.kind === "global" ? [`book:${bookId}`, "user", "global"] : visibleScopes(scope);
      return textResult(await deps.memory.searchMemories({ scopes, query, limit: 20 }));
    },
  };

  const remember: AgentTool = {
    name: "remember",
    label: "Remember",
    description:
      "Explicitly save one durable memory about the reader or this reading. Use sparingly — only for things clearly worth keeping (a stated preference, a reading goal, a hard-won insight).",
    parameters: Type.Object({
      content: Type.String({ description: "One self-contained sentence, in the reader's language" }),
      scope: Type.Union([Type.Literal("user"), Type.Literal("book"), Type.Literal("global")], {
        description: "user = about the reader; book = about the current book; global = cross-book",
      }),
      kind: Type.Union(
        [
          Type.Literal("fact"),
          Type.Literal("preference"),
          Type.Literal("insight"),
          Type.Literal("summary"),
        ],
        { description: "Memory kind" },
      ),
    }),
    execute: async (_id, params) => {
      const { content, scope: rawScope, kind } = params as {
        content: string;
        scope: "user" | "book" | "global";
        kind: MemoryKind;
      };
      let memoryScope: MemoryScope;
      if (rawScope === "book") {
        if (scope.kind !== "book") throw new Error("book scope is only valid inside a book thread");
        memoryScope = `book:${scope.bookId}`;
      } else if (rawScope === "global" && scope.kind === "book") {
        // 书线程里的跨书洞察由巩固管道升格，不允许直接写 global（doc §4）
        throw new Error("global scope is promoted by consolidation; use user or book here");
      } else {
        memoryScope = rawScope;
      }
      const saved = await deps.memory.saveMemory({
        scope: memoryScope,
        kind,
        content,
        origin: "agent",
        sourceThreadKey: threadScopeKey(scope),
      });
      return textResult(saved);
    },
  };

  return [searchMemory, remember];
}
