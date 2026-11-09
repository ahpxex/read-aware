import { useRef, type ComponentProps } from "react";
import { ScrollArea } from "@read-aware/ui";
import { useReaderFocusTarget } from "../hooks/useReaderFocusTarget";
import type { TocEntry } from "../lib/reader-types";
import { ReaderNotesList } from "./ReaderNotesList";
import { ReaderTocList } from "./ReaderTocList";

const SCROLL_BODY = "pb-[calc(1rem+var(--ra-safe-bottom))]";

/** What the reader's left panel shows; each has its own header button. */
export type ReaderSideView = "contents" | "notes";

/**
 * The reader's left panel: the table of contents, or the book's notes
 * (bookmarks, highlights and notes in one list), chosen from the header.
 */
export function ReaderContentsPanel({
  bookId,
  shown,
  view,
  notes,
  entries,
  activeIndex,
  onChapterSelect,
}: {
  bookId: string;
  /** The panel is on screen (the current chapter is revealed only then). */
  shown: boolean;
  view: ReaderSideView;
  notes: ComponentProps<typeof ReaderNotesList>;
  entries: TocEntry[];
  activeIndex: number;
  onChapterSelect: (href: string) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  useReaderFocusTarget(bookId, "toc", listRef);
  if (view === "notes")
    return (
      <ScrollArea className="h-full min-h-0">
        <div className={SCROLL_BODY}>
          <ReaderNotesList {...notes} />
        </div>
      </ScrollArea>
    );
  return (
    <ScrollArea className="h-full min-h-0">
      {/* No horizontal padding here: the rows carry it themselves, so the
          current chapter's highlight reaches both edges. */}
      <div ref={listRef} tabIndex={-1} className={`flex flex-col py-4 ${SCROLL_BODY}`}>
        <ReaderTocList
          bookId={bookId}
          entries={entries}
          activeIndex={activeIndex}
          revealing={shown}
          onSelect={onChapterSelect}
        />
      </div>
    </ScrollArea>
  );
}
