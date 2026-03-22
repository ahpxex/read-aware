import { Body, Button } from "../../../components";
import type { LibraryBook, EpubProgress, PdfProgress } from "../../library/lib/library-types";
import { EpubReaderView } from "./EpubReaderView";
import { PdfReaderView } from "./PdfReaderView";
import { ReaderShellOverlay } from "./ReaderShellOverlay";
import type { TocEntry } from "../lib/epub-types";
import type { LoadedEpub } from "../lib/epub-types";
import type { LoadedPdf } from "../lib/pdf-types";

type ReaderSource =
  | { format: "epub"; data: LoadedEpub }
  | { format: "pdf"; data: LoadedPdf }
  | null;

type ReaderWorkspaceProps = {
  selectedBook: LibraryBook;
  readerSource: ReaderSource;
  readerLoadError: string | null;
  isReaderLoading: boolean;
  readerToc: TocEntry[];
  currentChapterHref: string | null;
  chapterNavigationRequest: {
    href: string;
    requestId: number;
  } | null;
  overlayVisible: boolean;
  selectedEpubProgress: EpubProgress | null;
  selectedPdfProgress: PdfProgress | null;
  readerProgress: number | undefined;
  currentPosition: string | undefined;
  onCloseReader: () => void;
  onRetryOpen: (book: LibraryBook) => void;
  onToggleShell: () => void;
  onHideShell: () => void;
  onReaderPageChange: (current: number, total: number) => void;
  onEpubProgressChange: (progress: EpubProgress) => void;
  onPdfProgressChange: (progress: PdfProgress) => void;
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
  selectedPdfProgress,
  readerProgress,
  currentPosition,
  onCloseReader,
  onRetryOpen,
  onToggleShell,
  onHideShell,
  onReaderPageChange,
  onEpubProgressChange,
  onPdfProgressChange,
  onTocChange,
  onCurrentChapterChange,
  onChapterSelect,
}: ReaderWorkspaceProps) {
  return (
    <div className="relative h-screen w-full bg-paper">
      {readerSource?.format === "epub" ? (
        <EpubReaderView
          selectedBook={selectedBook}
          initialEpub={readerSource.data}
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

      {readerSource?.format === "pdf" ? (
        <PdfReaderView
          selectedBook={selectedBook}
          initialPdf={readerSource.data}
          initialProgress={selectedPdfProgress}
          onProgressChange={onPdfProgressChange}
        />
      ) : null}

      {!readerSource && (
        <div className="absolute inset-0 flex items-center justify-center bg-paper px-8 text-center">
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
        tocEntries={selectedBook.format === "epub" ? readerToc : []}
        currentChapterHref={selectedBook.format === "epub" ? currentChapterHref : null}
        onChapterSelect={selectedBook.format === "epub" ? onChapterSelect : undefined}
      />
    </div>
  );
}
