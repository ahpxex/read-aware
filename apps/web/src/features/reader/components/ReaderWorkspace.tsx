import { useCallback, useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { Body, Button, Spinner } from "@read-aware/ui";
import { useTranslation } from "../../../i18n";
import type { BookFormat, LibraryBook, ReaderProgress } from "../../library/lib/library-types";
import type { ReaderLoadError } from "../hooks/useReaderSession";
import { useReaderPalette } from "../../settings/hooks/useReaderPalette";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { readTextUnitModeState } from "../lib/text-unit-mode-state";
import { useImmersiveWindowControls } from "../hooks/useImmersiveWindowControls";
import { useReaderAppearance } from "../hooks/useReaderAppearance";
import { useReadingTimeTracker } from "../hooks/useReadingTimeTracker";
import { FoliateReaderView } from "./FoliateReaderView";
import { ReaderShellOverlay } from "./ReaderShellOverlay";
import type { LoadedBook, ReadingCursor, TocEntry } from "../lib/reader-types";
import type { FoliateBook } from "../lib/foliate-engine";
import { textUnitReaderModeAtom } from "../../plugins/state/plugin-store";

type ReaderWorkspaceProps = {
  selectedBook: LibraryBook;
  readerSource: { format: BookFormat; data: LoadedBook } | null;
  readerLoadError: ReaderLoadError | null;
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
  fractionNavigationRequest: {
    fraction: number;
    requestId: number;
  } | null;
  overlayVisible: boolean;
  selectedEpubProgress: ReaderProgress | null;
  readerProgress: number | undefined;
  currentPage: number;
  totalPages: number;
  onCloseReader: () => void;
  onRetryOpen: (book: LibraryBook) => void;
  /** Open the import picker — re-importing the same file heals a book whose
   *  bytes never reached this device (sha-keyed dedup binds them back). */
  onReimportBook: () => void;
  onToggleShell: () => void;
  onHideShell: () => void;
  onReaderPageChange: (current: number, total: number) => void;
  onEpubProgressChange: (progress: ReaderProgress) => void;
  onReaderFractionChange: (fraction: number) => void;
  onSeek: (fraction: number) => void;
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
  fractionNavigationRequest,
  overlayVisible,
  selectedEpubProgress,
  readerProgress,
  currentPage,
  totalPages,
  onCloseReader,
  onRetryOpen,
  onReimportBook,
  onToggleShell,
  onHideShell,
  onReaderPageChange,
  onEpubProgressChange,
  onReaderFractionChange,
  onSeek,
  onTocChange,
  onCurrentChapterChange,
  onBookReady,
  onChapterSelect,
  onAnnotationSelect,
}: ReaderWorkspaceProps) {
  const { t } = useTranslation("reader");
  const { effective: readerSettings } = useReaderAppearance(selectedBook.id);
  const themeBg = useReaderPalette(readerSettings.theme).bg;
  // Only surface the source loader once opening is genuinely slow, so fast opens
  // show nothing (themed background) instead of a flashed line of text.
  const showSourceLoader = useDelayedFlag(!readerSource && !readerLoadError, 250);

  const headerVisible = !isReaderLoading && overlayVisible;
  // Hide the native traffic lights only during true immersive reading (book
  // rendered, header dismissed). While the book is still loading or errored
  // there's no immersive view yet, so keep the window controls reachable.
  useImmersiveWindowControls(overlayVisible || !readerSource);

  // The official plugin supplies unit segmentation; the host still owns
  // the engine bridge and every control. State lives here so the shell header
  // and reader view (wash + floating bar + shortcuts) stay in sync. The mode is
  // sticky per book — closing a book (or the app) mid-navigation and reopening
  // it resumes unit-by-unit reading where it stopped (the resting
  // unit itself is restored by useTextUnitNavigator from the same store).
  // Fixed-layout books (PDF/CBZ) can't host it.
  const textUnitMode = useAtomValue(textUnitReaderModeAtom);
  const [textUnitModeActive, setTextUnitModeActive] = useState(
    () => readTextUnitModeState(selectedBook.id).active,
  );
  const [isFixedLayout, setIsFixedLayout] = useState(false);
  const [readingCursor, setReadingCursor] = useState<ReadingCursor | null>(null);
  useEffect(() => {
    setTextUnitModeActive(readTextUnitModeState(selectedBook.id).active);
  }, [selectedBook.id]);
  useEffect(() => {
    setReadingCursor(null);
  }, [selectedBook.id, readerSource]);
  const toggleTextUnitMode = useCallback(() => {
    setTextUnitModeActive((active) => !active);
    // Entering the mode is a "start reading" gesture — drop the chrome so the
    // wash and the floating bar take over immediately.
    if (!textUnitModeActive) onHideShell();
  }, [textUnitModeActive, onHideShell]);
  const exitTextUnitMode = useCallback(() => setTextUnitModeActive(false), []);

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
          onCloseReader={onCloseReader}
          onContentClick={onToggleShell}
          onContentScroll={onHideShell}
          onReadingActivity={recordActivity}
          onPageChange={handlePageChange}
          onProgressChange={handleProgressChange}
          onFractionChange={onReaderFractionChange}
          onTocChange={onTocChange}
          onCurrentChapterChange={onCurrentChapterChange}
          onReadingCursorChange={setReadingCursor}
          onBookReady={(foliateBook) => onBookReady(selectedBook, foliateBook)}
          onFixedLayoutChange={setIsFixedLayout}
          textUnitModeActive={textUnitModeActive}
          textUnitMode={textUnitMode}
          onExitTextUnitMode={exitTextUnitMode}
          onTextUnitModeStep={onHideShell}
          initialProgress={selectedEpubProgress}
          chapterNavigationRequest={chapterNavigationRequest}
          annotationNavigationRequest={annotationNavigationRequest}
          fractionNavigationRequest={fractionNavigationRequest}
        />
      ) : null}

      {!readerSource && (
        <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
          {readerLoadError ? (
            <div className="max-w-md space-y-4">
              <Body className="text-sm text-fg-muted">
                {readerLoadError.kind === "generic"
                  ? readerLoadError.message
                  : t(`fileMissing.${readerLoadError.reason}`)}
              </Body>
              <div className="flex items-center justify-center gap-2">
                {/* Retry leads only where retrying can succeed (a transient
                    fetch failure); a file the cloud never had needs the
                    original file back instead — re-importing it heals this
                    book in place through the sha dedup gate. */}
                {readerLoadError.kind === "file-missing" &&
                (readerLoadError.reason === "no-sync" ||
                  readerLoadError.reason === "not-on-relay") ? (
                  <Button size="sm" variant="outline" onClick={onReimportBook}>
                    {t("fileMissing.reimport")}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => onRetryOpen(selectedBook)}>
                    {t("tryAgain")}
                  </Button>
                )}
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
        readingCursor={
          readingCursor ?? {
            ...(selectedEpubProgress?.cfi ? { anchor: selectedEpubProgress.cfi } : {}),
            ...(currentChapterHref ? { chapter: currentChapterHref } : {}),
            ...(readerProgress !== undefined ? { bookProgress: readerProgress } : {}),
            ...(totalPages > 0 ? { location: { current: currentPage, total: totalPages } } : {}),
          }
        }
        onChapterSelect={onChapterSelect}
        onAnnotationSelect={onAnnotationSelect}
        onSeek={onSeek}
        textUnitMode={textUnitMode}
        textUnitModeActive={textUnitModeActive}
        onToggleTextUnitMode={toggleTextUnitMode}
        fixedLayout={isFixedLayout}
      />
    </div>
  );
}
