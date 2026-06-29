import { useEffect, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ScrollArea } from "@read-aware/ui";
import { ContextWorkspace } from "./features/context/components/ContextWorkspace";
import { LibraryWorkspace } from "./features/library/components/LibraryWorkspace";
import { useLibraryController } from "./features/library/hooks/useLibraryController";
import { BOOK_FILE_ACCEPT } from "./features/library/lib/pick-book-files";
import { AppHeader } from "./features/navigation/components/AppHeader";
import { ShelfManagementMenu } from "./features/shelf/components/ShelfManagementMenu";
import { ReaderWorkspace } from "./features/reader/components/ReaderWorkspace";
import { StatsWorkspace } from "./features/stats/components/StatsWorkspace";
import { useReaderSession } from "./features/reader/hooks/useReaderSession";
import { useGlobalShortcuts } from "./features/settings/hooks/useGlobalShortcuts";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { CommandPalette } from "./features/command/components/CommandPalette";
import type { CommandContext } from "./features/command/lib/build-commands";
import {
  activeCollectionAtom,
  activeTopNavAtom,
  settingsOpenAtom,
  shelfSelectionAtom,
  shelfViewAtom,
} from "./state/ui";

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
  const [activeCollectionId, setActiveCollectionId] = useAtom(activeCollectionAtom);
  const [shelfView, setShelfView] = useAtom(shelfViewAtom);
  const shelfSelecting = useAtomValue(shelfSelectionAtom).active;
  const setShelfSelection = useSetAtom(shelfSelectionAtom);
  const library = useLibraryController();
  const reader = useReaderSession({
    applyOptimisticProgress: library.applyOptimisticProgress,
    replaceBookInState: library.replaceBookInState,
    reportError: library.reportError,
  });

  // Esc backs out one pushed view at a time — a standalone Context/Stats surface
  // to the shelf, or an open collection back to the full shelf. Skipped while
  // reading (the engine owns Esc), while a dialog is open (it owns its own), and
  // during selection mode (whose own surfaces handle Esc).
  const inSecondary = activeTopNav !== "shelf";
  const inCollection = activeTopNav === "shelf" && activeCollectionId !== null;
  useEffect(() => {
    if (reader.selectedBook || (!inSecondary && !inCollection)) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (settingsOpen || searchModalOpen || shelfSelecting) return;
      event.preventDefault();
      if (inSecondary) setActiveTopNav("shelf");
      else setActiveCollectionId(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    reader.selectedBook,
    inSecondary,
    inCollection,
    settingsOpen,
    searchModalOpen,
    shelfSelecting,
    setActiveTopNav,
    setActiveCollectionId,
  ]);

  const commandContext: CommandContext = {
    activeTopNav,
    shelfView,
    collections: library.collections,
    books: library.books,
    openBook: (book) => reader.openReader(book),
    openCollection: (id) => {
      setActiveTopNav("shelf");
      setActiveCollectionId(id);
    },
    goShelf: () => {
      setActiveTopNav("shelf");
      setActiveCollectionId(null);
    },
    goContext: () => setActiveTopNav("context"),
    goStats: () => setActiveTopNav("stats"),
    openSettings: () => setSettingsOpen(true),
    importBook: () => {
      setActiveTopNav("shelf");
      library.openImportPicker();
    },
    startSelection: () => {
      setActiveTopNav("shelf");
      setActiveCollectionId(null);
      setShelfSelection({ active: true, ids: [] });
    },
    setLayout: (layout) => {
      setActiveTopNav("shelf");
      setShelfView({ ...shelfView, layout });
    },
    setSort: (sort) => {
      setActiveTopNav("shelf");
      setShelfView({ ...shelfView, sort });
    },
    setGroup: (group) => {
      setActiveTopNav("shelf");
      setShelfView({ ...shelfView, group });
    },
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
            viewControl={activeTopNav === "shelf" ? <ShelfManagementMenu /> : undefined}
          />

          <ScrollArea className="h-full min-h-0 flex-1">
            {activeTopNav === "shelf" ? (
              <LibraryWorkspace
                isReady={library.libraryReady}
                error={library.libraryError}
                notice={library.importNotice}
                books={library.books}
                collections={library.collections}
                onImport={library.openImportPicker}
                onOpenBook={reader.openReader}
                onRemoveBook={library.handleRemoveBook}
                onToggleStar={library.handleToggleStar}
                onBulkRemove={library.handleRemoveMany}
                onCreateCollection={library.handleCreateCollection}
                onRenameCollection={library.handleRenameCollection}
                onDeleteCollection={library.handleDeleteCollection}
                onSetBooksCollection={library.handleSetBooksCollection}
              />
            ) : activeTopNav === "context" ? (
              <ContextWorkspace books={library.books} onOpenBook={reader.openReader} />
            ) : (
              <StatsWorkspace books={library.books} onOpenBook={reader.openReader} />
            )}
          </ScrollArea>

          <CommandPalette
            isOpen={searchModalOpen}
            onClose={() => setSearchModalOpen(false)}
            ctx={commandContext}
          />
        </main>
      )}

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

export default App;
