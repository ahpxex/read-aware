import { atom } from "jotai";
import { localKV } from "../../../platform/local-store";
import { GLOBAL_CONVERSATION_ID, isGlobalThreadId } from "../lib/conversation-store";

const ACTIVE_THREAD_KEY = "read-aware-active-global-thread";

function initialThreadId(): string {
  const stored = localKV.getItem(ACTIVE_THREAD_KEY);
  return stored && isGlobalThreadId(stored) ? stored : GLOBAL_CONVERSATION_ID;
}

const baseAtom = atom<string>(initialThreadId());

/**
 * Context 页当前的全局线程 id（跨启动记住，写入即持久化）。
 * 线程切换器（AppHeader 的 ThreadsPopover）写，ContextWorkspace 读 ——
 * 两者隔着 AppHeader 的组件树，靠这个 atom 会合。
 */
export const activeGlobalThreadAtom = atom(
  (get) => get(baseAtom),
  (_get, set, threadId: string) => {
    set(baseAtom, threadId);
    localKV.setItem(ACTIVE_THREAD_KEY, threadId);
  },
);
