import type { Id } from "@read-aware/core";

/**
 * 线程 scope：每本书一个持久线程，外加一个跨书的全局线程。
 * 同一个核心 agent 按 scope 实例化，差异只在上下文装配默认值与角色 framing
 * （docs/agent-architecture.md §3）。
 */
export type ThreadScope = { kind: "book"; bookId: Id } | { kind: "global" };

/**
 * scope 的稳定字符串键（`book:<id>` | `global`）；
 * 用作会话行、记忆 scope 与投影的主键格式。
 */
export function threadScopeKey(scope: ThreadScope): string {
  return scope.kind === "book" ? `book:${scope.bookId}` : "global";
}
