import type { Id } from "@read-aware/core";

/**
 * 线程 scope：每本书一个持久线程，外加**多个**用户自建的全局线程
 * （Context 页可新建/切换）。同一个核心 agent 按 scope 实例化，差异只在
 * 上下文装配默认值与角色 framing（docs/agent-architecture.md §3）。
 * 记忆不随线程分裂：user/global 记忆跨所有全局线程共享 ——
 * 线程只是对话容器，连续性靠记忆层。
 */
export type ThreadScope =
  | { kind: "book"; bookId: Id }
  | { kind: "global"; threadId: string };

/**
 * scope 的稳定字符串键（`book:<id>` | `global:<threadId>`）；
 * 用作会话行、记忆 scope 与投影的主键格式。
 */
export function threadScopeKey(scope: ThreadScope): string {
  return scope.kind === "book" ? `book:${scope.bookId}` : `global:${scope.threadId}`;
}
