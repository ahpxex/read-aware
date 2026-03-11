import { useEffect, useRef, useState, useCallback } from "react";
import { Body, Button, Heading, Sidebar } from "../../../components";
import { cn } from "../../../components/lib/cn";
import type { Book } from "../../shelf/components/BookCover";

type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  destroy: () => void;
};

type PdfPage = {
  getViewport: (params: { scale: number }) => PdfViewport;
  render: (params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }) => { promise: Promise<void>; cancel: () => void };
  cleanup: () => boolean;
};

type PdfViewport = {
  width: number;
  height: number;
};

type PdfLoadingTask = {
  promise: Promise<PdfDocument>;
  destroy: () => void;
};

type LoadedPdf = {
  fileName: string;
  data: ArrayBuffer;
};

type PageDimensions = {
  width: number;
  height: number;
};

type PdfReaderViewProps = {
  selectedBook?: Book | null;
  initialPdfUrl?: string;
};

const PAGE_GAP = 12;
const RENDER_BUFFER = 2;
const BASE_SCALE = 1.5;

function formatReaderError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Unable to load this PDF file.";
}

export function PdfReaderView({
  selectedBook = null,
  initialPdfUrl,
}: PdfReaderViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pdfDocRef = useRef<PdfDocument | null>(null);
  const loadingTaskRef = useRef<PdfLoadingTask | null>(null);
  const canvasMapRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const renderingPagesRef = useRef<Set<number>>(new Set());
  const renderedPagesRef = useRef<Set<number>>(new Set());
  const pageDimensionsRef = useRef<PageDimensions[]>([]);
  const pageOffsetsRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);

  const [loadedPdf, setLoadedPdf] = useState<LoadedPdf | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isPagePickerOpen, setIsPagePickerOpen] = useState(false);

  useEffect(() => {
    if (!initialPdfUrl) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(initialPdfUrl);
        if (!response.ok) {
          throw new Error(`Unable to fetch PDF (${response.status})`);
        }

        const data = await response.arrayBuffer();
        if (cancelled) return;

        const fileName = initialPdfUrl.split("/").pop() ?? "document.pdf";
        setLoadedPdf({ fileName, data });
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
  }, [initialPdfUrl]);

  const getVisiblePageRange = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !pageOffsetsRef.current.length) {
      return { first: 1, last: 1, current: 1 };
    }

    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;
    const offsets = pageOffsetsRef.current;
    const dims = pageDimensionsRef.current;

    let first = 1;
    let last = 1;
    let current = 1;
    let maxVisibleArea = 0;

    for (let i = 0; i < offsets.length; i++) {
      const pageTop = offsets[i];
      const pageBottom = pageTop + dims[i].height;

      if (pageBottom >= scrollTop && pageTop <= scrollTop + viewportHeight) {
        if (first === 1 && i + 1 > 1) first = i + 1;
        if (i === 0) first = 1;
        last = i + 1;

        const visibleTop = Math.max(scrollTop, pageTop);
        const visibleBottom = Math.min(scrollTop + viewportHeight, pageBottom);
        const visibleArea = visibleBottom - visibleTop;

        if (visibleArea > maxVisibleArea) {
          maxVisibleArea = visibleArea;
          current = i + 1;
        }
      }
    }

    return { first, last, current };
  }, []);

  const renderPage = useCallback(async (pageNum: number) => {
    const doc = pdfDocRef.current;
    if (!doc) return;
    if (renderingPagesRef.current.has(pageNum)) return;
    if (renderedPagesRef.current.has(pageNum)) return;

    renderingPagesRef.current.add(pageNum);

    try {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: BASE_SCALE });

      let canvas = canvasMapRef.current.get(pageNum);
      if (!canvas) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.scale(dpr, dpr);

      await page.render({ canvasContext: ctx, viewport }).promise;
      renderedPagesRef.current.add(pageNum);
      page.cleanup();
    } catch {
      // Page may have been cleaned up during navigation
    } finally {
      renderingPagesRef.current.delete(pageNum);
    }
  }, []);

  const updateVisiblePages = useCallback(() => {
    const { first, last, current } = getVisiblePageRange();
    setCurrentPage(current);

    const renderFirst = Math.max(1, first - RENDER_BUFFER);
    const renderLast = Math.min(numPages, last + RENDER_BUFFER);

    for (let i = renderFirst; i <= renderLast; i++) {
      void renderPage(i);
    }
  }, [getVisiblePageRange, numPages, renderPage]);

  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      updateVisiblePages();
    });
  }, [updateVisiblePages]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!loadedPdf || !container) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setNumPages(0);
    setCurrentPage(1);
    canvasMapRef.current.clear();
    renderingPagesRef.current.clear();
    renderedPagesRef.current.clear();
    pageDimensionsRef.current = [];
    pageOffsetsRef.current = [];

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (cancelled) return;

        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).href;

        const loadingTask = pdfjs.getDocument({
          data: loadedPdf.data.slice(0),
        }) as unknown as PdfLoadingTask;
        loadingTaskRef.current = loadingTask;

        const doc = await loadingTask.promise;
        if (cancelled) return;

        pdfDocRef.current = doc;
        setNumPages(doc.numPages);

        const dims: PageDimensions[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: BASE_SCALE });
          dims.push({ width: viewport.width, height: viewport.height });
          page.cleanup();
        }

        if (cancelled) return;

        const offsets: number[] = [];
        let cumulativeOffset = 0;
        for (let i = 0; i < dims.length; i++) {
          offsets.push(cumulativeOffset);
          cumulativeOffset += dims[i].height + PAGE_GAP;
        }

        pageDimensionsRef.current = dims;
        pageOffsetsRef.current = offsets;
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
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pdfDocRef.current?.destroy();
      pdfDocRef.current = null;
      loadingTaskRef.current = null;
    };
  }, [loadedPdf]);

  useEffect(() => {
    if (numPages === 0 || isLoading) return;

    const timer = requestAnimationFrame(() => {
      updateVisiblePages();
    });

    return () => cancelAnimationFrame(timer);
  }, [numPages, isLoading, updateVisiblePages]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!loadedPdf) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) return;
        if (target.closest("input, textarea, select, [contenteditable='true']"))
          return;
      }

      if (event.key.toLowerCase() === "g") {
        event.preventDefault();
        setIsPagePickerOpen((open) => !open);
      }

      if (event.key === "Escape") {
        setIsPagePickerOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loadedPdf]);

  function registerCanvas(pageNum: number, canvas: HTMLCanvasElement | null) {
    if (canvas) {
      canvasMapRef.current.set(pageNum, canvas);
    } else {
      canvasMapRef.current.delete(pageNum);
      renderedPagesRef.current.delete(pageNum);
    }
  }

  async function handleFileSelected(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    try {
      setError(null);
      const data = await file.arrayBuffer();
      setLoadedPdf({ fileName: file.name, data });
    } catch (nextError) {
      setError(formatReaderError(nextError));
    } finally {
      event.currentTarget.value = "";
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function goToPage(pageNum: number) {
    const container = scrollContainerRef.current;
    const offsets = pageOffsetsRef.current;
    if (!container || !offsets.length || pageNum < 1 || pageNum > numPages)
      return;

    container.scrollTop = offsets[pageNum - 1];
    setIsPagePickerOpen(false);
    setCurrentPage(pageNum);
  }

  const dims = pageDimensionsRef.current;

  return (
    <section className="relative h-full w-full bg-paper">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(event) => {
          void handleFileSelected(event);
        }}
      />

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        aria-label={
          selectedBook?.title ?? loadedPdf?.fileName ?? "PDF reader"
        }
        className={cn(
          "h-full w-full overflow-y-auto",
          (!loadedPdf || isLoading || !!error) && "opacity-0",
        )}
      >
        <div className="mx-auto flex flex-col items-center py-6">
          {dims.map((dim, i) => (
            <div
              key={i}
              style={{
                width: dim.width,
                height: dim.height,
                marginBottom: i < dims.length - 1 ? PAGE_GAP : 0,
              }}
              className="shrink-0 bg-white shadow-sm"
            >
              <canvas
                ref={(el) => registerCanvas(i + 1, el)}
                style={{ width: dim.width, height: dim.height }}
              />
            </div>
          ))}
        </div>
      </div>

      {!loadedPdf && !isLoading && !error && (
        <button
          type="button"
          onClick={openFilePicker}
          className="absolute inset-0 flex items-center justify-center bg-paper px-8 text-center transition-colors hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-950"
        >
          <div className="flex flex-col items-center gap-4">
            <span className="inline-flex h-8 items-center justify-center border border-stone-300 px-4 font-sans text-sm font-medium text-stone-950">
              Open PDF
            </span>
            <Body className="max-w-sm text-sm text-stone-600">
              {selectedBook
                ? `Choose a PDF file for ${selectedBook.title}.`
                : "Choose a PDF file to start reading."}
            </Body>
          </div>
        </button>
      )}

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-paper">
          <Body className="text-sm text-stone-600">
            Opening {loadedPdf?.fileName ?? "PDF"}...
          </Body>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-paper px-8 text-center">
          <div className="flex max-w-md flex-col items-center gap-4">
            <Body className="text-sm text-red-800">{error}</Body>
            <Button variant="outline" size="sm" onClick={openFilePicker}>
              Choose another PDF
            </Button>
          </div>
        </div>
      )}

      {loadedPdf && !isLoading && !error && numPages > 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
          <button
            type="button"
            onClick={() => setIsPagePickerOpen((open) => !open)}
            className="rounded-full bg-stone-900/80 px-3.5 py-1.5 font-sans text-xs text-stone-100 shadow-md backdrop-blur transition-colors hover:bg-stone-900"
          >
            {currentPage} / {numPages}
          </button>
        </div>
      )}

      <Sidebar
        side="right"
        open={isPagePickerOpen}
        onClose={() => setIsPagePickerOpen(false)}
        label="Go to page"
        width="w-64"
      >
        <div className="flex h-full flex-col gap-4 p-6">
          <Heading as="h2" size="xl">
            Go to page
          </Heading>
          <Body className="text-sm text-stone-600">
            Press `g` to toggle this panel. Enter a page number below.
          </Body>
          <PageJumpInput
            numPages={numPages}
            currentPage={currentPage}
            onJump={goToPage}
          />
        </div>
      </Sidebar>
    </section>
  );
}

function PageJumpInput({
  numPages,
  currentPage,
  onJump,
}: {
  numPages: number;
  currentPage: number;
  onJump: (page: number) => void;
}) {
  const [value, setValue] = useState(String(currentPage));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setValue(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseInt(value, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= numPages) {
      onJump(parsed);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        ref={inputRef}
        type="number"
        min={1}
        max={numPages}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full border border-stone-300 bg-white px-3 py-1.5 font-sans text-sm text-stone-950 focus:border-stone-950 focus:outline-none"
      />
      <button
        type="submit"
        className="shrink-0 border border-stone-300 px-3 py-1.5 font-sans text-sm font-medium text-stone-950 transition-colors hover:bg-stone-100"
      >
        Go
      </button>
    </form>
  );
}
