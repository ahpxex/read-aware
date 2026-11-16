/**
 * Context 页 = 全局线程的主场（docs/architecture/agent-architecture.md）：跨书对话，
 * 支持多线程 —— 线程列表停靠在页面左侧（宽屏，可收起，收起与否按设备记住），
 * 手机上是从左侧滑出的抽屉；当前线程经 activeGlobalThreadAtom 会合，记忆不随线程分裂。
 * 跨书的高亮与笔记是独立的整页（AnnotationsWorkspace），从页头图标进入；
 * 记忆不设 GUI，想知道 agent 记住了什么，直接问它。
 */
import { useEffect, useRef } from "react";
import { useAtom, useAtomValue } from "jotai";
import { Sidebar } from "@read-aware/ui";
import { usePhoneViewport } from "@read-aware/ui/media";
import { useBackInterceptor } from "../../../hooks/useBackInterceptor";
import { useTranslation } from "../../../i18n";
import { ChatComposer, type ChatComposerHandle } from "../../ai/components/ChatComposer";
import { ChatTranscript } from "../../ai/components/ChatTranscript";
import { useGlobalConversation } from "../../ai/hooks/useGlobalConversation";
import { activeGlobalThreadAtom } from "../../ai/state/global-thread";
import { ChatTurnRequest } from "../../ai/components/ChatTurnRequest";
import { useConversationTurnRequests } from "../../ai/hooks/useConversationTurnRequests";
import { useAgentThreads } from "../hooks/useAgentThreads";
import { threadsDrawerOpenAtom, threadsSidebarDockedAtom } from "../state/threads-sidebar";
import { ThreadsSidebarView } from "./ThreadsSidebarView";

export function AgentWorkspace() {
  const activeThreadId = useAtomValue(activeGlobalThreadAtom);
  const conversation = useGlobalConversation(activeThreadId);
  const composerRef = useRef<ChatComposerHandle | null>(null);
  const turnRequests = useConversationTurnRequests({ kind: "global", id: activeThreadId }, conversation, composerRef);
  const { t } = useTranslation("ai");
  const isPhone = usePhoneViewport();
  const docked = useAtomValue(threadsSidebarDockedAtom);
  const [drawerOpen, setDrawerOpen] = useAtom(threadsDrawerOpenAtom);
  const threads = useAgentThreads();
  // Android back closes the drawer before it leaves the page.
  useBackInterceptor(() => {
    if (!drawerOpen) return false;
    setDrawerOpen(false);
    return true;
  });
  const threadList = (onPicked?: () => void) => (
    <ThreadsSidebarView
      threads={threads.threads}
      isLoading={threads.isLoading}
      loadFailure={threads.loadFailure}
      onRetry={threads.retry}
      activeThreadId={threads.activeThreadId}
      onSelect={(threadId) => {
        threads.select(threadId);
        onPicked?.();
      }}
      onDelete={threads.remove}
    />
  );

  // The page IS the chat — focus the composer on entry and on thread switch
  // (a frame later, after the surface has rendered so focus lands cleanly).
  useEffect(() => {
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [activeThreadId]);

  return (
    <div className="ra-motion-page-enter flex h-full min-h-0">
      {isPhone ? (
        <Sidebar
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          label={t("agent.threads.title")}
          width="w-[min(20rem,85vw)]"
          className="flex flex-col bg-[var(--ra-main-surface-color)] pt-[var(--ra-safe-top)]"
        >
          {threadList(() => setDrawerOpen(false))}
        </Sidebar>
      ) : (
        docked && (
          <aside aria-label={t("agent.threads.title")} className="flex w-64 shrink-0 flex-col border-r border-border">
            {threadList()}
          </aside>
        )
      )}
      {/* The conversation column: the composer's border-t runs its full width;
          the transcript and composer center their own content to a shared measure. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatTranscript
          scope="global"
          messages={conversation.messages}
          isLoading={conversation.isLoading}
          isStreaming={conversation.isStreaming}
          streamingParts={conversation.streamingParts}
          status={conversation.status}
          onRetry={conversation.retry}
        />
        <ChatTurnRequest
          request={turnRequests.request}
          onAccept={turnRequests.accept}
          onDismiss={turnRequests.dismiss}
        />
        <ChatComposer
          scope="global"
          key={activeThreadId}
          ref={composerRef}
          disabled={conversation.isLoading}
          isStreaming={conversation.isStreaming}
          pendingAttachment={null}
          onRemoveAttachment={() => {}}
          onSend={(text, images) => conversation.send(text, images)}
          onStop={conversation.stop}
        />
      </div>
    </div>
  );
}
