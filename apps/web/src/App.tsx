import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { ScrollArea } from "@read-aware/ui";
import { ContextWorkspace } from "./features/context/components/ContextWorkspace";
import { LibraryWorkspace } from "./features/library/components/LibraryWorkspace";
import { useLibraryController } from "./features/library/hooks/useLibraryController";
import { AppHeader } from "./features/navigation/components/AppHeader";
import { ShelfViewMenu } from "./features/shelf/components/ShelfViewMenu";
import { ReaderWorkspace } from "./features/reader/components/ReaderWorkspace";
import { useReaderSession } from "./features/reader/hooks/useReaderSession";
import { useGlobalShortcuts } from "./features/settings/hooks/useGlobalShortcuts";
import { BookSearchModal } from "./features/library/components/BookSearchModal";
import { activeTopNavAtom } from "./state/ui";

function App() {
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (import.meta.env.DEV) {
      void import("react-grab");
    }
  }, []);

  useGlobalShortcuts({ onOpenSearch: () => setSearchModalOpen(true) });

  const [activeTopNav, setActiveTopNav] = useAtom(activeTopNavAtom);
  const library = useLibraryController();
  const reader = useReaderSession({
    applyOptimisticProgress: library.applyOptimisticProgress,
    replaceBookInState: library.replaceBookInState,
    reportError: library.reportError,
  });

  // Handle book selection from search modal
  const handleSelectBookFromSearch = (book: typeof library.books[0]) => {
    reader.openReader(book);
  };

  if (reader.selectedBook) {
    return (
      <ReaderWorkspace
        selectedBook={reader.selectedBook}
        readerSource={reader.readerSource}
        readerLoadError={reader.readerLoadError}
        isReaderLoading={reader.isReaderLoading}
        readerToc={reader.readerToc}
        currentChapterHref={reader.currentChapterHref}
        chapterNavigationRequest={reader.chapterNavigationRequest}
        overlayVisible={reader.overlayVisible}
        selectedEpubProgress={reader.selectedEpubProgress}
        readerProgress={reader.readerProgress}
        currentPosition={reader.currentPosition}
        onCloseReader={reader.closeReader}
        onRetryOpen={reader.openReader}
        onToggleShell={reader.toggleShell}
        onHideShell={reader.hideShell}
        onReaderPageChange={reader.handleReaderPageChange}
        onEpubProgressChange={reader.handleEpubProgressChange}
        onTocChange={reader.setReaderToc}
        onCurrentChapterChange={reader.setCurrentChapterHref}
        onChapterSelect={reader.handleChapterSelect}
      />
    );
  }

  return (
    <main className="flex h-screen flex-col bg-[var(--ra-main-surface-color)] text-fg">
      <input
        ref={library.importInputRef}
        type="file"
        accept=".epub,.mobi,.azw3,.fb2,.pdf,application/epub+zip,application/pdf,application/x-fictionbook+xml"
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
        onOpenSettings={() => void navigate({ to: "/settings" })}
        onOpenSearch={() => setSearchModalOpen(true)}
        onTopNavChange={setActiveTopNav}
        viewControl={activeTopNav === "shelf" ? <ShelfViewMenu /> : undefined}
      />

      <ScrollArea className="h-full min-h-0 flex-1">
        {activeTopNav === "shelf" ? (
          <LibraryWorkspace
            isReady={library.libraryReady}
            error={library.libraryError}
            books={library.books}
            onImport={library.openImportPicker}
            onOpenBook={reader.openReader}
            onRemoveBook={library.handleRemoveBook}
          />
        ) : (
          <ContextWorkspace books={library.books} onOpenBook={reader.openReader} />
        )}
      </ScrollArea>

      <BookSearchModal
        isOpen={searchModalOpen}
        books={library.books}
        onClose={() => setSearchModalOpen(false)}
        onSelectBook={handleSelectBookFromSearch}
      />
    </main>
  );
}

export default App;
