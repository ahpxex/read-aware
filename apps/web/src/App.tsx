import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { ScrollArea } from "@read-aware/ui";
import { ContextWorkspace } from "./features/context/components/ContextWorkspace";
import { LibraryWorkspace } from "./features/library/components/LibraryWorkspace";
import { useLibraryController } from "./features/library/hooks/useLibraryController";
import { BOOK_FILE_ACCEPT } from "./features/library/lib/pick-book-files";
import { AppHeader } from "./features/navigation/components/AppHeader";
import { ShelfViewMenu } from "./features/shelf/components/ShelfViewMenu";
import { ReaderWorkspace } from "./features/reader/components/ReaderWorkspace";
import { StatsWorkspace } from "./features/stats/components/StatsWorkspace";
import { useReaderSession } from "./features/reader/hooks/useReaderSession";
import { useGlobalShortcuts } from "./features/settings/hooks/useGlobalShortcuts";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { BookSearchModal } from "./features/library/components/BookSearchModal";
import { activeTopNavAtom, settingsOpenAtom } from "./state/ui";

function App() {
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useAtom(settingsOpenAtom);

  useEffect(() => {
    if (import.meta.env.DEV) {
      void import("react-grab");
    }
  }, []);

  useGlobalShortcuts({
    onOpenSearch: () => setSearchModalOpen(true),
    onOpenSettings: () => setSettingsOpen(true),
  });

  const [activeTopNav, setActiveTopNav] = useAtom(activeTopNavAtom);
  const library = useLibraryController();
  const reader = useReaderSession({
    applyOptimisticProgress: library.applyOptimisticProgress,
    replaceBookInState: library.replaceBookInState,
    reportError: library.reportError,
  });

  // Esc backs out of the standalone Context/Stats surfaces to the shelf. Skipped
  // while reading (the engine owns Esc) or when a dialog is open (it owns its own).
  useEffect(() => {
    if (reader.selectedBook || activeTopNav === "shelf") return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (settingsOpen || searchModalOpen) return;
      event.preventDefault();
      setActiveTopNav("shelf");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reader.selectedBook, activeTopNav, settingsOpen, searchModalOpen, setActiveTopNav]);

  // Handle book selection from search modal
  const handleSelectBookFromSearch = (book: typeof library.books[0]) => {
    reader.openReader(book);
  };

  return (
    <>
      {reader.selectedBook ? (
        <ReaderWorkspace
          selectedBook={reader.selectedBook}
          readerSource={reader.readerSource}
          readerLoadError={reader.readerLoadError}
          isReaderLoading={reader.isReaderLoading}
          readerToc={reader.readerToc}
          currentChapterHref={reader.currentChapterHref}
          chapterNavigationRequest={reader.chapterNavigationRequest}
          annotationNavigationRequest={reader.annotationNavigationRequest}
          overlayVisible={reader.overlayVisible}
          selectedEpubProgress={reader.selectedEpubProgress}
          readerProgress={reader.readerProgress}
          currentPage={reader.currentPage}
          totalPages={reader.totalPages}
          onCloseReader={reader.closeReader}
          onRetryOpen={reader.openReader}
          onToggleShell={reader.toggleShell}
          onHideShell={reader.hideShell}
          onReaderPageChange={reader.handleReaderPageChange}
          onEpubProgressChange={reader.handleEpubProgressChange}
          onTocChange={reader.setReaderToc}
          onCurrentChapterChange={reader.setCurrentChapterHref}
          onChapterSelect={reader.handleChapterSelect}
          onAnnotationSelect={reader.handleAnnotationSelect}
        />
      ) : (
        <main className="flex h-screen flex-col bg-[var(--ra-main-surface-color)] text-fg">
          <input
            ref={library.importInputRef}
            type="file"
            accept={BOOK_FILE_ACCEPT}
            multiple
            className="hidden"
            onChange={(event) => {
              void library.handleImportSelection(event);
            }}
          />

          <AppHeader
            activeTopNav={activeTopNav}
            isImporting={library.isImporting}
            onImport={library.openImportPicker}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenSearch={() => setSearchModalOpen(true)}
            onTopNavChange={setActiveTopNav}
            viewControl={activeTopNav === "shelf" ? <ShelfViewMenu /> : undefined}
          />

          <ScrollArea className="h-full min-h-0 flex-1">
            {activeTopNav === "shelf" ? (
              <LibraryWorkspace
                isReady={library.libraryReady}
                error={library.libraryError}
                notice={library.importNotice}
                books={library.books}
                onImport={library.openImportPicker}
                onOpenBook={reader.openReader}
                onRemoveBook={library.handleRemoveBook}
              />
            ) : activeTopNav === "context" ? (
              <ContextWorkspace books={library.books} onOpenBook={reader.openReader} />
            ) : (
              <StatsWorkspace books={library.books} onOpenBook={reader.openReader} />
            )}
          </ScrollArea>

          <BookSearchModal
            isOpen={searchModalOpen}
            books={library.books}
            onClose={() => setSearchModalOpen(false)}
            onSelectBook={handleSelectBookFromSearch}
          />
        </main>
      )}

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

export default App;
