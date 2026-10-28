import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@read-aware/ui";
import { useAtomValue } from "jotai";
import { useTranslation } from "../../../i18n";
import type { BookFormat, LibraryBook, ReaderProgress } from "../../library/lib/library-types";
import type { ReaderLoadError } from "../hooks/useReaderSession";
import { useReaderPalette } from "../../settings/hooks/useReaderPalette";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { useReadingModeControl } from "../hooks/useReadingModeControl";
import { useImmersiveWindowControls } from "../hooks/useImmersiveWindowControls";
import { useReaderAppearance } from "../hooks/useReaderAppearance";
import { useReaderFocusTarget } from "../hooks/useReaderFocusTarget";
import { useReadingTimeTracker } from "../hooks/useReadingTimeTracker";
import { FoliateReaderView } from "./FoliateReaderView";
import { ReaderShellOverlay } from "./ReaderShellOverlay";
import { ReaderHeaderFooter } from "./ReaderHeaderFooter";
import { ReaderFailureView } from "./ReaderFailureView";
import { resolveHeaderFooterLayout } from "../lib/header-footer-layout";
import { findTocIndexForHref } from "../lib/epub-utils";
import { headerFooterSettingsAtom } from "../../../state/ui";
import { isMobileOS } from "../../../platform/environment";
import { readerRecoveryAction } from "../lib/reader-failure";
import type { LoadedBook, ReadingCursor, TocEntry } from "../lib/reader-types";
import type { FoliateBook } from "../lib/foliate-engine";
import type { DomainActor } from "../../../platform/domain-actor";

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
  overlayOrigin: DomainActor;
  selectedEpubProgress: ReaderProgress | null;
  readerProgress: number | undefined;
  currentPage: number;
  totalPages: number;
  onCloseReader: () => void;
  onRetryOpen: (book: LibraryBook) => void;
  /** Open the import picker — re-importing the same file heals a book whose
   *  bytes never reached this device (sha-keyed dedup binds them back). */
  onReimportBook: () => void;
  onOpenSyncSettings: () => void;
  onToggleShell: () => void;
  onHideShell: (origin?: DomainActor) => void;
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
  overlayOrigin,
  selectedEpubProgress,
  readerProgress,
  currentPage,
  totalPages,
  onCloseReader,
  onRetryOpen,
  onReimportBook,
  onOpenSyncSettings,
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
  const { t } = useTranslation(["reader", "common"]);
  const contentFocus = useRef<HTMLDivElement | null>(null);
  useReaderFocusTarget(selectedBook.id, "content", contentFocus);
  const { effective: readerSettings } = useReaderAppearance(selectedBook.id);
  const readerPalette = useReaderPalette(readerSettings.theme);
  const themeBg = readerPalette.bg;
  // The header/footer strips paint with the page palette and stand in for the
  // status bar the immersive mobile reader hides. Battery is offered only
  // where the host can report one.
  const headerFooterSettings = useAtomValue(headerFooterSettingsAtom);
  const headerFooterLayout = useMemo(
    () => resolveHeaderFooterLayout(headerFooterSettings, { batteryAvailable: isMobileOS() }),
    [headerFooterSettings],
  );
  const headerFooterChapterTitle = useMemo(() => {
    const index = findTocIndexForHref(readerToc, currentChapterHref);
    return index >= 0 ? (readerToc[index]?.label ?? null) : null;
  }, [readerToc, currentChapterHref]);
  const recovery = readerLoadError ? readerRecoveryAction(readerLoadError) : null;
  const recoveryAction =
    recovery === "retry"
      ? { label: t("tryAgain"), onClick: () => onRetryOpen(selectedBook) }
      : recovery === "import"
        ? { label: t("fileMissing.reimport"), onClick: onReimportBook }
        : recovery === "settings"
          ? { label: t("common:actions.openSettings"), onClick: onOpenSyncSettings }
          : undefined;
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
  const [isFixedLayout, setIsFixedLayout] = useState(false);
  const modeControl = useReadingModeControl(selectedBook.id, !isFixedLayout);
  const textUnitMode = modeControl.mode;
  const { setActive: setModeActive } = modeControl;
  const textUnitModeActive = modeControl.request.active;
  const [readingCursor, setReadingCursor] = useState<ReadingCursor | null>(null);
  useEffect(() => {
    setReadingCursor(null);
  }, [selectedBook.id, readerSource]);
  const toggleTextUnitMode = useCallback(() => {
    setModeActive(!textUnitModeActive);
    // Entering the mode is a "start reading" gesture — drop the chrome so the
    // wash and the floating bar take over immediately.
    if (!textUnitModeActive) onHideShell();
  }, [setModeActive, textUnitModeActive, onHideShell]);
  const exitTextUnitMode = useCallback(() => setModeActive(false), [setModeActive]);

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
      ref={contentFocus}
      tabIndex={-1}
      style={{ backgroundColor: themeBg }}
    >
      {readerSource ? (
        <FoliateReaderView
          selectedBook={selectedBook}
          initialBook={readerSource.data}
          readerSettings={readerSettings}
          shellVisible={overlayVisible}
          stripSpace={{ top: headerFooterLayout.header != null, bottom: headerFooterLayout.footer != null }}
          onCloseReader={onCloseReader}
          onRetryOpen={() => onRetryOpen(selectedBook)}
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
          modeController={modeControl.controller}
          modeRequest={modeControl.request}
          onModeUnitChange={modeControl.setUnit}
          onExitTextUnitMode={exitTextUnitMode}
          onTextUnitModeStep={onHideShell}
          initialProgress={selectedEpubProgress}
          chapterNavigationRequest={chapterNavigationRequest}
          annotationNavigationRequest={annotationNavigationRequest}
          fractionNavigationRequest={fractionNavigationRequest}
        />
      ) : null}

      {!readerSource && (
        <div className="absolute inset-0 flex items-center justify-center bg-paper px-8">
          {readerLoadError ? (
            <ReaderFailureView
              title={t("openErrorTitle")}
              bookTitle={selectedBook.title}
              message={
                readerLoadError.kind === "generic"
                  ? readerLoadError.message
                  : t(`fileMissing.${readerLoadError.reason}`)
              }
              action={recoveryAction}
              onBack={onCloseReader}
            />
          ) : (
            showSourceLoader && <Spinner size="md" label={t("opening", { name: selectedBook.title })} />
          )}
        </div>
      )}

      {readerSource && (
        <ReaderHeaderFooter
          layout={headerFooterLayout}
          palette={readerPalette}
          dimmed={headerVisible}
          bookTitle={selectedBook.title}
          chapterTitle={headerFooterChapterTitle}
          progress={readerProgress}
          currentPage={currentPage}
          totalPages={totalPages}
        />
      )}

      <ReaderShellOverlay
        visible={headerVisible}
        visibilityOrigin={overlayOrigin}
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
        modeSnapshot={modeControl.snapshot}
        onToggleTextUnitMode={toggleTextUnitMode}
        fixedLayout={isFixedLayout}
      />
    </div>
  );
}
