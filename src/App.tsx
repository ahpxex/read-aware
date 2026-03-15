import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAtom } from "jotai";
import { GearSix, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { useLocalAtom } from "./state/local";
import { activeTopNavAtom, settingsOpenAtom, topNavs } from "./state/ui";
import { cn } from "./components/lib/cn";
import {
  Alert,
  Body,
  Button,
  DefinitionList,
  Display,
  Divider,
  EmptyState,
  Eyebrow,
  IconButton,
  NavItem,
  ScrollArea,
  Tooltip,
} from "./components";
import { SettingsView } from "./features/settings/SettingsView";
import { Shelf } from "./features/shelf/components/Shelf";
import { EpubReaderView } from "./features/reader/components/EpubReaderView";
import { PdfReaderView } from "./features/reader/components/PdfReaderView";
import { ReaderShellOverlay } from "./features/reader/components/ReaderShellOverlay";
import type { TocEntry } from "./features/reader/lib/epub-types";
import type { LoadedEpub } from "./features/reader/lib/epub-types";
import type { LoadedPdf } from "./features/reader/lib/pdf-types";
import {
  getStoredBookBlob,
  importBookFile,
  listLibraryBooks,
  markLibraryBookOpened,
  removeLibraryBook,
  updateLibraryBookProgress,
} from "./features/library/lib/library-db";
import { deriveShelfSections } from "./features/library/lib/derive-shelf-sections";
import type {
  BookProgress,
  EpubProgress,
  LibraryBook,
  PdfProgress,
} from "./features/library/lib/library-types";

const contextCopy = {
  eyebrow: "Context",
  title: "Context stays nearby, but never louder than the text itself.",
  body: "Supporting material sits in a calm, editorial frame. The emphasis stays on comprehension, with just enough structure to orient the reader when they need it.",
  notes: [
    { label: "Placement", value: "Contextual details sit in sequence instead of competing side panels." },
    { label: "Tone", value: "The palette remains monochrome and warm, without gradients or accent glare." },
    { label: "Focus", value: "Each block is shortened to the essentials so interpretation feels effortless." },
  ],
};

type ReaderSource =
  | { format: "epub"; data: LoadedEpub }
  | { format: "pdf"; data: LoadedPdf }
  | null;

function formatAppError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Something went wrong while updating your library.";
}

function getReadingStatus(progressPercent: number) {
  if (progressPercent >= 100) return "finished";
  if (progressPercent > 0) return "reading";
  return "unread";
}

function createProgressPatch(
  book: LibraryBook,
  progress: BookProgress,
  timestamp = new Date().toISOString(),
): LibraryBook {
  const progressPercent = progress ? Math.max(0, Math.min(100, Math.round(progress.progressPercent))) : 0;

  return {
    ...book,
    progress,
    progressPercent,
    readingStatus: getReadingStatus(progressPercent),
    updatedAt: timestamp,
    lastOpenedAt: timestamp,
  };
}

function App() {
  useEffect(() => {
    if (import.meta.env.DEV) {
      void import("react-grab");
    }
  }, []);

  const [activeTopNav, setActiveTopNav] = useAtom(activeTopNavAtom);
  const [settingsOpen, setSettingsOpen] = useAtom(settingsOpenAtom);
  const [selectedBook, setSelectedBook] = useState<LibraryBook | null>(null);
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [readerSource, setReaderSource] = useState<ReaderSource>(null);
  const [readerLoadError, setReaderLoadError] = useState<string | null>(null);
  const [isReaderLoading, setIsReaderLoading] = useState(false);
  const [shellVisible, setShellVisible] = useLocalAtom(false);
  const [readerPage, setReaderPage] = useLocalAtom({ current: 0, total: 0 });
  const [readerToc, setReaderToc] = useLocalAtom<TocEntry[]>([]);
  const [currentChapterHref, setCurrentChapterHref] = useLocalAtom<string | null>(null);
  const [chapterNavigationRequest, setChapterNavigationRequest] = useLocalAtom<{
    href: string;
    requestId: number;
  } | null>(null);
  const [topNavIndicator, setTopNavIndicator] = useLocalAtom({
    x: 0,
    width: 0,
    ready: false,
  });
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const topNavListRef = useRef<HTMLDivElement | null>(null);
  const topNavButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const readerLoadRequestIdRef = useRef(0);
  const pendingProgressSaveRef = useRef<Map<string, number>>(new Map());
  const headerIconButtonClass =
    "relative text-stone-500 hover:text-stone-950 before:absolute before:-inset-1 before:content-['']";

  const shelfSections = deriveShelfSections(books);

  const replaceBookInState = useCallback((nextBook: LibraryBook) => {
    setBooks((currentBooks) => {
      const hasMatch = currentBooks.some((book) => book.id === nextBook.id);
      if (!hasMatch) return [nextBook, ...currentBooks];

      return currentBooks.map((book) => (
        book.id === nextBook.id ? nextBook : book
      ));
    });
    setSelectedBook((currentBook) => (
      currentBook?.id === nextBook.id ? nextBook : currentBook
    ));
  }, []);

  const loadLibrary = useCallback(async () => {
    try {
      setLibraryError(null);
      const nextBooks = await listLibraryBooks();
      setBooks(nextBooks);
    } catch (nextError) {
      setLibraryError(formatAppError(nextError));
    } finally {
      setLibraryReady(true);
    }
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    return () => {
      pendingProgressSaveRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      pendingProgressSaveRef.current.clear();
    };
  }, []);

  const toggleShell = useCallback(() => setShellVisible((visible) => !visible), [setShellVisible]);
  const hideShell = useCallback(() => setShellVisible(false), [setShellVisible]);

  const queueProgressSave = useCallback((bookId: string, progress: BookProgress) => {
    const existingTimeout = pendingProgressSaveRef.current.get(bookId);
    if (existingTimeout != null) {
      window.clearTimeout(existingTimeout);
    }

    const timeoutId = window.setTimeout(() => {
      pendingProgressSaveRef.current.delete(bookId);
      void updateLibraryBookProgress(bookId, progress)
        .then((nextBook) => {
          if (nextBook) {
            replaceBookInState(nextBook);
          }
        })
        .catch((nextError) => {
          setLibraryError(formatAppError(nextError));
        });
    }, 250);

    pendingProgressSaveRef.current.set(bookId, timeoutId);
  }, [replaceBookInState]);

  const applyOptimisticProgress = useCallback((bookId: string, progress: BookProgress) => {
    const timestamp = new Date().toISOString();

    setBooks((currentBooks) => currentBooks.map((book) => (
      book.id === bookId ? createProgressPatch(book, progress, timestamp) : book
    )));
    setSelectedBook((currentBook) => (
      currentBook?.id === bookId
        ? createProgressPatch(currentBook, progress, timestamp)
        : currentBook
    ));
  }, []);

  const handleEpubProgressChange = useCallback((progress: EpubProgress) => {
    setReaderPage({
      current: progress.currentLocation,
      total: progress.totalLocations,
    });

    if (!selectedBook) return;

    applyOptimisticProgress(selectedBook.id, progress);
    queueProgressSave(selectedBook.id, progress);
  }, [applyOptimisticProgress, queueProgressSave, selectedBook, setReaderPage]);

  const handlePdfProgressChange = useCallback((progress: PdfProgress) => {
    setReaderPage({
      current: progress.currentPage,
      total: progress.totalPages,
    });

    if (!selectedBook) return;

    applyOptimisticProgress(selectedBook.id, progress);
    queueProgressSave(selectedBook.id, progress);
  }, [applyOptimisticProgress, queueProgressSave, selectedBook, setReaderPage]);

  const openImportPicker = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const updateTopNavIndicator = useCallback(() => {
    const navList = topNavListRef.current;
    const activeIndex = topNavs.findIndex((item) => item === activeTopNav);
    const activeButton = topNavButtonRefs.current[activeIndex];
    if (!navList || !activeButton) return;

    const listRect = navList.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    setTopNavIndicator({
      x: buttonRect.left - listRect.left,
      width: buttonRect.width,
      ready: true,
    });
  }, [activeTopNav, setTopNavIndicator]);

  useLayoutEffect(() => {
    updateTopNavIndicator();
  }, [updateTopNavIndicator]);

  useEffect(() => {
    const navList = topNavListRef.current;
    if (!navList) return;

    const observer = new ResizeObserver(() => {
      updateTopNavIndicator();
    });
    observer.observe(navList);
    topNavButtonRefs.current.forEach((button) => {
      if (button) observer.observe(button);
    });

    window.addEventListener("resize", updateTopNavIndicator);
    return () => {
      window.removeEventListener("resize", updateTopNavIndicator);
      observer.disconnect();
    };
  }, [updateTopNavIndicator]);

  const openReader = useCallback((book: LibraryBook) => {
    const requestId = readerLoadRequestIdRef.current + 1;
    readerLoadRequestIdRef.current = requestId;

    setSelectedBook(book);
    setReaderSource(null);
    setReaderLoadError(null);
    setIsReaderLoading(true);
    setReaderPage({ current: 0, total: 0 });
    setReaderToc([]);
    setCurrentChapterHref(null);
    setChapterNavigationRequest(null);
    setShellVisible(book.format === "pdf");

    void (async () => {
      try {
        const blob = await getStoredBookBlob(book.id);
        if (!blob) {
          throw new Error("The imported file for this book could not be found on this device.");
        }

        const data = await blob.arrayBuffer();
        if (readerLoadRequestIdRef.current !== requestId) return;

        const nextSource: ReaderSource = book.format === "epub"
          ? {
              format: "epub",
              data: {
                fileName: book.fileName,
                data,
              },
            }
          : {
              format: "pdf",
              data: {
                fileName: book.fileName,
                data,
              },
            };

        setReaderSource(nextSource);
        setIsReaderLoading(false);

        void markLibraryBookOpened(book.id)
          .then((nextBook) => {
            if (nextBook) {
              replaceBookInState(nextBook);
            }
          })
          .catch((nextError) => {
            setLibraryError(formatAppError(nextError));
          });
      } catch (nextError) {
        if (readerLoadRequestIdRef.current !== requestId) return;
        setReaderLoadError(formatAppError(nextError));
        setIsReaderLoading(false);
      }
    })();
  }, [
    replaceBookInState,
    setChapterNavigationRequest,
    setCurrentChapterHref,
    setReaderPage,
    setReaderToc,
    setShellVisible,
  ]);

  const closeReader = useCallback(() => {
    readerLoadRequestIdRef.current += 1;
    setSelectedBook(null);
    setReaderSource(null);
    setReaderLoadError(null);
    setIsReaderLoading(false);
    setReaderPage({ current: 0, total: 0 });
    setShellVisible(false);
    setReaderToc([]);
    setCurrentChapterHref(null);
    setChapterNavigationRequest(null);
  }, [
    setChapterNavigationRequest,
    setCurrentChapterHref,
    setReaderPage,
    setReaderToc,
    setShellVisible,
  ]);

  const handleChapterSelect = useCallback((href: string) => {
    setChapterNavigationRequest((previous) => ({
      href,
      requestId: (previous?.requestId ?? 0) + 1,
    }));
    setShellVisible(false);
  }, [setChapterNavigationRequest, setShellVisible]);

  async function handleImportSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    if (files.length === 0) return;

    setIsImporting(true);
    setLibraryError(null);

    try {
      for (const file of files) {
        await importBookFile(file);
      }

      const nextBooks = await listLibraryBooks();
      setBooks(nextBooks);
    } catch (nextError) {
      setLibraryError(formatAppError(nextError));
    } finally {
      setIsImporting(false);
      event.currentTarget.value = "";
    }
  }

  const handleRemoveBook = useCallback((book: LibraryBook) => {
    void removeLibraryBook(book.id)
      .then(() => {
        setBooks((currentBooks) => currentBooks.filter((entry) => entry.id !== book.id));
      })
      .catch((nextError) => {
        setLibraryError(formatAppError(nextError));
      });
  }, []);

  const selectedEpubProgress = selectedBook?.progress?.format === "epub"
    ? selectedBook.progress
    : null;
  const selectedPdfProgress = selectedBook?.progress?.format === "pdf"
    ? selectedBook.progress
    : null;
  const readerProgress = readerPage.total > 0
    ? readerPage.current / readerPage.total
    : selectedBook?.progressPercent
      ? selectedBook.progressPercent / 100
      : undefined;
  const currentPosition = readerPage.total > 0
    ? `Page ${readerPage.current} of ${readerPage.total}`
    : undefined;

  if (selectedBook) {
    const overlayVisible = selectedBook.format === "pdf" ? true : shellVisible;

    return (
      <div className="relative h-screen w-full bg-paper">
        {readerSource?.format === "epub" ? (
          <EpubReaderView
            selectedBook={selectedBook}
            initialEpub={readerSource.data}
            onContentClick={toggleShell}
            onContentScroll={hideShell}
            onPageChange={(current, total) => {
              setReaderPage({ current, total });
            }}
            onProgressChange={handleEpubProgressChange}
            onTocChange={setReaderToc}
            onCurrentChapterChange={setCurrentChapterHref}
            initialProgress={selectedEpubProgress}
            chapterNavigationRequest={chapterNavigationRequest}
          />
        ) : null}

        {readerSource?.format === "pdf" ? (
          <PdfReaderView
            selectedBook={selectedBook}
            initialPdf={readerSource.data}
            initialProgress={selectedPdfProgress}
            onProgressChange={handlePdfProgressChange}
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
                  <Button size="sm" variant="outline" onClick={() => openReader(selectedBook)}>
                    Try again
                  </Button>
                  <Button size="sm" variant="ghost" onClick={closeReader}>
                    Back to library
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        <ReaderShellOverlay
          visible={!isReaderLoading && overlayVisible}
          onBack={closeReader}
          title={selectedBook.title}
          subtitle={selectedBook.author}
          progress={readerProgress}
          currentPosition={currentPosition}
          tocEntries={selectedBook.format === "epub" ? readerToc : []}
          currentChapterHref={selectedBook.format === "epub" ? currentChapterHref : null}
          onChapterSelect={selectedBook.format === "epub" ? handleChapterSelect : undefined}
        />
      </div>
    );
  }

  return (
    <main className="flex h-screen flex-col bg-[var(--ra-main-surface-color)] text-stone-950">
      <input
        ref={importInputRef}
        type="file"
        accept=".epub,.pdf,application/epub+zip,application/pdf"
        multiple
        className="hidden"
        onChange={(event) => {
          void handleImportSelection(event);
        }}
      />

      <div className="shrink-0 border-b border-border bg-[var(--ra-main-surface-color)]">
        <div className="flex items-center justify-center py-1 text-[10px] font-medium tracking-eyebrow text-stone-400">
          ReadAware
        </div>
        <header className="pt-3 pb-3 sm:pt-4 sm:pb-4">
          <nav
            aria-label="Primary"
            className="mx-auto flex max-w-screen-2xl items-center gap-6 px-6 sm:gap-8"
          >
            <div ref={topNavListRef} className="relative flex items-center gap-6 sm:gap-8">
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute -bottom-[calc(theme(spacing.4)+1px)] left-0 h-0.5 bg-stone-950 transition-[transform,width,opacity] duration-250 ease-[var(--ra-ease-out-quint)] motion-reduce:transition-none",
                  !topNavIndicator.ready && "opacity-0",
                )}
                style={{
                  width: topNavIndicator.width,
                  transform: `translateX(${topNavIndicator.x}px)`,
                }}
              />
              {topNavs.map((item, index) => (
                <NavItem
                  key={item}
                  ref={(el) => {
                    topNavButtonRefs.current[index] = el;
                  }}
                  active={item === activeTopNav}
                  onClick={() => {
                    setActiveTopNav(item);
                  }}
                >
                  {item}
                </NavItem>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-4">
              <Tooltip content="Search">
                <IconButton
                  label="Search"
                  size="sm"
                  className={headerIconButtonClass}
                  icon={<MagnifyingGlass size={14} weight="regular" aria-hidden="true" />}
                />
              </Tooltip>
              <Tooltip content={isImporting ? "Importing..." : "Import"}>
                <IconButton
                  label="Import"
                  size="sm"
                  onClick={openImportPicker}
                  disabled={isImporting}
                  className={headerIconButtonClass}
                  icon={<Plus size={14} weight="regular" aria-hidden="true" />}
                />
              </Tooltip>
              <Tooltip content="Settings">
                <IconButton
                  label="Settings"
                  size="sm"
                  onClick={() => setSettingsOpen(true)}
                  className={headerIconButtonClass}
                  icon={<GearSix size={14} weight="regular" aria-hidden="true" />}
                />
              </Tooltip>
            </div>
          </nav>
        </header>
      </div>

      <ScrollArea className="h-full min-h-0 flex-1">
        {activeTopNav === "shelf" ? (
          <div key="shelf" className="ra-motion-page-enter mx-auto max-w-screen-2xl px-6 py-8 sm:py-10">
            {libraryError && (
              <Alert variant="destructive" title="Library error" className="mb-6">
                {libraryError}
              </Alert>
            )}

            {!libraryReady ? (
              <div className="py-16">
                <Body className="text-sm text-stone-600">Loading your library...</Body>
              </div>
            ) : shelfSections.length === 0 ? (
              <EmptyState
                title="Import your first book"
                description="ReadAware now keeps imported EPUB and PDF files locally in your browser, along with your last reading position."
                action={(
                  <Button size="sm" onClick={openImportPicker}>
                    Import EPUB or PDF
                  </Button>
                )}
              />
            ) : (
              <Shelf
                sections={shelfSections}
                onSelect={openReader}
                onRemove={handleRemoveBook}
              />
            )}
          </div>
        ) : (
          <article key="context" className="ra-motion-page-enter mx-auto flex min-h-full max-w-screen-2xl flex-col justify-center px-6 py-16 sm:py-20 lg:py-24">
            <Eyebrow>{contextCopy.eyebrow}</Eyebrow>
            <Display as="h1" size="7xl" className="mt-6 max-w-4xl">
              {contextCopy.title}
            </Display>
            <Body size="lg" className="mt-8 max-w-2xl">
              {contextCopy.body}
            </Body>

            <Divider className="mt-16" />
            <DefinitionList
              items={contextCopy.notes}
              columns={3}
              className="pt-8"
            />
          </article>
        )}
      </ScrollArea>

      <SettingsView open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}

export default App;
