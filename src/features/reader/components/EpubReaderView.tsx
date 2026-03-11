import { useEffect, useRef, useState } from "react";
import { Body, Button } from "../../../components";
import { cn } from "../../../components/lib/cn";
import type { Book } from "../../shelf/components/BookCover";

type EpubRelocation = {
  start?: {
    cfi?: string;
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
  destroy: () => void;
};

type LoadedEpub = {
  fileName: string;
  data: ArrayBuffer;
};

type EpubFactory = (source: ArrayBuffer | string) => EpubBook;

type EpubReaderViewProps = {
  selectedBook?: Book | null;
  initialEpubUrl?: string;
};

function formatReaderError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Unable to load this EPUB file.";
}

export function EpubReaderView({
  selectedBook = null,
  initialEpubUrl,
}: EpubReaderViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<EpubRendition | null>(null);
  const lastCfiRef = useRef<string | null>(null);

  const [loadedEpub, setLoadedEpub] = useState<LoadedEpub | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      renditionRef.current?.resize();
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isReady) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void renditionRef.current?.prev();
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        void renditionRef.current?.next();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isReady]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!loadedEpub || !element) return;

    let cancelled = false;
    setIsLoading(true);
    setIsReady(false);
    setError(null);

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
          lastCfiRef.current = nextLocation.start?.cfi ?? null;
        };

        rendition.on("relocated", onRelocated);

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

  return (
    <section className="relative h-full w-full bg-paper">
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
    </section>
  );
}
