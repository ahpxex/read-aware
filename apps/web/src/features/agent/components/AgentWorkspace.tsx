/**
 * Context 页 = 全局线程的主场（docs/architecture/agent-architecture.md）：跨书对话，
 * 支持多线程 —— 切换与新建在 AppHeader 右侧（新建对话按钮；Threads 打开线程面板
 * ThreadsPalette，与 ⌘K 同一套面板，可搜索、可键盘选择），页面本身就是对话；当前线程经
 * activeGlobalThreadAtom 会合，记忆不随线程分裂。
 * 跨书的高亮与笔记是独立的一级页面（AnnotationsWorkspace，主导航里的「笔记」）；
 * 记忆不设 GUI，想知道 agent 记住了什么，直接问它。
 */
import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { ChatComposer, type ChatComposerHandle } from "../../ai/components/ChatComposer";
import { ChatTranscript } from "../../ai/components/ChatTranscript";
import { useGlobalConversation } from "../../ai/hooks/useGlobalConversation";
import { activeGlobalThreadAtom } from "../../ai/state/global-thread";
import { ChatTurnRequest } from "../../ai/components/ChatTurnRequest";
import { useConversationTurnRequests } from "../../ai/hooks/useConversationTurnRequests";
import { chordToTokens, resolveBinding } from "../../settings";
import { shortcutBindingsAtom } from "../../../state/ui";
import { pickWelcomeSuggestions } from "../lib/welcome-suggestions";
import { AgentWelcome } from "./AgentWelcome";
import { ThreadsPalette } from "./ThreadsPalette";

export function AgentWorkspace() {
  const activeThreadId = useAtomValue(activeGlobalThreadAtom);
  const conversation = useGlobalConversation(activeThreadId);
  const composerRef = useRef<ChatComposerHandle | null>(null);
  const turnRequests = useConversationTurnRequests({ kind: "global", id: activeThreadId }, conversation, composerRef);
  const bindings = useAtomValue(shortcutBindingsAtom);
  // A fresh mix of ways in for each conversation, held while it stays open.
  const [welcome, setWelcome] = useState(() => ({ threadId: activeThreadId, picks: pickWelcomeSuggestions(4) }));
  if (welcome.threadId !== activeThreadId) setWelcome({ threadId: activeThreadId, picks: pickWelcomeSuggestions(4) });

  // The page IS the chat — focus the composer on entry and on thread switch
  // (a frame later, after the surface has rendered so focus lands cleanly).
  useEffect(() => {
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [activeThreadId]);

  return (
    // Full-width shell so the composer's border-t runs edge to edge; the
    // transcript and composer center their own content to a shared measure.
    // The page is set in the app's own type, like the rest of the app: the
    // content typography setting (a book's face and size, by default) is for
    // reading, so only the reader's chat follows it.
    <div className="ra-motion-page-enter ra-app-content-type flex h-full min-h-0 flex-col">
      <ChatTranscript
        scope="global"
        messages={conversation.messages}
        isLoading={conversation.isLoading}
        isStreaming={conversation.isStreaming}
        streamingParts={conversation.streamingParts}
        status={conversation.status}
        onRetry={conversation.retry}
        emptyState={
          <AgentWelcome
            suggestions={welcome.picks}
            onSuggest={(prompt) => composerRef.current?.adoptDraft(prompt)}
            searchKeys={chordToTokens(resolveBinding("search", bindings))}
            newConversationKeys={chordToTokens(resolveBinding("new-conversation", bindings))}
          />
        }
      />
      <ChatTurnRequest request={turnRequests.request} onAccept={turnRequests.accept} onDismiss={turnRequests.dismiss} />
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
      <ThreadsPalette />
    </div>
  );
}
