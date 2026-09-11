/**
 * 记忆工具（doc §6）：search_memory 检索、remember 显式写入。
 * remember 在回合内执行，写入即刻可见（doc 明确的顺序保证）；
 * tool-step chunk 自然流到 UI，就是"已记住"的第一版可见性。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, normalizeMemoryPageQuery, normalizeUserProfileQuery, type UserProfileQuery, type MemoryPageQuery } from "@read-aware/core";
import { buildProfileWriteTool } from "./user-profile-write-tool";
import type { MemoryKind, MemoryScope, RuntimeDeps } from "../ports";
import { threadScopeKey, type ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";
import { runMemoryBuild } from "../memory/build-policy";
import { buildMemoryManagementTool } from "./memory-management-tool";
import { buildBookClassificationTool } from "./book-classification-tool";
import { buildEntityTools } from "./entity-tools";

/** 线程默认可见的 scope 集合（doc §3 的检索默认值）。 */
export function visibleScopes(scope: ThreadScope): MemoryScope[] {
  return scope.kind === "book" ? [`book:${scope.bookId}`, "user", "global"] : ["user", "global"];
}

export function buildMemoryTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const profile: AgentTool = {
    name: "get_user_profile", label: "Read user profile",
    description: "Read the existing event-backed user profile summary used by the assistant, as bounded plain text. This does not expose other structured profile fields, infer fields, start onboarding, write memory or read transcripts. Both thread scopes see the same user profile. Missing is exists=false; empty stored text is exists=true. Follow nextOffset with the returned expectedRevision to avoid mixing revisions; on conflict restart at offset 0. Offsets/lengths count UTF-16 units, not bytes.",
    parameters: Type.Object({ offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 2, maximum: 16000 })),
      expectedRevision: Type.Optional(Type.String({ pattern: "^profile2:[a-f0-9]{64}$" })) }, { additionalProperties: false }),
    execute: async (_id, params, signal) => textResult(await deps.profile.readProfile(normalizeUserProfileQuery(params as UserProfileQuery), signal)),
  };
  const searchMemory: AgentTool = {
    name: "search_memory",
    label: "Search memory",
    description:
      "Search long-term memory about this reader (preferences, insights, book takeaways). Omit query to list the strongest memories. Returns items, total, revision and nextOffset; follow nextOffset with the same filters and expectedRevision to read beyond the first page. If results changed, restart at offset 0 without expectedRevision. The page revision is not a token for editing memory. A book thread cannot query another book via bookId.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Text filter; omit to list top memories" })),
      bookId: Type.Optional(
        Type.String({ description: "Include this book along with personal and cross-book memories (global thread only)" }),
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      expectedRevision: Type.Optional(Type.String({ pattern: "^mpg1:[a-f0-9]{64}$" })),
    }, { additionalProperties: false }),
    execute: async (_id, params) => {
      if (!params || typeof params !== "object" || Array.isArray(params)
        || Object.keys(params).some(key => !["query", "bookId", "limit", "offset", "expectedRevision"].includes(key))) {
        throw new AppError("memory/invalid-query", "Invalid memory search parameters");
      }
      const { bookId, ...page } = params as Omit<MemoryPageQuery, "scopes"> & { bookId?: string };
      if (bookId !== undefined && (typeof bookId !== "string" || !bookId.trim() || bookId.length > 256
        || scope.kind === "book" && bookId !== scope.bookId)) throw new AppError("memory/invalid-query", "Invalid memory book scope");
      const scopes: MemoryScope[] =
        bookId && scope.kind === "global" ? [`book:${bookId}`, "user", "global"] : visibleScopes(scope);
      return textResult(await deps.memory.pageMemories(normalizeMemoryPageQuery({ ...page, scopes })));
    },
  };

  const remember: AgentTool = {
    name: "remember",
    label: "Remember",
    description:
      "Explicitly save one durable memory about the reader or this reading. Use sparingly — only for things clearly worth keeping (a stated preference, a reading goal, a hard-won insight). NOT for \"记笔记\"/\"note this down\" requests: a note the reader asked for must go through create_annotation so it shows up in their notes list — memory is invisible to the reader.",
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
      const saved = await runMemoryBuild(deps, operation => operation.commit(deps.memory.saveMemory)({
        scope: memoryScope,
        kind,
        content,
        origin: "agent",
        sourceThreadKey: threadScopeKey(scope),
      }));
      return textResult(saved);
    },
  };

  return [searchMemory, remember, profile, buildProfileWriteTool(scope, deps), buildMemoryManagementTool(scope, deps), ...buildEntityTools(scope, deps), buildBookClassificationTool(scope, deps)];
}
