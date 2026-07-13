import { useCallback, useEffect, useState } from "react";
import { Body, Button, Spinner } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { BookFormat, LibraryBook, ReaderProgress } from "../../library/lib/library-types";
import { READER_THEME_BG } from "../../settings/lib/reader-css";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { readNavigatorState } from "../lib/navigator-prefs";
import { useImmersiveWindowControls } from "../hooks/useImmersiveWindowControls";
import { useReaderAppearance } from "../hooks/useReaderAppearance";
import { useReadingTimeTracker } from "../hooks/useReadingTimeTracker";
import { FoliateReaderView } from "./FoliateReaderView";
import { ReaderShellOverlay } from "./ReaderShellOverlay";
import type { LoadedBook, TocEntry } from "../lib/reader-types";
import type { FoliateBook } from "../lib/foliate-engine";

type ReaderWorkspaceProps = {
  selectedBook: LibraryBook;
  readerSource: { format: BookFormat; data: LoadedBook } | null;
  readerLoadError: string | null;
  isReaderLoading: boolean;
  readerToc: TocEntry[];
  currentChapterHref: string | null;
  chapterNavigationRequest: {
    href: string;
    requestId: number;
  } | null;
  annotationNavigationRequest: {
    cfiRange: string;
    requestId: number;
  } | null;
  overlayVisible: boolean;
  selectedEpubProgress: ReaderProgress | null;
  readerProgress: number | undefined;
  currentPage: number;
  totalPages: number;
  onCloseReader: () => void;
  onRetryOpen: (book: LibraryBook) => void;
  onToggleShell: () => void;
  onHideShell: () => void;
  onReaderPageChange: (current: number, total: number) => void;
  onEpubProgressChange: (progress: ReaderProgress) => void;
  onTocChange: (entries: TocEntry[]) => void;
  onCurrentChapterChange: (href: string | null) => void;
  onBookReady: (book: LibraryBook, foliateBook: FoliateBook) => void;
  onChapterSelect: (href: string) => void;
  onAnnotationSelect: (cfiRange: string) => void;
};

export function ReaderWorkspace({
  selectedBook,
  readerSource,
  readerLoadError,
  isReaderLoading,
  readerToc,
  currentChapterHref,
  chapterNavigationRequest,
  annotationNavigationRequest,
  overlayVisible,
  selectedEpubProgress,
  readerProgress,
  currentPage,
  totalPages,
  onCloseReader,
  onRetryOpen,
  onToggleShell,
  onHideShell,
  onReaderPageChange,
  onEpubProgressChange,
  onTocChange,
  onCurrentChapterChange,
  onBookReady,
  onChapterSelect,
  onAnnotationSelect,
}: ReaderWorkspaceProps) {
  const { t } = useTranslation("reader");
  const { effective: readerSettings } = useReaderAppearance(selectedBook.id);
  const themeBg = READER_THEME_BG[readerSettings.theme];
  // Only surface the source loader once opening is genuinely slow, so fast opens
  // show nothing (themed background) instead of a flashed line of text.
  const showSourceLoader = useDelayedFlag(!readerSource && !readerLoadError, 250);

  const headerVisible = !isReaderLoading && overlayVisible;
  // Hide the native traffic lights only during true immersive reading (book
  // rendered, header dismissed). While the book is still loading or errored
  // there's no immersive view yet, so keep the window controls reachable.
  useImmersiveWindowControls(overlayVisible || !readerSource);

  // Sentence navigator mode. Owned here so the shell header's toggle and the
  // reader view (wash + floating bar + shortcuts) stay in sync. The mode is
  // sticky per book — closing a book (or the app) mid-navigation and reopening
  // it resumes sentence-by-sentence reading where it stopped (the resting
  // sentence itself is restored by useSentenceNavigator from the same store).
  // Fixed-layout books (PDF/CBZ) can't host it.
  const [navigatorActive, setNavigatorActive] = useState(
    () => readNavigatorState(selectedBook.id).active,
  );
  const [isFixedLayout, setIsFixedLayout] = useState(false);
  useEffect(() => {
    setNavigatorActive(readNavigatorState(selectedBook.id).active);
  }, [selectedBook.id]);
  const toggleNavigator = useCallback(() => {
    setNavigatorActive((active) => !active);
    // Entering the mode is a "start reading" gesture — drop the chrome so the
    // wash and the floating bar take over immediately.
    if (!navigatorActive) onHideShell();
  }, [navigatorActive, onHideShell]);
  const exitNavigator = useCallback(() => setNavigatorActive(false), []);

  // Track active reading time once the book is rendered. Reader relocate/page
  // callbacks bump activity so in-iframe reading isn't mistaken for idle.
  const { recordActivity } = useReadingTimeTracker(selectedBook.id, !!readerSource);
  const handlePageChange = useCallback(
    (current: number, total: number) => {
      recordActivity();
      onReaderPageChange(current, total);
    },
    [recordActivity, onReaderPageChange],
  );
  const handleProgressChange = useCallback(
    (progress: ReaderProgress) => {
      recordActivity();
      onEpubProgressChange(progress);
    },
    [recordActivity, onEpubProgressChange],
  );

  return (
    <div
      // Deliberately no entrance fade: the shelf dissolves ON TOP of this
      // surface when a book opens (see App.tsx), and a cross-fade only reads
      // cleanly when the incoming layer is already opaque — two simultaneous
      // fades let the body background flash through.
      className="relative h-screen w-full"
      style={{ backgroundColor: themeBg }}
    >
      {readerSource ? (
        <FoliateReaderView
          selectedBook={selectedBook}
          initialBook={readerSource.data}
          readerSettings={readerSettings}
          shellVisible={overlayVisible}
          onContentClick={onToggleShell}
          onContentScroll={onHideShell}
          onReadingActivity={recordActivity}
          onPageChange={handlePageChange}
          onProgressChange={handleProgressChange}
          onTocChange={onTocChange}
          onCurrentChapterChange={onCurrentChapterChange}
          onBookReady={(foliateBook) => onBookReady(selectedBook, foliateBook)}
          onFixedLayoutChange={setIsFixedLayout}
          navigatorActive={navigatorActive}
          onExitNavigator={exitNavigator}
          initialProgress={selectedEpubProgress}
          chapterNavigationRequest={chapterNavigationRequest}
          annotationNavigationRequest={annotationNavigationRequest}
        />
      ) : null}

      {!readerSource && (
        <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
          {readerLoadError ? (
            <div className="max-w-md space-y-4">
              <Body className="text-sm text-fg-muted">{readerLoadError}</Body>
              <div className="flex items-center justify-center gap-2">
                <Button size="sm" variant="outline" onClick={() => onRetryOpen(selectedBook)}>
                  {t("tryAgain")}
                </Button>
                <Button size="sm" variant="ghost" onClick={onCloseReader}>
                  {t("backToLibrary")}
                </Button>
              </div>
            </div>
          ) : (
            showSourceLoader && (
              <Spinner size="md" label={t("opening", { name: selectedBook.title })} />
            )
          )}
        </div>
      )}

      <ReaderShellOverlay
        visible={headerVisible}
        onBack={onCloseReader}
        book={selectedBook}
        progress={readerProgress}
        currentPage={currentPage}
        totalPages={totalPages}
        tocEntries={readerToc}
        currentChapterHref={currentChapterHref}
        onChapterSelect={onChapterSelect}
        onAnnotationSelect={onAnnotationSelect}
        navigatorAvailable={!isFixedLayout}
        navigatorActive={navigatorActive}
        onToggleNavigator={toggleNavigator}
      />
    </div>
  );
}
