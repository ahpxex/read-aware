/**
 * Annotations as a lightweight header popover. The trigger is a quiet
 * BookmarkSimple icon; the panel drops down with a compact, by-book grouped list
 * of highlights and notes. Replaces the old permanent sidebar section.
 */
import { useCallback, useEffect, useState } from "react";
import { BookmarkSimple, ChatCircleDots, NotePencil, Trash } from "@phosphor-icons/react";
import { Caption, Eyebrow, IconButton, Popover } from "@read-aware/ui";
import { formatDate, useTranslation } from "../../../i18n";
import { deleteAnnotation, listAnnotations } from "../../annotations/lib/annotation-db";
import { HIGHLIGHT_COLORS } from "../../reader/lib/highlight-renderer";
import type { Annotation, Highlight, Note } from "../../annotations/lib/annotation-types";
import type { LibraryBook } from "../../library/lib/library-types";

type AnnotationsPopoverProps = {
  books: LibraryBook[];
  onOpenBook: (book: LibraryBook) => void;
};

const triggerClass =
  "items-center text-fg-muted hover:text-fg h-7 w-7 justify-center";

function AnnotationTypeIcon({ annotation }: { annotation: Annotation }) {
  if (annotation.type === "highlight") {
    const color = HIGHLIGHT_COLORS[(annotation as Highlight).color] ?? HIGHLIGHT_COLORS.yellow;
    return (
      <span
        className="mt-0.5 block h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ backgroundColor: color }}
      />
    );
  }
  if (annotation.type === "ask") {
    return <ChatCircleDots size={12} weight="regular" className="mt-0.5 shrink-0 text-fg-subtle" />;
  }
  return <NotePencil size={12} weight="regular" className="mt-0.5 shrink-0 text-fg-subtle" />;
}

export function AnnotationsPopover({ books, onOpenBook }: AnnotationsPopoverProps) {
  const { t } = useTranslation("ai");
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
    <Popover
      trigger={
        <>
          <BookmarkSimple size={16} weight="regular" aria-hidden="true" />
          {annotations.length > 0 && (
            <Caption className="ml-0.5 text-fg-subtle tabular-nums">
              {annotations.length}
            </Caption>
          )}
        </>
      }
      triggerLabel={t("context.annotations.title")}
      triggerTooltip={t("context.annotations.title")}
      triggerClassName={triggerClass}
      align="right"
      panelClassName="flex w-80 max-h-96 flex-col overflow-y-auto p-3"
    >
      <Eyebrow className="mb-2 text-fg-muted">
        {t("context.annotations.title")} · {annotations.length}
      </Eyebrow>
      {annotations.length === 0 && (
        <Caption className="text-fg-subtle">{t("context.empty.description")}</Caption>
      )}
      <div className="flex flex-col gap-3">
        {[...grouped.entries()].map(([bookId, items]) => {
          const book = bookMap.get(bookId);
          return (
            <section key={bookId}>
              <button
                type="button"
                onClick={() => {
                  if (book) onOpenBook(book);
                }}
                className="mb-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
              >
                <Caption className="font-serif text-fg hover:text-fg-muted">
                  {book?.title ?? t("context.unknownBook")}
                </Caption>
              </button>
              <div className="flex flex-col gap-0.5">
                {items.map((annotation) => (
                  <div
                    key={annotation.id}
                    className="group flex gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-fg/5"
                  >
                    <AnnotationTypeIcon annotation={annotation} />
                    <div className="min-w-0 flex-1">
                      <Caption className="line-clamp-2 text-fg-muted">
                        {annotation.type === "ask"
                          ? annotation.text
                          : `"${annotation.text}"`}
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
                      icon={<Trash size={11} weight="regular" />}
                    />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </Popover>
  );
}
