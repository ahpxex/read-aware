/**
 * 全局线程（跨书对话，Context 页）：与书线程共用同一套 hook 与存储，
 * 差异只在 thread scope 与存储 id —— docs/agent-architecture.md §3
 * "一个 agent、两种 scope"。多线程化后由调用方传入具体的 threadId
 * （即会话存储 id）；线程列表与切换归 useGlobalThreads。
 */
import { useBookConversation, type BookConversation } from "./useBookConversation";

export function useGlobalConversation(threadId: string): BookConversation {
  return useBookConversation(threadId, "", "global");
}
