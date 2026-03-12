import { useCallback, useEffect, useRef, useState } from "react";
import { Body, Button, Heading, ScrollArea, Sidebar } from "../../../components";
import { cn } from "../../../components/lib/cn";
import { useLocalAtom } from "../../../state/local";
import type { Book } from "../../shelf/components/BookCover";
import { formatReaderError } from "../lib/format-reader-error";
import {
  getNormalizedSelectionText,
  getSelectionOverlayRects,
  type SelectionOverlayRect,
} from "../lib/selection-overlay";
import {
  normalizeHref,
  flattenToc,
  filterValidTocEntries,
  resolveInitialDisplayTarget,
  findTocIndexForHref,
  getTocEntryForSpineIndex,
  hrefMatches,
} from "../lib/epub-utils";
import type {
  EpubBook,
  EpubFactory,
  EpubRelocation,
  EpubRendition,
  LoadedEpub,
  TocEntry,
  SpineEntry,
  EpubContents,
} from "../lib/epub-types";
import {
  ReaderSelectionOverlay,
  type ReaderSelectionState,
} from "./ReaderSelectionOverlay";

type EpubReaderViewProps = {
  selectedBook?: Book | null;
  initialEpubUrl?: string;
  onContentClick?: () => void;
  onContentScroll?: () => void;
  onPageChange?: (current: number, total: number) => void;
  onTocChange?: (entries: TocEntry[]) => void;
  onCurrentChapterChange?: (href: string | null) => void;
  chapterNavigationRequest?: {
    href: string;
    requestId: number;
  } | null;
};

const SELECTION_CLICK_SUPPRESSION_MS = 180;

function clampRectToViewport(
  rect: SelectionOverlayRect,
  frameRect: DOMRect,
  viewportRect: DOMRect,
): SelectionOverlayRect | null {
  const left = frameRect.left + rect.left - viewportRect.left;
  const top = frameRect.top + rect.top - viewportRect.top;
  const right = frameRect.left + rect.left + rect.width - viewportRect.left;
  const bottom = frameRect.top + rect.top + rect.height - viewportRect.top;

  const clippedLeft = Math.max(0, left);
  const clippedTop = Math.max(0, top);
  const clippedRight = Math.min(viewportRect.width, right);
  const clippedBottom = Math.min(viewportRect.height, bottom);
  const width = clippedRight - clippedLeft;
  const height = clippedBottom - clippedTop;

  if (width <= 0 || height <= 0) return null;

  return {
    left: clippedLeft,
    top: clippedTop,
    width,
    height,
  };
}

export function EpubReaderView({
  selectedBook = null,
  initialEpubUrl,
  onContentClick,
  onContentScroll,
  onPageChange,
  onTocChange,
  onCurrentChapterChange,
  chapterNavigationRequest = null,
}: EpubReaderViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const readerRootRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<EpubRendition | null>(null);
  const lastCfiRef = useRef<string | null>(null);
  const loadedEpubRef = useRef<LoadedEpub | null>(null);
  const tocEntriesRef = useRef<TocEntry[]>([]);
  const currentChapterHrefRef = useRef<string | null>(null);
  const selectionRef = useRef<ReaderSelectionState | null>(null);
  const isPointerSelectingRef = useRef(false);
  const suppressContentClickRef = useRef(false);
  const suppressContentClickTimeoutRef = useRef<number | null>(null);

  const onContentClickRef = useRef(onContentClick);
  useEffect(() => {
    onContentClickRef.current = onContentClick;
  }, [onContentClick]);

  const onContentScrollRef = useRef(onContentScroll);
  useEffect(() => {
    onContentScrollRef.current = onContentScroll;
  }, [onContentScroll]);

  const onPageChangeRef = useRef(onPageChange);
  useEffect(() => {
    onPageChangeRef.current = onPageChange;
  }, [onPageChange]);

  const onTocChangeRef = useRef(onTocChange);
  useEffect(() => {
    onTocChangeRef.current = onTocChange;
  }, [onTocChange]);

  const onCurrentChapterChangeRef = useRef(onCurrentChapterChange);
  useEffect(() => {
    onCurrentChapterChangeRef.current = onCurrentChapterChange;
  }, [onCurrentChapterChange]);

  const [loadedEpub, setLoadedEpub] = useLocalAtom<LoadedEpub | null>(null);
  const [isLoading, setIsLoading] = useLocalAtom(false);
  const [error, setError] = useLocalAtom<string | null>(null);
  const [tocEntries, setTocEntries] = useLocalAtom<TocEntry[]>([]);
  const [currentChapterHref, setCurrentChapterHref] = useLocalAtom<string | null>(null);
  const [isChapterPickerOpen, setIsChapterPickerOpen] = useLocalAtom(false);
  const [, setCurrentPage] = useLocalAtom(0);
  const [, setTotalPages] = useLocalAtom(0);
  const [selection, setSelection] = useState<ReaderSelectionState | null>(null);

  const clearSelection = useCallback(() => {
    selectionRef.current = null;
    isPointerSelectingRef.current = false;
    suppressContentClickRef.current = false;
    if (suppressContentClickTimeoutRef.current != null) {
      window.clearTimeout(suppressContentClickTimeoutRef.current);
      suppressContentClickTimeoutRef.current = null;
    }
    setSelection(null);
  }, []);

  const armContentClickSuppression = useCallback(() => {
    suppressContentClickRef.current = true;
    if (suppressContentClickTimeoutRef.current != null) {
      window.clearTimeout(suppressContentClickTimeoutRef.current);
    }
    suppressContentClickTimeoutRef.current = window.setTimeout(() => {
      suppressContentClickRef.current = false;
      suppressContentClickTimeoutRef.current = null;
    }, SELECTION_CLICK_SUPPRESSION_MS);
  }, []);

  const captureSelection = useCallback((
    contents: EpubContents,
    cfiRange: string | null,
    { suppressContentClick = false }: { suppressContentClick?: boolean } = {},
  ) => {
    const readerRoot = readerRootRef.current;
    const selectionInContents = contents.window.getSelection();
    const frameElement = contents.window.frameElement;
    if (!readerRoot || !(frameElement instanceof HTMLElement) || !selectionInContents) {
      clearSelection();
      return false;
    }

    const text = getNormalizedSelectionText(selectionInContents);
    if (!text || selectionInContents.rangeCount === 0) {
      clearSelection();
      return false;
    }

    const range = selectionInContents.getRangeAt(0);
    if (range.collapsed) {
      clearSelection();
      return false;
    }

    const viewportRect = readerRoot.getBoundingClientRect();
    const frameRect = frameElement.getBoundingClientRect();
    const rects = getSelectionOverlayRects(range)
      .map((rect) => clampRectToViewport(rect, frameRect, viewportRect))
      .filter((rect): rect is SelectionOverlayRect => rect != null);

    if (rects.length === 0) {
      clearSelection();
      return false;
    }

    const nextSelection: ReaderSelectionState = {
      anchorRect: rects[rects.length - 1] ?? null,
      cfiRange: cfiRange ?? contents.cfiFromRange(range),
      chapterHref: currentChapterHrefRef.current,
      rects,
      text,
    };

    selectionRef.current = nextSelection;
    setSelection(nextSelection);
    if (suppressContentClick) {
      armContentClickSuppression();
    }

    return true;
  }, [armContentClickSuppression, clearSelection]);

  useEffect(() => {
    loadedEpubRef.current = loadedEpub;
  }, [loadedEpub]);

  useEffect(() => {
    tocEntriesRef.current = tocEntries;
  }, [tocEntries]);

  useEffect(() => {
    onTocChangeRef.current?.(tocEntries);
  }, [tocEntries]);

  useEffect(() => {
    currentChapterHrefRef.current = currentChapterHref;
  }, [currentChapterHref]);

  useEffect(() => {
    onCurrentChapterChangeRef.current?.(currentChapterHref);
  }, [currentChapterHref]);

  useEffect(() => {
    return () => {
      if (suppressContentClickTimeoutRef.current != null) {
        window.clearTimeout(suppressContentClickTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!initialEpubUrl) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(initialEpubUrl);
        if (!response.ok) {
          throw new Error(`Unable to fetch EPUB (${response.status})`);
        }

        const data = await response.arrayBuffer();
        if (cancelled) return;

        const fileName = initialEpubUrl.split("/").pop() ?? "demo.epub";
        setLoadedEpub({ fileName, data });
      } catch (nextError) {
        if (!cancelled) {
          setError(formatReaderError(nextError));
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialEpubUrl]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const observer = new ResizeObserver(() => {
      clearSelection();
      renditionRef.current?.resize();
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [clearSelection]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    function handleScroll() {
      clearSelection();
      onContentScrollRef.current?.();
    }

    element.addEventListener("scroll", handleScroll, true);
    return () => element.removeEventListener("scroll", handleScroll, true);
  }, [clearSelection]);

  useEffect(() => {
    window.addEventListener("keydown", handleReaderKeyDown);
    return () => window.removeEventListener("keydown", handleReaderKeyDown);
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!loadedEpub || !element) return;

    let cancelled = false;
    clearSelection();
    setIsLoading(true);
    setError(null);
    setTocEntries([]);
    setCurrentChapterHref(null);
    setCurrentPage(0);
    setTotalPages(0);

    let book: EpubBook | null = null;
    let rendition: EpubRendition | null = null;
    let onRelocated: ((location: EpubRelocation) => void) | null = null;
    let onSelected: ((cfiRange: string, contents: EpubContents) => void) | null = null;

    void (async () => {
      try {
        const epubModule = await import("epubjs");
        if (cancelled) return;

        const createBook = epubModule.default as unknown as EpubFactory;
        book = createBook(loadedEpub.data);
        rendition = book.renderTo(element, {
          width: "100%",
          height: "100%",
          flow: "scrolled-doc",
          manager: "continuous",
          spread: "none",
          allowScriptedContent: true,
        });
        renditionRef.current = rendition;

        await book.ready;
        if (cancelled) return;

        const spineEntries: SpineEntry[] = [];
        book.spine.each((section) => {
          spineEntries.push({ href: section.href, index: section.index });
        });
        if (!cancelled) {
          setTotalPages(spineEntries.length);
        }
        const navigation = await book.loaded.navigation;
        const flattenedToc = filterValidTocEntries(
          flattenToc(navigation.toc ?? []),
          spineEntries,
        );
        if (!cancelled) {
          setTocEntries(flattenedToc);
        }

        rendition.hooks.content.register((contents) => {
          contents.document.addEventListener("keydown", handleReaderKeyDown);
          contents.document.addEventListener("selectionchange", () => {
            if (!isPointerSelectingRef.current) return;
            captureSelection(contents, null);
          });
          contents.document.addEventListener("pointerdown", () => {
            suppressContentClickRef.current = false;
            if (selectionRef.current) {
              clearSelection();
            }
            isPointerSelectingRef.current = true;
          }, true);
          contents.document.addEventListener("pointerup", () => {
            isPointerSelectingRef.current = false;
          }, true);
          contents.document.addEventListener("pointercancel", () => {
            isPointerSelectingRef.current = false;
          }, true);

          contents.document.addEventListener("click", () => {
            if (suppressContentClickRef.current) {
              suppressContentClickRef.current = false;
              return;
            }

            if (selectionRef.current) {
              clearSelection();
              return;
            }

            onContentClickRef.current?.();
          }, true);

          return contents.addStylesheetCss(
            `
              html {
                background: #f5f1e8 !important;
              }

              body {
                box-sizing: border-box !important;
                width: min(100%, 56rem) !important;
                max-width: 56rem !important;
                margin: 0 auto !important;
                padding: 2rem 1.5rem 4rem !important;
                color: #292524 !important;
                background: #f5f1e8 !important;
                font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
                font-size: 1.0625rem !important;
                line-height: 1.9 !important;
              }

              body > * {
                max-width: 100% !important;
              }

              p,
              ul,
              ol,
              blockquote {
                margin: 0 0 1.25rem 0 !important;
              }

              h1 {
                margin: 0 0 1.5rem 0 !important;
                font-size: 2.25rem !important;
                line-height: 1.05 !important;
              }

              h2 {
                margin: 2.75rem 0 1.25rem 0 !important;
                font-size: 1.75rem !important;
                line-height: 1.12 !important;
              }

              h3 {
                margin: 2.25rem 0 1rem 0 !important;
                font-size: 1.375rem !important;
                line-height: 1.18 !important;
              }

              img,
              svg,
              video,
              canvas {
                display: block !important;
                width: auto !important;
                max-width: min(100%, 32rem) !important;
                height: auto !important;
                margin: 1.75rem auto !important;
              }

              figure {
                margin: 2rem auto !important;
                max-width: min(100%, 32rem) !important;
              }

              blockquote {
                padding-left: 1.25rem !important;
                border-left: 1px solid rgba(28, 25, 23, 0.18) !important;
              }
            `,
            "read-aware-reader-base",
          );
        });

        onSelected = (cfiRange, contents) => {
          const didCaptureSelection = captureSelection(contents, cfiRange, {
            suppressContentClick: true,
          });
          isPointerSelectingRef.current = false;
          try {
            contents.window.getSelection()?.removeAllRanges();
          } catch {
            // Some webviews can reject selection mutation during teardown.
          }

          if (!didCaptureSelection) {
            clearSelection();
          }
        };

        rendition.on("selected", onSelected);

        onRelocated = (nextLocation: EpubRelocation) => {
          if (cancelled) return;
          clearSelection();
          lastCfiRef.current = nextLocation.start?.cfi ?? null;
          const relocatedHref = nextLocation.start?.href ?? null;
          const relocatedSpineIndex = spineEntries.find((entry) =>
            hrefMatches(entry.href, relocatedHref ?? ""),
          )?.index;
          const enclosingEntry =
            typeof relocatedSpineIndex === "number"
              ? getTocEntryForSpineIndex(flattenedToc, relocatedSpineIndex)
              : null;
          const tocIndex = findTocIndexForHref(flattenedToc, relocatedHref);
          if (typeof relocatedSpineIndex === "number") {
            const page = relocatedSpineIndex + 1;
            setCurrentPage(page);
            onPageChangeRef.current?.(page, spineEntries.length);
          }
          setCurrentChapterHref(
            enclosingEntry?.href ??
              (tocIndex >= 0 ? flattenedToc[tocIndex].href : relocatedHref),
          );
        };

        rendition.on("relocated", onRelocated);

        const initialTarget =
          lastCfiRef.current ??
          resolveInitialDisplayTarget(flattenedToc, spineEntries) ??
          spineEntries[0]?.href;
        await rendition.display(initialTarget);
      } catch (nextError) {
        if (!cancelled) {
          setError(formatReaderError(nextError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (rendition && onRelocated) {
        rendition.off("relocated", onRelocated);
      }
      if (rendition && onSelected) {
        rendition.off("selected", onSelected);
      }
      rendition?.destroy();
      book?.destroy();
      if (renditionRef.current === rendition) {
        renditionRef.current = null;
      }
    };
  }, [captureSelection, clearSelection, loadedEpub]);

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    try {
      setError(null);
      const data = await file.arrayBuffer();
      setLoadedEpub({ fileName: file.name, data });
    } catch (nextError) {
      setError(formatReaderError(nextError));
    } finally {
      event.currentTarget.value = "";
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function goToChapter(href: string) {
    if (!renditionRef.current) return;

    try {
      setError(null);
      clearSelection();
      await renditionRef.current.display(href);
      setIsChapterPickerOpen(false);
    } catch (nextError) {
      setError(formatReaderError(nextError));
    }
  }

  useEffect(() => {
    if (!chapterNavigationRequest?.href) return;
    void goToChapter(chapterNavigationRequest.href);
  }, [chapterNavigationRequest?.href, chapterNavigationRequest?.requestId]);

  async function goToAdjacentChapter(direction: -1 | 1) {
    if (!tocEntriesRef.current.length) return;

    const currentIndex = findTocIndexForHref(
      tocEntriesRef.current,
      currentChapterHrefRef.current,
    );
    if (currentIndex < 0) {
      const fallbackEntry =
        direction === 1
          ? tocEntriesRef.current[0]
          : tocEntriesRef.current[tocEntriesRef.current.length - 1];
      if (!fallbackEntry) return;
      await goToChapter(fallbackEntry.href);
      return;
    }

    const nextIndex = currentIndex + direction;
    const nextEntry = tocEntriesRef.current[nextIndex];
    if (!nextEntry) return;

    await goToChapter(nextEntry.href);
  }

  function shouldIgnoreHotkeyTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;

    if (target.isContentEditable) return true;

    return !!target.closest("input, textarea, select, [contenteditable='true']");
  }

  function handleReaderKeyDown(event: KeyboardEvent) {
    if (!loadedEpubRef.current) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (shouldIgnoreHotkeyTarget(event.target)) return;

    if (event.key.toLowerCase() === "c") {
      event.preventDefault();
      setIsChapterPickerOpen((open) => !open);
    }

    if (event.key === "Escape") {
      clearSelection();
      setIsChapterPickerOpen(false);
    }

    if (event.key === "[" || event.code === "BracketLeft") {
      event.preventDefault();
      void goToAdjacentChapter(-1);
    }

    if (event.key === "]" || event.code === "BracketRight") {
      event.preventDefault();
      void goToAdjacentChapter(1);
    }
  }

  return (
    <section ref={readerRootRef} className="relative h-full w-full overflow-hidden bg-paper">
      <input
        ref={fileInputRef}
        type="file"
        accept=".epub,application/epub+zip"
        className="hidden"
        onChange={(event) => {
          void handleFileSelected(event);
        }}
      />

      <div
        ref={viewportRef}
        aria-label={selectedBook?.title ?? loadedEpub?.fileName ?? "EPUB reader"}
        className={cn(
          "h-full w-full",
          (!loadedEpub || isLoading || !!error) && "opacity-0",
        )}
      />
      <ReaderSelectionOverlay selection={selection} />

      {!loadedEpub && !isLoading && !error && (
        <button
          type="button"
          onClick={openFilePicker}
          className="absolute inset-0 flex items-center justify-center bg-paper px-8 text-center transition-colors hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950"
        >
          <div className="flex flex-col items-center gap-4">
            <span className="inline-flex h-8 items-center justify-center border border-stone-300 px-4 font-sans text-sm font-medium text-stone-950">
              Open EPUB
            </span>
            <Body className="max-w-sm text-sm text-stone-600">
              {selectedBook
                ? `Choose an EPUB file for ${selectedBook.title}.`
                : "Choose an EPUB file to start reading."}
            </Body>
          </div>
        </button>
      )}

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-paper">
          <Body className="text-sm text-stone-600">
            Opening {loadedEpub?.fileName ?? "EPUB"}...
          </Body>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-paper px-8 text-center">
          <div className="flex max-w-md flex-col items-center gap-4">
            <Body className="text-sm text-red-800">{error}</Body>
            <Button variant="outline" size="sm" onClick={openFilePicker}>
              Choose another EPUB
            </Button>
          </div>
        </div>
      )}

      <Sidebar
        side="right"
        open={isChapterPickerOpen}
        onClose={() => setIsChapterPickerOpen(false)}
        label="Chapters"
        width="w-80"
      >
        <div className="flex h-full flex-col gap-4 p-6">
          <Heading as="h2" size="xl">
            Chapters
          </Heading>
          <Body className="text-sm text-stone-600">
            Press `[` or `]` to move between chapters, or pick one below.
          </Body>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-1 pr-2">
              {tocEntries.length === 0 ? (
                <Body className="text-sm text-stone-600">
                  No chapter list is available for this EPUB.
                </Body>
              ) : (
                tocEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      void goToChapter(entry.href);
                    }}
                    className={cn(
                      "w-full text-left font-sans text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950",
                      normalizeHref(entry.href) === normalizeHref(currentChapterHref ?? "")
                        ? "text-stone-950"
                        : "text-stone-600 hover:text-stone-950",
                      entry.depth === 1 && "pl-4",
                      entry.depth >= 2 && "pl-8",
                    )}
                  >
                    {entry.label}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </Sidebar>
    </section>
  );
}
