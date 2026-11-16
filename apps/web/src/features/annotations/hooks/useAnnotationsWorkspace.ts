import { useCallback, useEffect, useMemo, useState } from "react";
import { useAtom } from "jotai";
import { useToast } from "@read-aware/ui";
import { userDomain } from "../../../domain";
import { describeError, useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import type { LibraryBook } from "../../library";
import { chapterAnchorsFromToc, type ChapterAnchor, type MarksFilter } from "../../reader";
import { isReaderMark } from "../lib/annotation-types";
import { groupMarksByBook, type BookMarks } from "../lib/marks-by-book";
import {
  annotationsWorkspaceBookAtom,
  annotationsWorkspaceFilterAtom,
  annotationsWorkspaceQueryAtom,
} from "../state/annotations-workspace";
import { useAnnotations } from "./useAnnotations";

const log = createLogger("annotations");

export type AnnotationsWorkspaceState = {
  /** Every marked book, most recently marked first. */
  books: BookMarks<LibraryBook>[];
  /** The book being shown, or null for every book. */
  selectedBookId: string | null;
  selectBook: (bookId: string | null) => void;
  isLoading: boolean;
  loadFailed: boolean;
  loadErrorCode?: string;
  retry: () => void;
  /** The selected book's chapters, for grouping; empty for every book, or until read. */
  chapters: ChapterAnchor[];
  filter: MarksFilter;
  setFilter: (filter: MarksFilter) => void;
  query: string;
  setQuery: (query: string) => void;
  openPassage: (bookId: string, cfi: string) => void;
  remove: (id: string) => void;
};

/**
 * The highlights & notes page: every book's highlights and notes (questions
 * asked of the agent are not marks), observed while the page is open, with the
 * selected book's chapter list read once it is chosen. A contents read that
 * fails only costs the chapter headings — the marks still list, newest first.
 */
export function useAnnotationsWorkspace(library: LibraryBook[]): AnnotationsWorkspaceState {
  const { t } = useTranslation("reader");
  const { toast } = useToast();
  const { annotations, isLoading, loadFailed, loadErrorCode, refresh, remove } = useAnnotations({ kind: "all" });
  const books = useMemo(() => groupMarksByBook(annotations.filter(isReaderMark), library), [annotations, library]);
  const [selectedBookId, setSelectedBookId] = useAtom(annotationsWorkspaceBookAtom);
  const [filter, setFilter] = useAtom(annotationsWorkspaceFilterAtom);
  const [query, setQuery] = useAtom(annotationsWorkspaceQueryAtom);

  const [chapters, setChapters] = useState<{ bookId: string; anchors: ChapterAnchor[] } | null>(null);
  const knowsChapters = chapters?.bookId === selectedBookId;
  // The same contents read a book's details dialog makes for its marks page.
  useEffect(() => {
    if (!selectedBookId || knowsChapters) return;
    const controller = new AbortController();
    userDomain.library.queries.books.getNavigationToc(selectedBookId, controller.signal).then(
      (toc) => {
        if (!controller.signal.aborted)
          setChapters({ bookId: selectedBookId, anchors: chapterAnchorsFromToc(toc.entries) });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) log.warn("reading the contents for a book's marks failed", error);
      },
    );
    return () => controller.abort();
  }, [selectedBookId, knowsChapters]);

  const openPassage = useCallback(
    (bookId: string, cfi: string) => {
      // The reader's own open path: it lands on the passage, not the last reading position.
      userDomain.reading.commands.goTo({ bookId, cfi }).catch((error: unknown) => {
        log.error("opening a book at a mark failed", error);
        toast({ variant: "destructive", title: t("marks.openFailed"), description: describeError(error).body });
      });
    },
    [t, toast],
  );

  const removeMark = useCallback(
    (id: string) => {
      remove(id).catch((error: unknown) => {
        log.error("deleting a mark from the highlights & notes page failed", error);
        toast({ variant: "destructive", title: t("annotations.deleteFailed"), description: describeError(error).body });
      });
    },
    [remove, t, toast],
  );

  return {
    books,
    selectedBookId,
    selectBook: setSelectedBookId,
    isLoading,
    loadFailed,
    loadErrorCode,
    retry: refresh,
    chapters: selectedBookId && knowsChapters ? chapters.anchors : [],
    filter,
    setFilter,
    query,
    setQuery,
    openPassage,
    remove: removeMark,
  };
}
