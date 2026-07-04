/**
 * 跨书标注浏览，以 AppHeader 图标弹层呈现（与 reader 顶栏的 ReaderNotesPopover
 * 同一交互）：按书分组列出高亮 / 笔记 / 提问，点书名跳回该书。
 */
import { useCallback, useEffect, useState } from "react";
import { ChatCircleDots, NotePencil, Notebook, Trash } from "@phosphor-icons/react";
import { Body, Caption, Eyebrow, IconButton, Popover } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { formatDate, formatNumber, useTranslation } from "../../../i18n";
import { deleteAnnotation, listAnnotations } from "../../annotations/lib/annotation-db";
import { HIGHLIGHT_COLORS } from "../../reader/lib/highlight-renderer";
import type { Annotation, Highlight, Note } from "../../annotations/lib/annotation-types";
import type { LibraryBook } from "../../library/lib/library-types";

type AnnotationsPopoverProps = {
  books: LibraryBook[];
  onOpenBook: (book: LibraryBook) => void;
};

// Mirrors the AppHeader icon buttons so the trigger sits flush with them.
const TRIGGER_CLASS =
  "relative h-7 w-7 items-center justify-center text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg before:absolute before:-inset-1 before:content-['']";

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
    return (
      <ChatCircleDots size={12} weight="regular" className="mt-0.5 shrink-0 text-fg-subtle" />
    );
  }
  return <NotePencil size={12} weight="regular" className="mt-0.5 shrink-0 text-fg-subtle" />;
}

export function AnnotationsPopover({ books, onOpenBook }: AnnotationsPopoverProps) {
  const { t } = useTranslation("ai");
  const [open, setOpen] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const load = useCallback(async () => {
    try {
      setAnnotations(await listAnnotations());
    } catch {
      setAnnotations([]);
    }
  }, []);

  // Reload on every open — annotations accrue while the user reads elsewhere.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

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
      open={open}
      onOpenChange={setOpen}
      align="right"
      triggerLabel={t("context.annotations.title")}
      triggerTooltip={t("context.annotations.title")}
      triggerTooltipAlign="end"
      triggerClassName={cn(TRIGGER_CLASS, open && "text-fg")}
      trigger={<Notebook size={16} weight={open ? "fill" : "regular"} aria-hidden="true" />}
      panelClassName="flex max-h-[min(28rem,70vh)] w-[clamp(18rem,28vw,26rem)] flex-col overflow-hidden p-0"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
        <Eyebrow as="span">{t("context.annotations.title")}</Eyebrow>
        <span className="text-xs tabular-nums text-fg-subtle">
          {formatNumber(annotations.length)}
        </span>
      </div>

      {annotations.length === 0 ? (
        <div className="px-4 py-8">
          <Body className="text-center text-sm text-fg-muted">
            {t("context.empty.description")}
          </Body>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-4 px-3 py-3">
            {[...grouped.entries()].map(([bookId, items]) => {
              const book = bookMap.get(bookId);
              return (
                <section key={bookId}>
                  <button
                    type="button"
                    onClick={() => {
                      if (book) onOpenBook(book);
                    }}
                    className="mb-1 rounded-md px-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
                  >
                    <Body className="font-serif text-sm text-fg hover:text-fg-muted">
                      {book?.title ?? t("context.unknownBook")}
                    </Body>
                  </button>
                  <div className="flex flex-col gap-0.5">
                    {items.map((annotation) => (
                      <div
                        key={annotation.id}
                        className="group flex gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-fg/5"
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
                          className="shrink-0 text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-red-600"
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
      )}
    </Popover>
  );
}
