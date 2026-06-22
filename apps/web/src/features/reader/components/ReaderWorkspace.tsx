import { useState } from "react";
import { useAtomValue } from "jotai";
import { Body, Button } from "@read-aware/ui";
import { effectiveReaderSettingsAtom } from "../../../state/ui";
import type { BookFormat, LibraryBook, ReaderProgress } from "../../library/lib/library-types";
import { READER_THEME_BG } from "../../settings/lib/reader-css";
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
  overlayVisible: boolean;
  selectedEpubProgress: ReaderProgress | null;
  readerProgress: number | undefined;
  currentPosition: string | undefined;
  onCloseReader: () => void;
  onRetryOpen: (book: LibraryBook) => void;
  onToggleShell: () => void;
  onHideShell: () => void;
  onReaderPageChange: (current: number, total: number) => void;
  onEpubProgressChange: (progress: ReaderProgress) => void;
  onTocChange: (entries: TocEntry[]) => void;
  onCurrentChapterChange: (href: string | null) => void;
  onChapterSelect: (href: string) => void;
};

export function ReaderWorkspace({
  selectedBook,
  readerSource,
  readerLoadError,
  isReaderLoading,
  readerToc,
  currentChapterHref,
  chapterNavigationRequest,
  overlayVisible,
  selectedEpubProgress,
  readerProgress,
  currentPosition,
  onCloseReader,
  onRetryOpen,
  onToggleShell,
  onHideShell,
  onReaderPageChange,
  onEpubProgressChange,
  onTocChange,
  onCurrentChapterChange,
  onChapterSelect,
}: ReaderWorkspaceProps) {
  const readerSettings = useAtomValue(effectiveReaderSettingsAtom);
  const themeBg = READER_THEME_BG[readerSettings.theme];
  const [annotationsSidebarOpen, setAnnotationsSidebarOpen] = useState(false);

  return (
    <div className="relative h-screen w-full" style={{ backgroundColor: themeBg }}>
      {readerSource ? (
        <FoliateReaderView
          selectedBook={selectedBook}
          initialBook={readerSource.data}
          readerSettings={readerSettings}
          annotationsSidebarOpen={annotationsSidebarOpen}
          onAnnotationsSidebarClose={() => setAnnotationsSidebarOpen(false)}
          onContentClick={onToggleShell}
          onContentScroll={onHideShell}
          onPageChange={onReaderPageChange}
          onProgressChange={onEpubProgressChange}
          onTocChange={onTocChange}
          onCurrentChapterChange={onCurrentChapterChange}
          initialProgress={selectedEpubProgress}
          chapterNavigationRequest={chapterNavigationRequest}
        />
      ) : null}

      {!readerSource && (
        <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
          <div className="max-w-md space-y-4">
            <Body className="text-sm text-stone-600">
              {readerLoadError ?? `Opening ${selectedBook.title}...`}
            </Body>
            {readerLoadError && (
              <div className="flex items-center justify-center gap-2">
                <Button size="sm" variant="outline" onClick={() => onRetryOpen(selectedBook)}>
                  Try again
                </Button>
                <Button size="sm" variant="ghost" onClick={onCloseReader}>
                  Back to library
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <ReaderShellOverlay
        visible={!isReaderLoading && overlayVisible}
        onBack={onCloseReader}
        title={selectedBook.title}
        subtitle={selectedBook.author}
        progress={readerProgress}
        currentPosition={currentPosition}
        tocEntries={readerToc}
        currentChapterHref={currentChapterHref}
        onChapterSelect={onChapterSelect}
        onToggleAnnotations={() => setAnnotationsSidebarOpen((prev) => !prev)}
      />
    </div>
  );
}
