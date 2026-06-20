import { NotePencil, ChatCircleDots, Trash } from "@phosphor-icons/react";
import { Body, Heading, IconButton, ScrollArea, Sidebar } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { HIGHLIGHT_COLORS } from "../../reader/lib/highlight-renderer";
import { useBookAnnotations } from "../hooks/useBookAnnotations";
import type { Annotation, Highlight, Note, AIChat } from "../lib/annotation-types";
import type { TocEntry } from "../../reader/lib/reader-types";
import { normalizeHref } from "../../reader/lib/epub-utils";

type AnnotationsSidebarProps = {
  bookId: string | null;
  open: boolean;
  onClose: () => void;
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
    return <NotePencil size={14} weight="regular" className="mt-0.5 shrink-0 text-stone-400" />;
  }
  return <ChatCircleDots size={14} weight="regular" className="mt-0.5 shrink-0 text-indigo-400" />;
}

function AnnotationPreview({ annotation }: { annotation: Annotation }) {
  if (annotation.type === "note") {
    const note = annotation as Note;
    return (
      <p className="line-clamp-2 text-xs text-stone-600">{note.content}</p>
    );
  }
  if (annotation.type === "ai-chat") {
    const chat = annotation as AIChat;
    const count = chat.messages.length;
    return (
      <p className="text-xs text-stone-500">{count} message{count !== 1 ? "s" : ""}</p>
    );
  }
  return null;
}

export function AnnotationsSidebar({
  bookId,
  open,
  onClose,
  onNavigateTo,
  tocEntries,
}: AnnotationsSidebarProps) {
  const { annotations, isLoading, remove } = useBookAnnotations(open ? bookId : null);

  // Group by chapter
  const grouped = new Map<string, Annotation[]>();
  for (const a of annotations) {
    const key = a.chapterHref ?? "__unknown__";
    const list = grouped.get(key) ?? [];
    list.push(a);
    grouped.set(key, list);
  }

  return (
    <Sidebar
      side="right"
      open={open}
      onClose={onClose}
      label="Annotations"
      width="w-80"
    >
      <div className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <Heading as="h2" size="xl">
            Annotations
          </Heading>
          <span className="text-xs text-stone-400">
            {annotations.length} total
          </span>
        </div>

        {isLoading ? (
          <Body className="text-sm text-stone-500">Loading...</Body>
        ) : annotations.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <Body className="text-center text-sm text-stone-500">
              No annotations yet. Select text in the reader to highlight, take notes, or ask AI.
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
                      <p className="mb-2 font-sans text-eyebrow font-medium uppercase tracking-eyebrow text-stone-400">
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
                            "hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950",
                          )}
                        >
                          <AnnotationIcon annotation={annotation} />
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-xs leading-relaxed text-stone-700">
                              &ldquo;{annotation.text}&rdquo;
                            </p>
                            <AnnotationPreview annotation={annotation} />
                            <p className="mt-1 text-[10px] text-stone-400">
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
                            className="shrink-0 opacity-0 group-hover:opacity-100 text-stone-400 hover:text-red-600"
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
    </Sidebar>
  );
}
