/**
 * Context 页 = 全局线程的主场（docs/agent-architecture.md §9）：跨书对话，
 * 支持多线程 —— 切换与新建在 AppHeader 的 ThreadsPopover（轻量弹层，无常驻
 * 边栏），当前线程经 activeGlobalThreadAtom 会合；记忆不随线程分裂。
 * 标注同样从 AppHeader 的图标弹出（AnnotationsPopover）；记忆不设 GUI，
 * 想知道 agent 记住了什么，直接问它。
 */
import { useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { Alert } from "@read-aware/ui";
import { ChatComposer, type ChatComposerHandle } from "../../ai/components/ChatComposer";
import { ChatTranscript } from "../../ai/components/ChatTranscript";
import { useGlobalConversation } from "../../ai/hooks/useGlobalConversation";
import { activeGlobalThreadAtom } from "../../ai/state/global-thread";

export function ContextWorkspace() {
  const activeThreadId = useAtomValue(activeGlobalThreadAtom);
  const conversation = useGlobalConversation(activeThreadId);
  const composerRef = useRef<ChatComposerHandle | null>(null);

  // The page IS the chat — focus the composer on entry and on thread switch
  // (a frame later, after the surface has rendered so focus lands cleanly).
  useEffect(() => {
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [activeThreadId]);

  return (
    // Full-width shell so the composer's border-t runs edge to edge; the
    // transcript and composer center their own content to a shared measure.
    <div className="flex h-full min-h-0 flex-col">
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
  );
}
