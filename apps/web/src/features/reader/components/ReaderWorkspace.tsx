import { useCallback } from "react";
import { Body, Button, Spinner } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { BookFormat, LibraryBook, ReaderProgress } from "../../library/lib/library-types";
import { READER_THEME_BG } from "../../settings/lib/reader-css";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { useImmersiveWindowControls } from "../hooks/useImmersiveWindowControls";
import { useReaderAppearance } from "../hooks/useReaderAppearance";
import { useReadingTimeTracker } from "../hooks/useReadingTimeTracker";
import { FoliateReaderView } from "./FoliateReaderView";
import { ReaderShellOverlay } from "./ReaderShellOverlay";
import type { LoadedBook, TocEntry } from "../lib/reader-types";

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
      className="ra-motion-reader-enter relative h-screen w-full"
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
      />
    </div>
  );
}
