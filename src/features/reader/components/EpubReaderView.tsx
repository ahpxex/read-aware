import { useEffect, useRef, useState } from "react";
import { Body, Button, Divider, Eyebrow, Heading } from "../../../components";
import { cn } from "../../../components/lib/cn";
import type { Book } from "../../shelf/components/BookCover";

type EpubNavigationItem = {
  id?: string;
  href?: string;
  label?: string;
  subitems?: EpubNavigationItem[];
};

type EpubNavigation = {
  toc?: EpubNavigationItem[];
};

type EpubRelocation = {
  start?: {
    cfi?: string;
    href?: string;
    percentage?: number;
    displayed?: {
      page?: number;
      total?: number;
    };
  };
  end?: {
    percentage?: number;
  };
};

type EpubRendition = {
  display: (target?: string) => Promise<unknown>;
  next: () => Promise<unknown>;
  prev: () => Promise<unknown>;
  on: (event: "relocated", listener: (location: EpubRelocation) => void) => void;
  off: (event: "relocated", listener: (location: EpubRelocation) => void) => void;
  resize: () => void;
  destroy: () => void;
};

type EpubBook = {
  renderTo: (element: HTMLElement, options: Record<string, unknown>) => EpubRendition;
  ready: Promise<unknown>;
  loaded: {
    navigation: Promise<EpubNavigation>;
  };
  destroy: () => void;
};

type TocEntry = {
  id: string;
  href: string;
  label: string;
  depth: number;
};

type ReaderLocation = {
  cfi: string | null;
  href: string | null;
  page: number | null;
  total: number | null;
  progress: number | null;
};

type LoadedEpub = {
  fileName: string;
  data: ArrayBuffer;
};

type EpubFactory = (source: ArrayBuffer | string) => EpubBook;

const INITIAL_LOCATION: ReaderLocation = {
  cfi: null,
  href: null,
  page: null,
  total: null,
  progress: null,
};

function flattenToc(items: EpubNavigationItem[], depth = 0): TocEntry[] {
  const flattened: TocEntry[] = [];

  for (const item of items) {
    if (item.href) {
      flattened.push({
        id: item.id ?? `${item.href}-${depth}`,
        href: item.href,
        label: item.label?.trim() || "Untitled section",
        depth,
      });
    }
    if (item.subitems?.length) {
      flattened.push(...flattenToc(item.subitems, depth + 1));
    }
  }

  return flattened;
}

function normalizeHref(href: string) {
  return href.split("#")[0];
}

function isTocEntryActive(currentHref: string | null, entryHref: string) {
  if (!currentHref) return false;
  return normalizeHref(currentHref) === normalizeHref(entryHref);
}

function parseRelocation(relocation: EpubRelocation): ReaderLocation {
  const start = relocation.start;
  const progressCandidate =
    typeof start?.percentage === "number"
      ? start.percentage
      : typeof relocation.end?.percentage === "number"
        ? relocation.end.percentage
        : null;

  return {
    cfi: start?.cfi ?? null,
    href: start?.href ?? null,
    page:
      typeof start?.displayed?.page === "number" ? start.displayed.page : null,
    total:
      typeof start?.displayed?.total === "number" ? start.displayed.total : null,
    progress:
      typeof progressCandidate === "number"
        ? Math.min(1, Math.max(0, progressCandidate))
        : null,
  };
}

function formatReaderError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Unable to load this EPUB file.";
}

type EpubReaderViewProps = {
  selectedBook?: Book | null;
  onBackToShelf?: () => void;
};

export function EpubReaderView({
  selectedBook = null,
  onBackToShelf,
}: EpubReaderViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<EpubRendition | null>(null);
  const lastCfiRef = useRef<string | null>(null);

  const [loadedEpub, setLoadedEpub] = useState<LoadedEpub | null>(null);
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [location, setLocation] = useState<ReaderLocation>(INITIAL_LOCATION);
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const observer = new ResizeObserver(() => {
      renditionRef.current?.resize();
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!loadedEpub || !element) return;

    let cancelled = false;
    setIsLoading(true);
    setIsReady(false);
    setError(null);
    setLocation(INITIAL_LOCATION);
    setTocEntries([]);

    let book: EpubBook | null = null;
    let rendition: EpubRendition | null = null;
    let onRelocated: ((location: EpubRelocation) => void) | null = null;

    void (async () => {
      try {
        const epubModule = await import("epubjs");
        if (cancelled) return;

        const createBook = epubModule.default as unknown as EpubFactory;
        book = createBook(loadedEpub.data);
        rendition = book.renderTo(element, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          manager: "default",
          spread: "auto",
        });
        renditionRef.current = rendition;

        onRelocated = (nextLocation: EpubRelocation) => {
          if (cancelled) return;
          const parsedLocation = parseRelocation(nextLocation);
          lastCfiRef.current = parsedLocation.cfi;
          setLocation(parsedLocation);
        };
        rendition.on("relocated", onRelocated);

        const navigation = await book.loaded.navigation;
        if (!cancelled) {
          setTocEntries(flattenToc(navigation.toc ?? []));
        }

        await book.ready;
        if (cancelled) return;

        await rendition.display(lastCfiRef.current ?? undefined);
        if (!cancelled) {
          setIsReady(true);
        }
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
      rendition?.destroy();
      book?.destroy();
      if (renditionRef.current === rendition) {
        renditionRef.current = null;
      }
    };
  }, [loadedEpub]);

  async function handlePrev() {
    if (!renditionRef.current) return;
    try {
      await renditionRef.current.prev();
    } catch (nextError) {
      setError(formatReaderError(nextError));
    }
  }

  async function handleNext() {
    if (!renditionRef.current) return;
    try {
      await renditionRef.current.next();
    } catch (nextError) {
      setError(formatReaderError(nextError));
    }
  }

  async function handleOpenTocItem(href: string) {
    if (!renditionRef.current) return;
    try {
      setError(null);
      await renditionRef.current.display(href);
    } catch (nextError) {
      setError(formatReaderError(nextError));
    }
  }

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

  const progressLabel =
    location.progress === null ? "—" : `${Math.round(location.progress * 100)}%`;
  const pageLabel =
    location.page !== null && location.total !== null
      ? `${location.page} / ${location.total}`
      : "—";

  return (
    <section className="mx-auto flex min-h-full max-w-screen-2xl flex-col px-6 py-8 sm:py-10">
      <div className="flex flex-wrap items-end gap-6">
        <div className="min-w-0">
          <Eyebrow>Reader</Eyebrow>
          <Heading as="h1" size="3xl" className="mt-3">
            {selectedBook?.title ?? "EPUB"}
          </Heading>
          <Body className="mt-4 max-w-2xl">
            {selectedBook
              ? `Selected from shelf: ${selectedBook.author}. Open an EPUB file for this book to start reading.`
              : "Open an EPUB file to test the first unified reader engine slice. PDF.js and secondary format conversion will be added in the next steps."}
          </Body>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {onBackToShelf && (
            <Button variant="ghost" size="sm" onClick={onBackToShelf}>
              Back to shelf
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".epub,application/epub+zip"
            className="hidden"
            onChange={(event) => {
              void handleFileSelected(event);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            Open EPUB
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void handlePrev();
            }}
            disabled={!isReady}
          >
            Previous
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void handleNext();
            }}
            disabled={!isReady}
          >
            Next
          </Button>
        </div>
      </div>

      <Divider className="mt-6" />

      <div className="mt-6 grid min-h-0 flex-1 gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="min-h-0">
          <Eyebrow>Contents</Eyebrow>
          <div className="mt-4 max-h-[62vh] space-y-1 overflow-y-auto pr-2">
            {!loadedEpub && (
              <Body className="text-sm text-stone-600">
                Select an EPUB to view its chapter list.
              </Body>
            )}

            {loadedEpub && tocEntries.length === 0 && !isLoading && (
              <Body className="text-sm text-stone-600">
                No table of contents found for this book.
              </Body>
            )}

            {tocEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  void handleOpenTocItem(entry.href);
                }}
                className={cn(
                  "w-full text-left font-sans text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950",
                  isTocEntryActive(location.href, entry.href)
                    ? "text-stone-950"
                    : "text-stone-600 hover:text-stone-950",
                  entry.depth === 1 && "pl-4",
                  entry.depth >= 2 && "pl-8",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </aside>

        <article className="flex min-h-[34rem] flex-col border border-border bg-paper">
          <header className="flex items-center gap-6 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-sans text-sm text-stone-700">
                {loadedEpub?.fileName ?? "No EPUB file loaded"}
              </p>
              {location.href && (
                <p className="truncate font-sans text-caption text-stone-600">
                  {location.href}
                </p>
              )}
            </div>
            <dl className="flex items-center gap-5">
              <div className="text-right">
                <dt className="font-sans text-eyebrow font-medium uppercase tracking-eyebrow text-stone-500">
                  Progress
                </dt>
                <dd className="font-sans text-sm text-stone-900">{progressLabel}</dd>
              </div>
              <div className="text-right">
                <dt className="font-sans text-eyebrow font-medium uppercase tracking-eyebrow text-stone-500">
                  Page
                </dt>
                <dd className="font-sans text-sm text-stone-900">{pageLabel}</dd>
              </div>
            </dl>
          </header>

          <div className="relative h-[68vh] min-h-[26rem]">
            {loadedEpub ? (
              <div
                ref={viewportRef}
                className={cn(
                  "h-full w-full",
                  (isLoading || !!error) && "opacity-0",
                )}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-8 text-center">
                <Body className="max-w-sm text-sm">
                  Open a local EPUB file to start reading.
                </Body>
              </div>
            )}

            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-paper/90">
                <Body className="text-sm text-stone-600">Loading EPUB...</Body>
              </div>
            )}

            {error && (
              <div className="absolute inset-0 flex items-center justify-center bg-paper/95 px-8 text-center">
                <Body className="max-w-md text-sm text-red-800">{error}</Body>
              </div>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
