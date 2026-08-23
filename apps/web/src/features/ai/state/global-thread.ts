import { atom, getDefaultStore } from "jotai";
import { onAppEvent } from "../../../platform/app-events";
import { localKV } from "../../../platform/local-store";
import { GLOBAL_CONVERSATION_ID, isGlobalThreadId } from "../lib/conversation-store";

const ACTIVE_THREAD_KEY = "read-aware-active-global-thread";

/** JSON-encoded (the roaming contract); legacy raw strings still readable. */
function readStoredThreadId(): string {
  const stored = localKV.getItem(ACTIVE_THREAD_KEY);
  if (!stored) return GLOBAL_CONVERSATION_ID;
  let value = stored;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed === "string") value = parsed;
  } catch {
    // Pre-roaming builds stored the id raw.
  }
  return isGlobalThreadId(value) ? value : GLOBAL_CONVERSATION_ID;
}

const baseAtom = atom<string>(readStoredThreadId());

/**
 * Context 页当前的全局线程 id（跨启动记住，写入即持久化，且跨设备漫游 ——
 * 键在 roaming-preferences 的策略表里，写 KV 即自动入事件日志）。
 * 线程切换器（AppHeader 的 ThreadsPopover）写，AgentWorkspace 读 ——
 * 两者隔着 AppHeader 的组件树，靠这个 atom 会合。
 */
export const activeGlobalThreadAtom = atom(
  (get) => get(baseAtom),
  (_get, set, threadId: string) => {
    set(baseAtom, threadId);
    localKV.setItem(ACTIVE_THREAD_KEY, JSON.stringify(threadId));
  },
);

// A pull moved the roamed selection: re-seed from the freshly-overlaid KV.
// Lifetime listener — the Context page may not be mounted when it lands.
onAppEvent("roaming-preferences-changed", ({ keys }) => {
  if (!keys.includes(ACTIVE_THREAD_KEY)) return;
  getDefaultStore().set(baseAtom, readStoredThreadId());
});
