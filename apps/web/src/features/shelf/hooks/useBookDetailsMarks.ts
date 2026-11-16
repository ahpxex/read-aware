import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@read-aware/ui";
import { userDomain } from "../../../domain";
import { describeError, useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import { isReaderMark, type Annotation, type Highlight, type Note } from "../../annotations";
import { chapterAnchorsFromToc, type ChapterAnchor } from "../../reader";

const log = createLogger("shelf");

/** A book's highlights and notes as its details dialog shows and lists them. */
export type BookDetailsMarks = {
  /** Highlights and notes only — questions asked of the agent are not marks. */
  marks: (Highlight | Note)[];
  isLoading: boolean;
  /** The read failed: the counts are unknown, not zero. */
  loadFailed: boolean;
  loadErrorCode?: string;
  retry: () => void;
  /** The book's chapters in reading order, for grouping; empty until read. */
  chapters: ChapterAnchor[];
  /** Close the dialog and open the book at the passage. */
  openPassage: (cfi: string) => void;
  remove: (id: string) => void;
};

/** The book's observed annotations, as `useBookAnnotations` reports them. */
export type ObservedAnnotations = {
  annotations: Annotation[];
  isLoading: boolean;
  loadFailed: boolean;
  loadErrorCode?: string;
  refresh: () => void;
  remove: (id: string) => Promise<void>;
};

/**
 * The details dialog's marks, from the book's annotation observation (the
 * container observes only while the dialog is open), with the book's chapter
 * list read once there is something to group. A contents read that fails only
 * costs the chapter headings — the marks still list, newest first.
 */
export function useBookDetailsMarks(
  bookId: string,
  open: boolean,
  onClose: () => void,
  observed: ObservedAnnotations,
): BookDetailsMarks {
  const { t } = useTranslation(["shelf", "reader"]);
  const { toast } = useToast();
  const { annotations, isLoading, loadFailed, loadErrorCode, refresh, remove } = observed;
  const marks = useMemo(() => annotations.filter(isReaderMark), [annotations]);
  const hasMarks = marks.length > 0;

  const [chapters, setChapters] = useState<{ bookId: string; anchors: ChapterAnchor[] } | null>(null);
  const knowsChapters = chapters?.bookId === bookId;
  useEffect(() => {
    if (!open || !hasMarks || knowsChapters) return;
    const controller = new AbortController();
    userDomain.library.queries.books.getNavigationToc(bookId, controller.signal).then(
      (toc) => {
        if (!controller.signal.aborted) setChapters({ bookId, anchors: chapterAnchorsFromToc(toc.entries) });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) log.warn("reading the contents for a book's marks failed", error);
      },
    );
    return () => controller.abort();
  }, [open, hasMarks, knowsChapters, bookId]);

  const openPassage = useCallback(
    (cfi: string) => {
      onClose();
      // The reader's own open path: the shelf hands off to the reader, which
      // lands on the passage rather than the last reading position.
      userDomain.reading.commands.goTo({ bookId, cfi }).catch((error: unknown) => {
        log.error("opening a book at a mark failed", error);
        toast({
          variant: "destructive",
          title: t("details.openPassageFailed"),
          description: describeError(error).body,
        });
      });
    },
    [bookId, onClose, t, toast],
  );

  const removeMark = useCallback(
    (id: string) => {
      remove(id).catch((error: unknown) => {
        log.error("deleting a mark from book details failed", error);
        toast({
          variant: "destructive",
          title: t("reader:annotations.deleteFailed"),
          description: describeError(error).body,
        });
      });
    },
    [remove, t, toast],
  );

  return {
    marks,
    isLoading,
    loadFailed,
    loadErrorCode,
    retry: refresh,
    chapters: knowsChapters ? chapters.anchors : [],
    openPassage,
    remove: removeMark,
  };
}
