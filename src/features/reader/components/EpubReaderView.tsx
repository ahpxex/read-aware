import { useEffect, useRef, useState } from "react";
import { Body, Button } from "../../../components";
import { cn } from "../../../components/lib/cn";
import type { Book } from "../../shelf/components/BookCover";

type EpubRelocation = {
  start?: {
    cfi?: string;
  };
};

type EpubRenderedView = {
  element?: HTMLElement | null;
};

type EpubRendition = {
  display: (target?: string) => Promise<unknown>;
  next: () => Promise<unknown>;
  prev: () => Promise<unknown>;
  on: {
    (event: "relocated", listener: (location: EpubRelocation) => void): void;
    (event: "rendered", listener: (section: unknown, view: EpubRenderedView) => void): void;
  };
  off: {
    (event: "relocated", listener: (location: EpubRelocation) => void): void;
    (event: "rendered", listener: (section: unknown, view: EpubRenderedView) => void): void;
  };
  resize: () => void;
  destroy: () => void;
  themes: {
    default: (styles: Record<string, Record<string, string>>) => void;
  };
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
    const element = viewportRef.current;
    if (!loadedEpub || !element) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    let book: EpubBook | null = null;
    let rendition: EpubRendition | null = null;
    let onRelocated: ((location: EpubRelocation) => void) | null = null;
    let onRendered: ((section: unknown, view: EpubRenderedView) => void) | null = null;

    void (async () => {
      try {
        const epubModule = await import("epubjs");
        if (cancelled) return;

        const createBook = epubModule.default as unknown as EpubFactory;
        book = createBook(loadedEpub.data);
        rendition = book.renderTo(element, {
          width: "100%",
          height: "100%",
          flow: "scrolled-continuous",
          manager: "continuous",
          spread: "none",
          fullsize: true,
        });
        renditionRef.current = rendition;

        rendition.themes.default({
          body: {
            margin: "0 auto",
            "max-width": "42rem",
            padding: "4rem 2rem 6rem 2rem",
            color: "#292524",
            "font-family":
              "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            "font-size": "1.0625rem",
            "line-height": "1.9",
            "background-color": "#f5f1e8",
          },
          p: {
            margin: "0 0 1.2rem 0",
          },
          h1: {
            "font-size": "2.25rem",
            "line-height": "1.05",
            "margin-bottom": "1.5rem",
          },
          h2: {
            "font-size": "1.75rem",
            "line-height": "1.1",
            "margin-top": "3rem",
            "margin-bottom": "1.25rem",
          },
          h3: {
            "font-size": "1.375rem",
            "line-height": "1.2",
            "margin-top": "2.5rem",
            "margin-bottom": "1rem",
          },
          img: {
            display: "block",
            margin: "2rem auto",
            "max-width": "100%",
            height: "auto",
          },
          blockquote: {
            margin: "2rem 0",
            padding: "0 0 0 1.25rem",
            "border-left": "1px solid rgba(28,25,23,0.18)",
          },
        });

        onRelocated = (nextLocation: EpubRelocation) => {
          if (cancelled) return;
          lastCfiRef.current = nextLocation.start?.cfi ?? null;
        };

        onRendered = (_section, view) => {
          const viewElement = view.element;
          if (!viewElement) return;

          viewElement.style.paddingBottom = "5rem";
          viewElement.style.borderBottom = "1px solid rgba(28, 25, 23, 0.08)";
        };

        rendition.on("relocated", onRelocated);
        rendition.on("rendered", onRendered);

        await book.ready;
        if (cancelled) return;

        await rendition.display(lastCfiRef.current ?? undefined);
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
      if (rendition && onRendered) {
        rendition.off("rendered", onRendered);
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
