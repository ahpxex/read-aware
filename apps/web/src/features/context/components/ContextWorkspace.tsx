/**
 * Context 页 = 全局线程的主场（docs/agent-architecture.md §9）：
 * 主体是跨书总对话（scope: global）。记忆和标注降级为 header 的轻量
 * Popover，不再占据永久侧栏——对话是唯一的视觉主体。
 */
import { Alert, Caption, Heading } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { LibraryBook } from "../../library/lib/library-types";
import { ChatComposer } from "../../ai/components/ChatComposer";
import { ChatTranscript } from "../../ai/components/ChatTranscript";
import { useGlobalConversation } from "../../ai/hooks/useGlobalConversation";
import { AnnotationsPopover } from "./AnnotationsPopover";
import { MemoryPopover } from "./MemoryPopover";

type ContextWorkspaceProps = {
  books: LibraryBook[];
  onOpenBook: (book: LibraryBook) => void;
};

export function ContextWorkspace({ books, onOpenBook }: ContextWorkspaceProps) {
  const { t } = useTranslation("ai");
  const conversation = useGlobalConversation();

  return (
    <div className="flex h-full min-h-0">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-3">
          <Heading size="xl" className="font-serif">
            {t("context.chat.title")}
          </Heading>
          <Caption className="text-fg-subtle">{t("context.chat.subtitle")}</Caption>
          <div className="ml-auto flex items-center gap-1">
            <MemoryPopover />
            <AnnotationsPopover books={books} onOpenBook={onOpenBook} />
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <ChatTranscript
            messages={conversation.messages}
            isLoading={conversation.isLoading}
            isStreaming={conversation.isStreaming}
            streamingText={conversation.streamingText}
            status={conversation.status}
          />
        </div>
        {conversation.error && (
          <div className="mx-auto w-full max-w-[42rem] shrink-0 px-4 pb-2">
            <Alert variant="destructive">{conversation.error}</Alert>
          </div>
        )}
        <ChatComposer
          isStreaming={conversation.isStreaming}
          pendingAttachment={null}
          onRemoveAttachment={() => {}}
          onSend={(text) => conversation.send(text)}
          onStop={conversation.stop}
        />
      </section>
    </div>
  );
}
