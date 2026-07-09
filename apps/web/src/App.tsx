import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ScrollArea, Spinner } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { scheduleIdleWarmup } from "./app-warmup";
import { dismissBootSplash } from "./boot-splash";
import { LibraryWorkspace } from "./features/library/components/LibraryWorkspace";
import { useLibraryController } from "./features/library/hooks/useLibraryController";
import { BOOK_FILE_ACCEPT } from "./features/library/lib/pick-book-files";
import type { LibraryBook } from "./features/library/lib/library-types";
import { AppHeader } from "./features/navigation/components/AppHeader";
import { ShelfManagementMenu } from "./features/shelf/components/ShelfManagementMenu";
import { useReaderSession } from "./features/reader/hooks/useReaderSession";
import { useGlobalShortcuts } from "./features/settings/hooks/useGlobalShortcuts";
import { useSurfaceHandoff } from "./hooks/useSurfaceHandoff";
import { BACK_REQUEST_EVENT, sendAppToBackground } from "./platform/back-navigation";
import { CommandPalette } from "./features/command/components/CommandPalette";
import type { CommandContext } from "./features/command/lib/build-commands";

// The shelf is the boot-critical surface; everything below is split out of its
// chunk and prefetched on idle (see app-warmup.ts), so cold start parses less
// JS but the panels still open instantly.
const ReaderWorkspace = lazy(() =>
  import("./features/reader/components/ReaderWorkspace").then((m) => ({
    default: m.ReaderWorkspace,
  })),
);
const ContextWorkspace = lazy(() =>
  import("./features/context/components/ContextWorkspace").then((m) => ({
    default: m.ContextWorkspace,
  })),
);
const AnnotationsPopover = lazy(() =>
  import("./features/context/components/AnnotationsPopover").then((m) => ({
    default: m.AnnotationsPopover,
  })),
);
const ThreadsPopover = lazy(() =>
  import("./features/context/components/ThreadsPopover").then((m) => ({
    default: m.ThreadsPopover,
  })),
);
const VocabularyPopover = lazy(() =>
  import("./features/context/components/VocabularyPopover").then((m) => ({
    default: m.VocabularyPopover,
  })),
);

/** 懒面冷加载时的占位：安静的居中 spinner，而不是一片空白。 */
function SurfaceFallback() {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center">
      <Spinner size="sm" />
    </div>
  );
}
const StatsWorkspace = lazy(() =>
  import("./features/stats/components/StatsWorkspace").then((m) => ({
    default: m.StatsWorkspace,
  })),
);
const SettingsDialog = lazy(() =>
  import("./features/settings/SettingsDialog").then((m) => ({
    default: m.SettingsDialog,
  })),
);
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
  // Latch: mount the (lazy) settings dialog on first open and keep it mounted,
  // preserving the always-mounted dialog's state/exit-animation behavior while
  // keeping its chunk out of the boot path.
  const [settingsMounted, setSettingsMounted] = useState(false);
  useEffect(() => {
    if (settingsOpen) setSettingsMounted(true);
  }, [settingsOpen]);

  useEffect(() => {
    dismissBootSplash();
    scheduleIdleWarmup();
  }, []);

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

  // Shelf ⇄ reader surface handoff: opaque-incoming / fading-outgoing, with
  // the open-direction fade deferred until the reader has rendered and the
  // main thread can animate again. See useSurfaceHandoff for the rules.
  const { shelfHandoff, readerExiting, openBook, closeBook } = useSurfaceHandoff(reader);

  // While the shelf holds over the opening reader it must stay VISUALLY
  // frozen: opening bumps lastOpenedAt, and the recency sort would otherwise
  // jump the clicked book to the front mid-handoff. Snapshot the books at
  // click time and render the held shelf from the snapshot; the live order
  // returns once the handoff ends (so closing shows the final order at once).
  const [heldShelfBooks, setHeldShelfBooks] = useState<LibraryBook[] | null>(null);
  const handleOpenBook = useCallback(
    (book: LibraryBook) => {
      setHeldShelfBooks(library.books);
      openBook(book);
    },
    [library.books, openBook],
  );
  useEffect(() => {
    if (shelfHandoff === "idle") setHeldShelfBooks(null);
  }, [shelfHandoff]);

  // Spinner feedback on the clicked cover while the shelf holds.
  const openingBookId = shelfHandoff !== "idle" ? reader.selectedBook?.id ?? null : null;

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

  // Android back button/gesture, relayed by the shell as BACK_REQUEST_EVENT.
  // Unwind one layer per press — dialogs and selection first, then the open
  // book, then pushed shelf surfaces — and at the shelf root background the
  // app with the process kept warm (never finish(), which would tear down the
  // Tauri process and make every return a cold start). A surface owning a
  // deeper layer may consume the event with preventDefault() before us.
  useEffect(() => {
    function onBackRequest(event: Event) {
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      if (searchModalOpen) {
        setSearchModalOpen(false);
        return;
      }
      if (shelfSelecting) {
        setShelfSelection({ active: false, ids: [] });
        return;
      }
      if (reader.selectedBook) {
        closeBook();
        return;
      }
      if (inSecondary) {
        setActiveTopNav("shelf");
        return;
      }
      if (inCollection) {
        setActiveCollectionId(null);
        return;
      }
      sendAppToBackground();
    }
    window.addEventListener(BACK_REQUEST_EVENT, onBackRequest);
    return () => window.removeEventListener(BACK_REQUEST_EVENT, onBackRequest);
  }, [
    settingsOpen,
    searchModalOpen,
    shelfSelecting,
    reader.selectedBook,
    inSecondary,
    inCollection,
    closeBook,
    setSettingsOpen,
    setShelfSelection,
    setActiveTopNav,
    setActiveCollectionId,
  ]);

  const commandContext: CommandContext = {
    activeTopNav,
    shelfView,
    collections: library.collections,
    books: library.books,
    openBook: handleOpenBook,
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
      {reader.selectedBook && (
        // While closing, the reader becomes a fixed overlay dissolving over
        // the (opaque) shelf that has already remounted underneath.
        <div
          className={cn(
            readerExiting &&
              "ra-motion-surface-exit pointer-events-none fixed inset-0 z-40",
          )}
        >
        {/* Fallback shows only if warmup hasn't fetched the chunk yet (rare):
            a quiet paper surface, matching the reader's own pre-render state. */}
        <Suspense fallback={<div className="h-dvh w-full bg-paper" />}>
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
          onCloseReader={closeBook}
          onRetryOpen={handleOpenBook}
          onToggleShell={reader.toggleShell}
          onHideShell={reader.hideShell}
          onReaderPageChange={reader.handleReaderPageChange}
          onEpubProgressChange={reader.handleEpubProgressChange}
          onTocChange={reader.setReaderToc}
          onCurrentChapterChange={reader.setCurrentChapterHref}
          onChapterSelect={reader.handleChapterSelect}
          onAnnotationSelect={reader.handleAnnotationSelect}
        />
        </Suspense>
        </div>
      )}

      {/* Also rendered during either handoff: while a book opens it holds
          opaque (then dissolves) as a fixed overlay above the reader; while
          the reader exits it is the opaque in-flow surface underneath. */}
      {(!reader.selectedBook || shelfHandoff !== "idle" || readerExiting) && (
        <main
          className={cn(
            "flex h-dvh flex-col bg-[var(--ra-main-surface-color)] text-fg",
            reader.selectedBook &&
              shelfHandoff !== "idle" &&
              "pointer-events-none fixed inset-0 z-40",
            reader.selectedBook &&
              shelfHandoff === "fading" &&
              "ra-motion-surface-exit",
          )}
        >
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
            actions={
              activeTopNav === "context" ? (
                <Suspense fallback={null}>
                  <ThreadsPopover />
                  <VocabularyPopover />
                  <AnnotationsPopover books={library.books} onOpenBook={handleOpenBook} />
                </Suspense>
              ) : undefined
            }
          />

          <ScrollArea className="h-full min-h-0 flex-1">
            {activeTopNav === "shelf" ? (
              <LibraryWorkspace
                isReady={library.libraryReady}
                books={heldShelfBooks ?? library.books}
                collections={library.collections}
                openingBookId={openingBookId}
                onImport={library.openImportPicker}
                onOpenBook={handleOpenBook}
                onRemoveBook={library.handleRemoveBook}
                onToggleStar={library.handleToggleStar}
                onUpdateBookMetadata={library.handleUpdateBookMetadata}
                onBulkRemove={library.handleRemoveMany}
                onCreateCollection={library.handleCreateCollection}
                onRenameCollection={library.handleRenameCollection}
                onDeleteCollection={library.handleDeleteCollection}
                onSetBooksCollection={library.handleSetBooksCollection}
              />
            ) : activeTopNav === "context" ? (
              <Suspense fallback={<SurfaceFallback />}>
                <ContextWorkspace />
              </Suspense>
            ) : (
              <Suspense fallback={<SurfaceFallback />}>
                <StatsWorkspace books={library.books} onOpenBook={handleOpenBook} />
              </Suspense>
            )}
          </ScrollArea>

          <CommandPalette
            isOpen={searchModalOpen}
            onClose={() => setSearchModalOpen(false)}
            ctx={commandContext}
          />
        </main>
      )}


      {settingsMounted && (
        <Suspense fallback={null}>
          <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

export default App;
