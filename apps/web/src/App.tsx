import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ScrollArea, Spinner } from "@read-aware/ui";
import { cn } from "@read-aware/ui/cn";
import { scheduleIdleWarmup } from "./app-warmup";
import { dismissBootSplash } from "./boot-splash";
import { DropImportOverlay } from "./features/library/components/DropImportOverlay";
import { LibraryWorkspace } from "./features/library/components/LibraryWorkspace";
import { useDropBookImport } from "./features/library/hooks/useDropBookImport";
import { useExternalBookOpens } from "./features/library/hooks/useExternalBookOpens";
import { useLibraryController } from "./features/library/hooks/useLibraryController";
import { BOOK_FILE_ACCEPT } from "./features/library/lib/pick-book-files";
import type { LibraryBook } from "./features/library/lib/library-types";
import { AppHeader } from "./features/navigation/components/AppHeader";
import { usePrimaryDestinations } from "./features/navigation/hooks/usePrimaryDestinations";
import { useContextHeaderActions } from "./features/context/hooks/useContextHeaderActions";
import { SyncIndicator } from "./features/sync/components/SyncIndicator";
import { UpdateIndicator } from "./features/update/components/UpdateIndicator";
import { WhatsNewNotice } from "./features/update/components/WhatsNewNotice";
import { useSoftwareUpdate } from "./features/update/hooks/useSoftwareUpdate";
import { ShelfManagementMenu } from "./features/shelf/components/ShelfManagementMenu";
import { useOpenBookRequestHandler } from "./features/ai/hooks/useOpenBookRequest";
import { newGlobalThreadId } from "./features/ai/lib/conversation-store";
import { activeGlobalThreadAtom } from "./features/ai/state/global-thread";
import { useReaderSession } from "./features/reader/hooks/useReaderSession";
import { useGlobalShortcuts } from "./features/settings/hooks/useGlobalShortcuts";
import { useSyncLoginDeepLink } from "./features/settings/hooks/useSyncLoginDeepLink";
import { usePluginCommandShortcuts } from "./features/plugins/hooks/usePluginCommandShortcuts";
import { useSurfaceHandoff } from "./hooks/useSurfaceHandoff";
import { emitAppEvent } from "./platform/app-events";
import { startSyncScheduler } from "./platform/sync/sync-scheduler";
import {
  BACK_REQUEST_EVENT,
  sendAppToBackground,
} from "./platform/back-navigation";
import { CommandPalette } from "./features/command/components/CommandPalette";
import type { CommandContext } from "./features/command/lib/build-commands";
import { PluginDialogHost } from "./features/plugins/components/PluginDialogHost";
import { PluginInstallConsentDialog } from "./features/plugins/components/PluginInstallConsentDialog";
import { PluginPageHost } from "./features/plugins/components/PluginPageHost";
import { PluginToastBridge } from "./features/plugins/components/PluginToastBridge";
import { usePluginCommandItems } from "./features/plugins/hooks/usePluginCommandItems";
import { initializePlugins } from "./features/plugins/runtime/plugin-host";
import { checkPluginUpdates } from "./features/plugins/runtime/plugin-updates";
import { pluginReaderNavAtom } from "./features/plugins/state/reader-nav";

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
  generalSettingsAtom,
  settingsOpenAtom,
  shelfSelectionAtom,
  shelfViewAtom,
  type TopNav,
} from "./state/ui";

function App() {
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useAtom(settingsOpenAtom);
  const generalSettings = useAtomValue(generalSettingsAtom);
  const softwareUpdate = useSoftwareUpdate();
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
    void initializePlugins();
    // No-ops until an account is connected (Data & Sync); off the boot path.
    const stopSync = startSyncScheduler();
    // Off the boot path: a quiet daily look at the marketplace for updates.
    const updateCheck = window.setTimeout(
      () => void checkPluginUpdates(),
      10_000,
    );
    // Keep the agent package out of the boot chunk; maintenance itself waits for
    // an idle slot and no-ops until AI is configured.
    let disposed = false;
    let stopAgentMaintenance: (() => void) | undefined;
    const maintenanceStart = window.setTimeout(() => {
      void import("./features/ai/agent/maintenance").then(
        ({ startAgentMaintenance }) => {
          if (disposed) return;
          stopAgentMaintenance = startAgentMaintenance();
        },
      );
    }, 15_000);
    return () => {
      disposed = true;
      window.clearTimeout(updateCheck);
      window.clearTimeout(maintenanceStart);
      stopAgentMaintenance?.();
      stopSync();
    };
  }, []);

  usePluginCommandShortcuts();
  // Sign-in links (readaware://sync/login/…) land in Settings → Data & Sync.
  useSyncLoginDeepLink();

  const [activeTopNav, setActiveTopNav] = useAtom(activeTopNavAtom);
  const setActiveGlobalThreadId = useSetAtom(activeGlobalThreadAtom);
  const [activeCollectionId, setActiveCollectionId] =
    useAtom(activeCollectionAtom);
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
  const { shelfHandoff, readerExiting, openBook, closeBook } =
    useSurfaceHandoff(reader);

  const createGlobalConversation = useCallback(() => {
    setActiveGlobalThreadId(newGlobalThreadId());
    setActiveTopNav("context");
    if (reader.selectedBook) closeBook();
  }, [
    closeBook,
    reader.selectedBook,
    setActiveGlobalThreadId,
    setActiveTopNav,
  ]);

  const primaryDestinations = usePrimaryDestinations();
  const selectPrimaryDestination = useCallback(
    (index: number) => {
      // The reader owns the screen; surface switching underneath it would be
      // invisible. Close the book first (back / navigation), then switch.
      if (reader.selectedBook) return false;
      const destination = primaryDestinations[index];
      if (!destination) return false;
      setActiveTopNav(destination.topNav);
      return true;
    },
    [reader.selectedBook, primaryDestinations, setActiveTopNav],
  );

  useGlobalShortcuts({
    onOpenSearch: () => setSearchModalOpen(true),
    onOpenSettings: () => setSettingsOpen(true),
    onNewConversation: createGlobalConversation,
    onSelectPrimaryDestination: selectPrimaryDestination,
  });

  // Observation seam for plugins: book open/close, chapter, progress.
  const openedBookRef = useRef<{
    id: string;
    title: string;
    author?: string;
  } | null>(null);
  useEffect(() => {
    const book = reader.selectedBook;
    if (book && openedBookRef.current?.id !== book.id) {
      if (openedBookRef.current) {
        emitAppEvent("book-closed", { bookId: openedBookRef.current.id });
      }
      openedBookRef.current = {
        id: book.id,
        title: book.title,
        author: book.author,
      };
      emitAppEvent("book-opened", { book: openedBookRef.current });
    } else if (!book && openedBookRef.current) {
      emitAppEvent("book-closed", { bookId: openedBookRef.current.id });
      openedBookRef.current = null;
    }
  }, [reader.selectedBook]);
  useEffect(() => {
    if (!openedBookRef.current) return;
    emitAppEvent("chapter-changed", {
      bookId: openedBookRef.current.id,
      chapterHref: reader.currentChapterHref,
    });
  }, [reader.currentChapterHref]);
  useEffect(() => {
    if (!openedBookRef.current || reader.readerProgress == null) return;
    emitAppEvent("reading-progress", {
      bookId: openedBookRef.current.id,
      fraction: reader.readerProgress,
    });
  }, [reader.readerProgress]);

  useEffect(() => {
    void softwareUpdate.loadCurrentVersion();
  }, [softwareUpdate.loadCurrentVersion]);

  useEffect(() => {
    if (generalSettings.autoUpdate) void softwareUpdate.checkForUpdates();
  }, [generalSettings.autoUpdate, softwareUpdate.checkForUpdates]);

  // While the shelf holds over the opening reader it must stay VISUALLY
  // frozen: opening bumps lastOpenedAt, and the recency sort would otherwise
  // jump the clicked book to the front mid-handoff. Snapshot the books at
  // click time and render the held shelf from the snapshot; the live order
  // returns once the handoff ends (so closing shows the final order at once).
  const [heldShelfBooks, setHeldShelfBooks] = useState<LibraryBook[] | null>(
    null,
  );
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

  const contextHeaderActions = useContextHeaderActions({
    books: library.books,
    onOpenBook: handleOpenBook,
    onNewConversation: createGlobalConversation,
  });

  // Chat book cards → open the reader (the cards dispatch via an atom).
  useOpenBookRequestHandler(
    library.books,
    handleOpenBook,
    reader.selectedBook?.id ?? null,
  );

  // Plugin goTo requests: open the target book first when needed, then hand
  // the location to the reader session's navigation channels.
  const pluginNav = useAtomValue(pluginReaderNavAtom);
  const handledPluginNavRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pluginNav || handledPluginNavRef.current === pluginNav.id) return;
    const targetBookId = pluginNav.bookId ?? reader.selectedBook?.id;
    if (!targetBookId) {
      handledPluginNavRef.current = pluginNav.id;
      return;
    }
    if (reader.selectedBook?.id !== targetBookId) {
      const book = library.books.find((entry) => entry.id === targetBookId);
      if (!book) {
        handledPluginNavRef.current = pluginNav.id;
        return;
      }
      handleOpenBook(book);
      return; // Re-runs once the book is open, then navigates.
    }
    handledPluginNavRef.current = pluginNav.id;
    if (pluginNav.cfi) reader.handleAnnotationSelect(pluginNav.cfi);
    else if (pluginNav.href) reader.handleChapterSelect(pluginNav.href);
  }, [pluginNav, reader, library.books, handleOpenBook]);

  // Spinner feedback on the clicked cover while the shelf holds.
  const openingBookId =
    shelfHandoff !== "idle" ? (reader.selectedBook?.id ?? null) : null;

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

  const openAppSurface = useCallback(
    (surface: TopNav) => {
      setActiveTopNav(surface);
      if (reader.selectedBook) closeBook();
    },
    [closeBook, reader.selectedBook, setActiveTopNav],
  );

  const pluginCommandItems = usePluginCommandItems(
    useCallback(
      (key: string) => openAppSurface(`plugin:${key}`),
      [openAppSurface],
    ),
  );

  const handleCommandOpenBook = useCallback(
    (book: LibraryBook) => {
      if (
        reader.selectedBook &&
        !readerExiting &&
        shelfHandoff === "idle"
      ) {
        if (reader.selectedBook.id !== book.id) reader.openReader(book);
        return;
      }
      handleOpenBook(book);
    },
    [
      handleOpenBook,
      reader.openReader,
      reader.selectedBook,
      readerExiting,
      shelfHandoff,
    ],
  );

  // OS-level entry points into the import pipeline: file associations
  // (double-click / "open with" → import, then straight into the reader) and
  // window-wide drag-and-drop (import only; the shelf shows the result).
  useExternalBookOpens({
    enabled: library.libraryReady,
    importSources: library.importSources,
    openBook: handleCommandOpenBook,
    reportError: library.reportError,
  });
  const dropImportActive = useDropBookImport(library.importSources);

  const commandContext: CommandContext = {
    activeTopNav,
    readingBookId: reader.selectedBook?.id ?? null,
    shelfView,
    collections: library.collections,
    books: library.books,
    openBook: handleCommandOpenBook,
    openCollection: (id) => {
      setActiveCollectionId(id);
      openAppSurface("shelf");
    },
    goShelf: () => {
      setActiveCollectionId(null);
      openAppSurface("shelf");
    },
    goContext: () => openAppSurface("context"),
    goStats: () => openAppSurface("stats"),
    openSettings: () => setSettingsOpen(true),
    importBook: () => {
      openAppSurface("shelf");
      library.openImportPicker();
    },
    startSelection: () => {
      setActiveCollectionId(null);
      setShelfSelection({ active: true, ids: [] });
      openAppSurface("shelf");
    },
    setLayout: (layout) => {
      setShelfView({ ...shelfView, layout });
      openAppSurface("shelf");
    },
    setSort: (sort) => {
      setShelfView({ ...shelfView, sort });
      openAppSurface("shelf");
    },
    setGroup: (group) => {
      setShelfView({ ...shelfView, group });
      openAppSurface("shelf");
    },
  };

  return (
    <>
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
              fractionNavigationRequest={reader.fractionNavigationRequest}
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
              onReaderFractionChange={reader.handleReaderFractionChange}
              onSeek={reader.handleSeek}
              onTocChange={reader.setReaderToc}
              onCurrentChapterChange={reader.setCurrentChapterHref}
              onBookReady={library.handleBookReady}
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
          <AppHeader
            activeTopNav={activeTopNav}
            isImporting={library.isImporting}
            onImport={library.openImportPicker}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenSearch={() => setSearchModalOpen(true)}
            onTopNavChange={setActiveTopNav}
            leadingStatus={
              <>
                <SyncIndicator />
                <UpdateIndicator />
                <WhatsNewNotice />
              </>
            }
            viewControl={
              activeTopNav === "shelf" ? <ShelfManagementMenu /> : undefined
            }
            actions={
              activeTopNav === "context" ? contextHeaderActions : undefined
            }
          />

          <ScrollArea className="h-full min-h-0 flex-1">
            {activeTopNav === "shelf" ? (
              <LibraryWorkspace
                isReady={library.libraryReady}
                books={heldShelfBooks ?? library.books}
                pendingBooks={heldShelfBooks ? [] : library.pendingBooks}
                collections={library.collections}
                openingBookId={openingBookId}
                importingCount={library.importingCount}
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
            ) : activeTopNav === "stats" ? (
              <Suspense fallback={<SurfaceFallback />}>
                <StatsWorkspace
                  books={library.books}
                  onOpenBook={handleOpenBook}
                />
              </Suspense>
            ) : (
              <PluginPageHost
                navKey={activeTopNav}
                onExit={() => setActiveTopNav("shelf")}
              />
            )}
          </ScrollArea>
        </main>
      )}

      <CommandPalette
        isOpen={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        ctx={commandContext}
        extraItems={pluginCommandItems}
      />

      {settingsMounted && (
        <Suspense fallback={null}>
          <SettingsDialog
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
          />
        </Suspense>
      )}

      {dropImportActive && <DropImportOverlay />}

      <PluginToastBridge />
      <PluginDialogHost />
      <PluginInstallConsentDialog />
    </>
  );
}

export default App;
