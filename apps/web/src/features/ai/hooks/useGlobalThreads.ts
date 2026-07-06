import { useCallback, useEffect, useState } from "react";
import { localKV } from "../../../platform/local-store";
import {
  GLOBAL_CONVERSATION_ID,
  isGlobalThreadId,
  listGlobalThreads,
  newGlobalThreadId,
  type ConversationSummary,
} from "../lib/conversation-store";

const ACTIVE_THREAD_KEY = "read-aware-active-global-thread";

export interface GlobalThreads {
  /** 非空线程，最近活动在前。 */
  threads: ConversationSummary[];
  activeThreadId: string;
  /** 切到某个线程。 */
  select: (threadId: string) => void;
  /** 新建线程并切过去（会话行在第一条消息落库时才产生）。 */
  create: () => void;
  /** 消息提交后刷新列表（新线程首条消息落库、标题/排序变化）。 */
  refresh: () => void;
}

function initialActiveThread(): string {
  const stored = localKV.getItem(ACTIVE_THREAD_KEY);
  return stored && isGlobalThreadId(stored) ? stored : GLOBAL_CONVERSATION_ID;
}

/**
 * Context 页的线程管理：列表、当前线程（跨启动记住）、新建与切换。
 * 记忆不随线程分裂 —— user/global 记忆由 agent 按 scope 共享，
 * 这里只管对话容器。
 */
export function useGlobalThreads(): GlobalThreads {
  const [threads, setThreads] = useState<ConversationSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>(initialActiveThread);

  const refresh = useCallback(() => {
    void listGlobalThreads().then(setThreads);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const select = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
    localKV.setItem(ACTIVE_THREAD_KEY, threadId);
  }, []);

  const create = useCallback(() => {
    select(newGlobalThreadId());
  }, [select]);

  return { threads, activeThreadId, select, create, refresh };
}
