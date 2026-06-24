import { NotePencil, ChatCircleDots, Trash } from "@phosphor-icons/react";
import { Body, Heading, IconButton, ScrollArea } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { HIGHLIGHT_COLORS } from "../../reader/lib/highlight-renderer";
import { useBookAnnotations } from "../hooks/useBookAnnotations";
import type { Annotation, Highlight, Note, AIChat } from "../lib/annotation-types";
import type { TocEntry } from "../../reader/lib/reader-types";
import { normalizeHref } from "../../reader/lib/epub-utils";

type AnnotationsPanelProps = {
  bookId: string | null;
  /** Whether the panel is currently revealed — gates the data fetch. */
  enabled: boolean;
  onNavigateTo: (cfiRange: string) => void;
  tocEntries: TocEntry[];
};

function resolveChapterLabel(
  chapterHref: string | null,
  tocEntries: TocEntry[],
): string | null {
  if (!chapterHref) return null;
  const entry = tocEntries.find(
    (e) => normalizeHref(e.href) === normalizeHref(chapterHref),
  );
  return entry?.label ?? null;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function AnnotationIcon({ annotation }: { annotation: Annotation }) {
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
    return <NotePencil size={14} weight="regular" className="mt-0.5 shrink-0 text-fg-subtle" />;
  }
  return <ChatCircleDots size={14} weight="regular" className="mt-0.5 shrink-0 text-indigo-400" />;
}

function AnnotationPreview({ annotation }: { annotation: Annotation }) {
  if (annotation.type === "note") {
    const note = annotation as Note;
    return (
      <p className="line-clamp-2 text-xs text-fg-muted">{note.content}</p>
    );
  }
  if (annotation.type === "ai-chat") {
    const chat = annotation as AIChat;
    const count = chat.messages.length;
    return (
      <p className="text-xs text-fg-muted">{count} message{count !== 1 ? "s" : ""}</p>
    );
  }
  return null;
}

/**
 * Notes & annotations list, rendered as plain panel content (no modal chrome).
 * The slide-in wrapper, sizing and dismissal are owned by the reader overlay so
 * this panel behaves like the table of contents rather than a separate sidebar.
 */
export function AnnotationsPanel({
  bookId,
  enabled,
  onNavigateTo,
  tocEntries,
}: AnnotationsPanelProps) {
  const { annotations, isLoading, remove } = useBookAnnotations(enabled ? bookId : null);

  // Group by chapter
  const grouped = new Map<string, Annotation[]>();
  for (const a of annotations) {
    const key = a.chapterHref ?? "__unknown__";
    const list = grouped.get(key) ?? [];
    list.push(a);
    grouped.set(key, list);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <Heading as="h2" size="xl">
          Notes
        </Heading>
        <span className="text-xs text-fg-subtle">{annotations.length} total</span>
      </div>

      {isLoading ? (
        <Body className="text-sm text-fg-muted">Loading...</Body>
      ) : annotations.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <Body className="text-center text-sm text-fg-muted">
            No notes yet. Select text in the reader to highlight, take notes, or ask AI.
          </Body>
        </div>
      ) : (
        <ScrollArea className="h-full min-h-0 flex-1">
          <div className="flex flex-col gap-5 pr-2">
            {[...grouped.entries()].map(([href, items]) => {
              const chapterLabel = resolveChapterLabel(
                href === "__unknown__" ? null : href,
                tocEntries,
              );
              return (
                <div key={href}>
                  {chapterLabel && (
                    <p className="mb-2 font-sans text-[13px] font-medium text-fg-subtle">
                      {chapterLabel}
                    </p>
                  )}
                  <div className="flex flex-col gap-2">
                    {items.map((annotation) => (
                      <button
                        key={annotation.id}
                        type="button"
                        onClick={() => {
                          if (annotation.cfiRange) {
                            onNavigateTo(annotation.cfiRange);
                          }
                        }}
                        className={cn(
                          "group flex w-full gap-2 rounded-md p-2 text-left transition-colors",
                          "hover:bg-fg/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg",
                        )}
                      >
                        <AnnotationIcon annotation={annotation} />
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-xs leading-relaxed text-fg-muted">
                            &ldquo;{annotation.text}&rdquo;
                          </p>
                          <AnnotationPreview annotation={annotation} />
                          <p className="mt-1 text-[10px] text-fg-subtle">
                            {formatTimestamp(annotation.createdAt)}
                          </p>
                        </div>
                        <IconButton
                          label="Delete"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            void remove(annotation.id);
                          }}
                          className="shrink-0 opacity-0 group-hover:opacity-100 text-fg-subtle hover:text-red-600"
                          icon={<Trash size={12} weight="regular" />}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
