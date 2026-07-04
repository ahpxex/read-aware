/**
 * Context 页 = 全局线程的主场（docs/agent-architecture.md §9）：
 * 主体是跨书总对话（scope: global），右栏是记忆透明面板 + 跨书标注浏览。
 */
import { useCallback, useEffect, useState } from "react";
import { NotePencil, ChatCircleDots, Trash } from "@phosphor-icons/react";
import { Alert, Body, Caption, Eyebrow, Heading, IconButton } from "@read-aware/ui";
import { formatDate, useTranslation } from "../../../i18n";
import { listAnnotations, deleteAnnotation } from "../../annotations/lib/annotation-db";
import { HIGHLIGHT_COLORS } from "../../reader/lib/highlight-renderer";
import type { Annotation, Highlight, Note } from "../../annotations/lib/annotation-types";
import type { LibraryBook } from "../../library/lib/library-types";
import { ChatComposer } from "../../ai/components/ChatComposer";
import { ChatTranscript } from "../../ai/components/ChatTranscript";
import { useGlobalConversation } from "../../ai/hooks/useGlobalConversation";
import { MemoryPanel } from "./MemoryPanel";

type ContextWorkspaceProps = {
  books: LibraryBook[];
  onOpenBook: (book: LibraryBook) => void;
};

function AnnotationTypeIcon({ annotation }: { annotation: Annotation }) {
  if (annotation.type === "highlight") {
    const color = HIGHLIGHT_COLORS[(annotation as Highlight).color] ?? HIGHLIGHT_COLORS.yellow;
    return (
      <span
        className="mt-0.5 block h-3 w-3 shrink-0 rounded-sm"
        style={{ backgroundColor: color }}
      />
    );
  }
  if (annotation.type === "ask") {
    return (
      <ChatCircleDots size={14} weight="regular" className="mt-0.5 shrink-0 text-fg-subtle" />
    );
  }
  return <NotePencil size={14} weight="regular" className="mt-0.5 shrink-0 text-fg-subtle" />;
}

export function ContextWorkspace({ books, onOpenBook }: ContextWorkspaceProps) {
  const { t } = useTranslation("ai");
  const conversation = useGlobalConversation();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const load = useCallback(async () => {
    try {
      setAnnotations(await listAnnotations());
    } catch {
      setAnnotations([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteAnnotation(id);
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const bookMap = new Map(books.map((b) => [b.id, b]));
  const grouped = new Map<string, Annotation[]>();
  for (const annotation of annotations) {
    const list = grouped.get(annotation.bookId) ?? [];
    list.push(annotation);
    grouped.set(annotation.bookId, list);
  }

  return (
    <div className="flex h-full min-h-0">
      {/* 全局线程：跨书对话 */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-baseline gap-3 border-b border-border px-6 py-3">
          <Heading size="xl" className="font-serif">
            {t("context.chat.title")}
          </Heading>
          <Caption className="text-fg-subtle">{t("context.chat.subtitle")}</Caption>
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
          <div className="shrink-0 px-6 pb-2">
            <Alert variant="destructive">{conversation.error}</Alert>
          </div>
        )}
        <div className="shrink-0 border-t border-border px-6 py-3">
          <ChatComposer
            isStreaming={conversation.isStreaming}
            pendingAttachment={null}
            onRemoveAttachment={() => {}}
            onSend={(text) => conversation.send(text)}
            onStop={conversation.stop}
          />
        </div>
      </section>

      {/* 右栏：记忆透明面板 + 跨书标注 */}
      <aside className="w-[24rem] shrink-0 overflow-y-auto border-l border-border">
        <MemoryPanel />
        <section className="px-4 py-4">
          <Eyebrow className="mb-3 text-fg-muted">
            {t("context.annotations.title")} · {annotations.length}
          </Eyebrow>
          {annotations.length === 0 && (
            <Caption className="text-fg-subtle">{t("context.empty.description")}</Caption>
          )}
          <div className="flex flex-col gap-6">
            {[...grouped.entries()].map(([bookId, items]) => {
              const book = bookMap.get(bookId);
              return (
                <section key={bookId}>
                  <button
                    type="button"
                    onClick={() => {
                      if (book) onOpenBook(book);
                    }}
                    className="mb-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
                  >
                    <Body className="font-serif text-sm text-fg hover:text-fg-muted">
                      {book?.title ?? t("context.unknownBook")}
                    </Body>
                  </button>
                  <div className="flex flex-col gap-1">
                    {items.map((annotation) => (
                      <div
                        key={annotation.id}
                        className="group flex gap-2 rounded-md p-2 transition-colors hover:bg-fg/5"
                      >
                        <AnnotationTypeIcon annotation={annotation} />
                        <div className="min-w-0 flex-1">
                          <Caption className="line-clamp-2 text-fg-muted">
                            {annotation.type === "ask" ? annotation.text : `“${annotation.text}”`}
                          </Caption>
                          {annotation.type === "note" && (
                            <Caption className="mt-0.5 line-clamp-1 text-fg-subtle">
                              {(annotation as Note).content}
                            </Caption>
                          )}
                          <Caption className="mt-0.5 text-fg-subtle">
                            {formatDate(new Date(annotation.createdAt), {
                              month: "short",
                              day: "numeric",
                            })}
                          </Caption>
                        </div>
                        <IconButton
                          label={t("context.delete")}
                          size="sm"
                          onClick={() => void handleDelete(annotation.id)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 text-fg-subtle hover:text-red-600"
                          icon={<Trash size={12} weight="regular" />}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      </aside>
    </div>
  );
}
