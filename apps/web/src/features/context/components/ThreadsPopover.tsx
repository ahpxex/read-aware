/**
 * 全局线程切换器的容器：线程列表的读取（每次打开时现取）与删除都在这里，
 * 弹层本身是 `ThreadsPopoverView`。
 *
 * 删除 = 清空消息 + 会话行留墓碑（列表只列非空会话，所以随即消失）。
 * 弹层保持打开，方便连续清理；删的是当前线程时切到下一个（或全新线程）。
 */
import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { discardAgentThread } from "../../ai/agent/agent-runtime";
import {
  clearConversation,
  listGlobalThreads,
  newGlobalThreadId,
  type ConversationSummary,
} from "../../ai/lib/conversation-store";
import { activeGlobalThreadAtom } from "../../ai/state/global-thread";
import { ThreadsPopoverView } from "./ThreadsPopoverView";

export function ThreadsPopover() {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<ConversationSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useAtom(activeGlobalThreadAtom);

  // Reload on every open — threads accrue and retitle as turns commit.
  useEffect(() => {
    if (open) void listGlobalThreads().then(setThreads);
  }, [open]);

  const remove = async (threadId: string) => {
    await Promise.all([
      clearConversation(threadId),
      discardAgentThread("global", threadId),
    ]);
    const remaining = threads.filter((thread) => thread.id !== threadId);
    setThreads(remaining);
    if (threadId === activeThreadId) {
      setActiveThreadId(remaining[0]?.id ?? newGlobalThreadId());
    }
  };

  return (
    <ThreadsPopoverView
      open={open}
      onOpenChange={setOpen}
      threads={threads}
      activeThreadId={activeThreadId}
      onSelect={setActiveThreadId}
      onDelete={(threadId) => void remove(threadId)}
    />
  );
}
