/**
 * Context 页 = 全局线程的主场（docs/agent-architecture.md §9）：跨书对话，
 * 支持多线程 —— 左侧线程列新建/切换，记忆不随线程分裂（user/global 记忆
 * 由 agent 按 scope 共享，线程只是对话容器）。标注从 AppHeader 的图标弹出
 * （见 AnnotationsPopover）；记忆不设 GUI，想知道 agent 记住了什么，直接问它。
 */
import { useEffect, useRef } from "react";
import { Alert } from "@read-aware/ui";
import { ChatComposer, type ChatComposerHandle } from "../../ai/components/ChatComposer";
import { ChatTranscript } from "../../ai/components/ChatTranscript";
import { useGlobalConversation } from "../../ai/hooks/useGlobalConversation";
import { useGlobalThreads } from "../../ai/hooks/useGlobalThreads";
import { ThreadRail } from "./ThreadRail";

export function ContextWorkspace() {
  const threads = useGlobalThreads();
  const conversation = useGlobalConversation(threads.activeThreadId);
  const composerRef = useRef<ChatComposerHandle | null>(null);

  // The page IS the chat — focus the composer on entry and on thread switch
  // (a frame later, after the surface has rendered so focus lands cleanly).
  useEffect(() => {
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [threads.activeThreadId]);

  // A committed turn changes the list (new thread's first message lands, the
  // active thread bubbles up, titles appear) — keep the rail in sync.
  const { refresh } = threads;
  useEffect(() => {
    if (!conversation.isStreaming) refresh();
  }, [conversation.isStreaming, conversation.messages, refresh]);

  return (
    <div className="flex h-full min-h-0">
      <ThreadRail threads={threads} />
      {/* Full-width shell so the composer's border-t runs edge to edge; the
          transcript and composer center their own content to a shared measure. */}
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <ChatTranscript
          messages={conversation.messages}
          isLoading={conversation.isLoading}
          isStreaming={conversation.isStreaming}
          streamingParts={conversation.streamingParts}
          status={conversation.status}
        />
        {conversation.error && (
          <div className="mx-auto w-full max-w-2xl px-3 pb-2">
            <Alert variant="destructive">{conversation.error}</Alert>
          </div>
        )}
        <ChatComposer
          ref={composerRef}
          isStreaming={conversation.isStreaming}
          pendingAttachment={null}
          onRemoveAttachment={() => {}}
          onSend={(text) => conversation.send(text)}
          onStop={conversation.stop}
        />
      </div>
    </div>
  );
}
