import { actorFromEvent, causalActor, stampEventCause, type DomainActor } from "../../../platform/domain-actor";
import { atom, getDefaultStore } from "jotai";
import { onAppEvent } from "../../../platform/app-events";
import { afterLocalKVWrites, localKV } from "../../../platform/local-store";
import { createLogger } from "../../../platform/logger";
import { isTauri } from "../../../platform/environment";
import { normalizeConversationTarget } from "@read-aware/core";
import { GLOBAL_CONVERSATION_ID, isGlobalThreadId } from "../lib/conversation-store";

const ACTIVE_THREAD_KEY = "read-aware-active-global-thread";

/** JSON-encoded (the roaming contract); legacy raw strings still readable. */
function readStoredThreadId(): string {
  // Non-DOM catalog/test consumers have no preview persistence backing.
  if (!isTauri() && typeof localStorage === "undefined") return GLOBAL_CONVERSATION_ID;
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

const baseAtom = atom(stampEventCause({ id: readStoredThreadId() }, "system"));
export const activeGlobalThreadSourceAtom = atom((get) => get(baseAtom));
const log = createLogger("global-thread");

export function selectGlobalThread(
  threadId: string,
  origin: DomainActor = "user",
  signal?: AbortSignal,
): Promise<void> {
  const source = causalActor(origin);
  const target = normalizeConversationTarget({ kind: "global", id: threadId });
  return afterLocalKVWrites(async () => {
    signal?.throwIfAborted();
    await localKV.setItemAsync(ACTIVE_THREAD_KEY, JSON.stringify(target.id), source);
    getDefaultStore().set(baseAtom, stampEventCause({ id: target.id }, source));
  });
}

/**
 * Context 页当前的全局线程 id（跨启动记住，写入即持久化，且跨设备漫游 ——
 * 键在 roaming-preferences 的策略表里，写 KV 即自动入事件日志）。
 * Agent 页的线程列表（ThreadsSidebarView）与页头的新建会话写，AgentWorkspace 读 ——
 * 新建会话隔着 AppHeader 的组件树，靠这个 atom 会合。
 */
export const activeGlobalThreadAtom = atom(
  (get) => get(baseAtom).id,
  (_get, _set, threadId: string) => {
    void selectGlobalThread(threadId).catch((error) => log.warn("Could not select conversation", error));
  },
);

// A pull moved the roamed selection: re-seed from the freshly-overlaid KV.
// Lifetime listener — the Context page may not be mounted when it lands.
onAppEvent("roaming-preferences-changed", (event) => {
  if (!event.keys.includes(ACTIVE_THREAD_KEY)) return;
  getDefaultStore().set(baseAtom, stampEventCause({ id: readStoredThreadId() }, actorFromEvent(event)));
});
