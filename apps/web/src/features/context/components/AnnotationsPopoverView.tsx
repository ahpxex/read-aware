/**
 * 跨书标注浏览，以 AppHeader 图标弹层呈现（与 reader 顶栏的 ReaderNotesPopover
 * 同一交互与行样式）：按书分组列出高亮 / 笔记 / 提问，点书名或任一条目跳回该书。
 *
 * 纯表现层：标注的读取与删除由容器（`AnnotationsPopover`）持有，
 * 因此空态、多书分组、书已删除等状态都能单独渲染。
 */
import { Notebook } from "@phosphor-icons/react";
import { Body, Eyebrow, Popover } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { formatNumber, useTranslation } from "../../../i18n";
import { AnnotationRow } from "../../annotations/components/AnnotationRow";
import type { Annotation } from "../../annotations/lib/annotation-types";
import type { LibraryBook } from "../../library/lib/library-types";
import { contextHeaderActionClass } from "../lib/context-header-action";

type AnnotationsPopoverViewProps = {
  books: LibraryBook[];
  annotations: Annotation[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenBook: (book: LibraryBook) => void;
  onDelete: (id: string) => void;
};

export function AnnotationsPopoverView({
  books,
  annotations,
  open,
  onOpenChange,
  onOpenBook,
  onDelete,
}: AnnotationsPopoverViewProps) {
  const { t } = useTranslation("ai");

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
      onOpenChange={onOpenChange}
      align="right"
      triggerLabel={t("context.annotations.title")}
      triggerTooltip={t("context.annotations.title")}
      triggerTooltipAlign="end"
      triggerClassName={cn(contextHeaderActionClass, open && "text-fg")}
      trigger={
        <Notebook
          size={16}
          weight={open ? "fill" : "regular"}
          aria-hidden="true"
        />
      }
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
                onOpenChange(false);
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
                        onDelete={onDelete}
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
