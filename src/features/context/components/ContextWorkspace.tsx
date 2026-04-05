import { useCallback, useEffect, useState } from "react";
import { Highlighter, NotePencil, ChatCircleDots, Trash } from "@phosphor-icons/react";
import { Body, Caption, EmptyState, Heading, IconButton } from "../../../components";
import { cn } from "../../../components/lib/cn";
import { listAnnotations, deleteAnnotation } from "../../annotations/lib/annotation-db";
import { HIGHLIGHT_COLORS } from "../../reader/lib/highlight-renderer";
import type { Annotation, Highlight, Note, AIChat } from "../../annotations/lib/annotation-types";
import type { LibraryBook } from "../../library/lib/library-types";

type ContextWorkspaceProps = {
  books: LibraryBook[];
  onOpenBook: (book: LibraryBook) => void;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

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
  if (annotation.type === "note") {
    return <NotePencil size={14} weight="regular" className="mt-0.5 shrink-0 text-stone-400" />;
  }
  return <ChatCircleDots size={14} weight="regular" className="mt-0.5 shrink-0 text-indigo-400" />;
}

export function ContextWorkspace({ books, onOpenBook }: ContextWorkspaceProps) {
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
        <Body className="text-sm text-stone-500">Loading context...</Body>
      </div>
    );
  }

  if (annotations.length === 0) {
    return (
      <div className="ra-motion-page-enter mx-auto flex min-h-full max-w-screen-2xl flex-col justify-center px-6 py-16">
        <EmptyState
          icon={<Highlighter size={32} weight="regular" />}
          title="No context yet"
          description="Highlights, notes, and AI conversations from your reading will appear here."
        />
      </div>
    );
  }

  return (
    <div className="ra-motion-page-enter mx-auto max-w-screen-2xl px-6 py-8 sm:py-10">
      <div className="mb-8">
        <Heading size="2xl">Context</Heading>
        <Body className="mt-1 text-sm text-stone-500">
          {annotations.length} context item{annotations.length !== 1 ? "s" : ""} across {grouped.size} book{grouped.size !== 1 ? "s" : ""}
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
                className="mb-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950 rounded-md"
              >
                <Heading size="xl" className="hover:text-stone-600 transition-colors">
                  {book?.title ?? "Unknown Book"}
                </Heading>
                {book?.author && (
                  <Body className="text-xs text-stone-500">{book.author}</Body>
                )}
              </button>

              <div className="flex flex-col gap-1">
                {items.map((annotation) => (
                  <div
                    key={annotation.id}
                    className={cn(
                      "group flex gap-2 rounded-md p-2.5 transition-colors",
                      "hover:bg-stone-100",
                    )}
                  >
                    <AnnotationTypeIcon annotation={annotation} />
                    <div className="min-w-0 flex-1">
                      <Body className="line-clamp-2 text-sm text-stone-700">
                        &ldquo;{annotation.text}&rdquo;
                      </Body>
                      {annotation.type === "note" && (
                        <Caption className="mt-0.5 line-clamp-1 text-stone-500">
                          {(annotation as Note).content}
                        </Caption>
                      )}
                      {annotation.type === "ai-chat" && (
                        <Caption className="mt-0.5 text-stone-500">
                          {(annotation as AIChat).messages.length} messages
                        </Caption>
                      )}
                      <Caption className="mt-1 text-stone-400">
                        {formatDate(annotation.createdAt)}
                      </Caption>
                    </div>
                    <IconButton
                      label="Delete"
                      size="sm"
                      onClick={() => void handleDelete(annotation.id)}
                      className="shrink-0 opacity-0 group-hover:opacity-100 text-stone-400 hover:text-red-600"
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
