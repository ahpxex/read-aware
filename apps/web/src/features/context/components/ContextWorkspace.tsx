import { useCallback, useEffect, useState } from "react";
import { Highlighter, NotePencil, Trash } from "@phosphor-icons/react";
import { Body, Caption, EmptyState, Heading, IconButton } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { formatDate, useTranslation } from "../../../i18n";
import { listAnnotations, deleteAnnotation } from "../../annotations/lib/annotation-db";
import { HIGHLIGHT_COLORS } from "../../reader/lib/highlight-renderer";
import type { Annotation, Highlight, Note } from "../../annotations/lib/annotation-types";
import type { LibraryBook } from "../../library/lib/library-types";

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
  return <NotePencil size={14} weight="regular" className="mt-0.5 shrink-0 text-fg-subtle" />;
}

export function ContextWorkspace({ books, onOpenBook }: ContextWorkspaceProps) {
  const { t } = useTranslation("ai");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const all = await listAnnotations();
      setAnnotations(all);
    } catch {
      setAnnotations([]);
    } finally {
      setIsLoading(false);
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

  // Group by book
  const grouped = new Map<string, Annotation[]>();
  for (const a of annotations) {
    const list = grouped.get(a.bookId) ?? [];
    list.push(a);
    grouped.set(a.bookId, list);
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Body className="text-sm text-fg-muted">{t("context.loading")}</Body>
      </div>
    );
  }

  if (annotations.length === 0) {
    return (
      <div className="ra-motion-page-enter mx-auto flex min-h-full max-w-screen-2xl flex-col justify-center px-6 py-16">
        <EmptyState
          icon={<Highlighter size={32} weight="regular" />}
          title={t("context.empty.title")}
          description={t("context.empty.description")}
        />
      </div>
    );
  }

  return (
    <div className="ra-motion-page-enter mx-auto max-w-screen-2xl px-6 py-8 sm:py-10">
      <div className="mb-8">
        <Heading size="2xl">{t("context.title")}</Heading>
        <Body className="mt-1 text-sm text-fg-muted">
          {t("context.summary", {
            items: t("context.contextItems", { count: annotations.length }),
            books: t("context.books", { count: grouped.size }),
          })}
        </Body>
      </div>

      <div className="flex flex-col gap-10">
        {[...grouped.entries()].map(([bookId, items]) => {
          const book = bookMap.get(bookId);
          return (
            <section key={bookId}>
              <button
                type="button"
                onClick={() => {
                  if (book) onOpenBook(book);
                }}
                className="mb-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg rounded-md"
              >
                <Heading size="xl" className="hover:text-fg-muted transition-colors">
                  {book?.title ?? t("context.unknownBook")}
                </Heading>
                {book?.author && (
                  <Body className="text-xs text-fg-muted">{book.author}</Body>
                )}
              </button>

              <div className="flex flex-col gap-1">
                {items.map((annotation) => (
                  <div
                    key={annotation.id}
                    className={cn(
                      "group flex gap-2 rounded-md p-2.5 transition-colors",
                      "hover:bg-fg/5",
                    )}
                  >
                    <AnnotationTypeIcon annotation={annotation} />
                    <div className="min-w-0 flex-1">
                      <Body className="line-clamp-2 text-sm text-fg-muted">
                        &ldquo;{annotation.text}&rdquo;
                      </Body>
                      {annotation.type === "note" && (
                        <Caption className="mt-0.5 line-clamp-1 text-fg-muted">
                          {(annotation as Note).content}
                        </Caption>
                      )}
                      <Caption className="mt-1 text-fg-subtle">
                        {formatDate(new Date(annotation.createdAt), {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
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
    </div>
  );
}
