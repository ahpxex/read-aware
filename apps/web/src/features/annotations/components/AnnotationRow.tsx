import { ChatCircleDots, NotePencil, Trash } from "@phosphor-icons/react";
import { IconButton } from "@read-aware/ui";
import { formatDate, useTranslation } from "../../../i18n";
import { HIGHLIGHT_COLORS } from "../../reader/lib/highlight-renderer";
import type { Annotation, Highlight, Note } from "../lib/annotation-types";

function AnnotationIcon({ annotation }: { annotation: Annotation }) {
  if (annotation.type === "highlight") {
    const color =
      HIGHLIGHT_COLORS[(annotation as Highlight).color] ?? HIGHLIGHT_COLORS.yellow;
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

function formatTimestamp(iso: string): string {
  return formatDate(new Date(iso), { month: "short", day: "numeric" });
}

/**
 * One annotation in a list: its mark (highlight swatch / note icon), the quoted
 * passage, any note body, and a timestamp. Clicking navigates to the passage;
 * the trash control deletes it. Used by the chapter-annotations flyout.
 */
export function AnnotationRow({
  annotation,
  onNavigate,
  onDelete,
}: {
  annotation: Annotation;
  onNavigate: (cfiRange: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation("ai");
  return (
    <div className="group flex items-start gap-2 rounded-md p-2 transition-colors hover:bg-fg/5">
      <button
        type="button"
        onClick={() => {
          if (annotation.cfiRange) onNavigate(annotation.cfiRange);
        }}
        className="flex min-w-0 flex-1 gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg"
      >
        <AnnotationIcon annotation={annotation} />
        <div className="min-w-0 flex-1">
          {/* ask = 提问痕迹：text 是问题本身，不加引号（不是书里的原文） */}
          <p className="line-clamp-2 text-xs leading-relaxed text-fg-muted">
            {annotation.type === "ask" ? annotation.text : <>&ldquo;{annotation.text}&rdquo;</>}
          </p>
          {annotation.type === "note" && (
            <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">
              {(annotation as Note).content}
            </p>
          )}
          <p className="mt-1 text-[10px] text-fg-subtle">
            {formatTimestamp(annotation.createdAt)}
          </p>
        </div>
      </button>
      <IconButton
        label={t("annotation.delete")}
        size="sm"
        onClick={() => onDelete(annotation.id)}
        className="shrink-0 text-fg-subtle opacity-0 hover:text-red-600 group-hover:opacity-100 pointer-coarse:opacity-100"
        icon={<Trash size={12} weight="regular" />}
      />
    </div>
  );
}
