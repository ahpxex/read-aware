/**
 * 跨书标注浏览，以 AppHeader 图标弹层呈现（与 reader 顶栏的 ReaderNotesPopover
 * 同一交互与行样式）：按书分组列出高亮 / 笔记 / 提问，点书名或任一条目跳回该书。
 */
import { useCallback, useEffect, useState } from "react";
import { Notebook } from "@phosphor-icons/react";
import { Body, Eyebrow, Popover } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { formatNumber, useTranslation } from "../../../i18n";
import { AnnotationRow } from "../../annotations/components/AnnotationRow";
import { deleteAnnotation, listAnnotations } from "../../annotations/lib/annotation-db";
import type { Annotation } from "../../annotations/lib/annotation-types";
import type { LibraryBook } from "../../library/lib/library-types";

type AnnotationsPopoverProps = {
  books: LibraryBook[];
  onOpenBook: (book: LibraryBook) => void;
};

// Mirrors the AppHeader icon buttons so the trigger sits flush with them.
const TRIGGER_CLASS =
  "relative h-7 w-7 items-center justify-center text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg before:absolute before:-inset-1 before:content-['']";

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
              const openBook = () => {
                if (!book) return;
                onOpenBook(book);
                setOpen(false);
              };
              return (
                <section key={bookId}>
                  <button
                    type="button"
                    onClick={openBook}
                    className="mb-1 rounded-md px-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
                  >
                    <Body className="font-serif text-sm text-fg hover:text-fg-muted">
                      {book?.title ?? t("context.unknownBook")}
                    </Body>
                  </button>
                  <div className="flex flex-col gap-1">
                    {items.map((annotation) => (
                      <AnnotationRow
                        key={annotation.id}
                        annotation={annotation}
                        onNavigate={openBook}
                        onDelete={(id) => void handleDelete(id)}
                      />
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
