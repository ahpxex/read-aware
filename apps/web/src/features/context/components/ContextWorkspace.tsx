/**
 * Context 页 = 全局线程的主场（docs/agent-architecture.md §9）：一个跨书总对话
 * （scope: global），与 reader 的 ChatPanel 同样极简 — 无标题带、无侧栏、无多
 * 线程。记忆与标注从 AppHeader 的图标弹出（见 ContextHeaderActions）。
 */
import { useEffect, useRef } from "react";
import { Alert } from "@read-aware/ui";
import { ChatComposer, type ChatComposerHandle } from "../../ai/components/ChatComposer";
import { ChatTranscript } from "../../ai/components/ChatTranscript";
import { useGlobalConversation } from "../../ai/hooks/useGlobalConversation";

export function ContextWorkspace() {
  const conversation = useGlobalConversation();
  const composerRef = useRef<ChatComposerHandle | null>(null);

  // The page IS the chat — focus the composer on entry (a frame later, after
  // the surface has rendered so focus lands cleanly).
  useEffect(() => {
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    // Full-width shell so the composer's border-t runs edge to edge; the
    // transcript and composer center their own content to a shared measure.
    <div className="flex h-full min-h-0 flex-col">
      <ChatTranscript
        messages={conversation.messages}
        isLoading={conversation.isLoading}
        isStreaming={conversation.isStreaming}
        streamingText={conversation.streamingText}
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
