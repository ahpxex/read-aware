/**
 * 全局线程（跨书总对话，Context 页）：与书线程共用同一套 hook 与存储，
 * 差异只在 thread scope 与存储伪 id —— 与 docs/agent-architecture.md §3
 * "一个 agent、两种 scope" 一致。
 */
import { GLOBAL_CONVERSATION_ID } from "../lib/conversation-store";
import { useBookConversation, type BookConversation } from "./useBookConversation";

export function useGlobalConversation(): BookConversation {
  return useBookConversation(GLOBAL_CONVERSATION_ID, "", "global");
}
