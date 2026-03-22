import type { BookFormat } from "./library-types";

const EPUB_COVER_ERROR_PREFIX = "Unable to extract EPUB cover";
const PDF_COVER_ERROR_PREFIX = "Unable to render PDF cover";
const PDF_COVER_TARGET_WIDTH = 320;
const PDF_COVER_QUALITY = 0.86;

type EpubBookLike = {
  ready: Promise<unknown>;
  coverUrl: () => Promise<string | null>;
  destroy: () => void;
};

type PdfPageViewport = {
  width: number;
  height: number;
};

type PdfPageLike = {
  getViewport: (options: { scale: number }) => PdfPageViewport;
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfPageViewport;
  }) => { promise: Promise<unknown> };
  cleanup?: () => void;
};

type PdfDocumentLike = {
  getPage: (pageNumber: number) => Promise<PdfPageLike>;
  destroy?: () => Promise<void> | void;
};

type PdfLoadingTaskLike = {
  promise: Promise<PdfDocumentLike>;
};

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Unable to read extracted cover data."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read extracted cover data."));
    reader.readAsDataURL(blob);
  });
}

function revokeObjectUrl(url: string | null) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

async function extractEpubCover(file: Blob) {
  const epubModule = await import("epubjs");
  const createBook = epubModule.default as unknown as (input: ArrayBuffer) => EpubBookLike;
  const book = createBook(await file.arrayBuffer());
  let coverUrl: string | null = null;

  try {
    await book.ready;
    coverUrl = await book.coverUrl();
    if (!coverUrl) return null;

    const response = await fetch(coverUrl);
    if (!response.ok) {
      throw new Error(`${EPUB_COVER_ERROR_PREFIX}: ${response.status}`);
    }

    return blobToDataUrl(await response.blob());
  } finally {
    revokeObjectUrl(coverUrl);
    book.destroy();
  }
}

async function extractPdfCover(file: Blob) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;

  const loadingTask = pdfjs.getDocument({
    data: await file.arrayBuffer(),
  }) as unknown as PdfLoadingTaskLike;
  let pdfDocument: PdfDocumentLike | null = null;

  try {
    pdfDocument = await loadingTask.promise;
    const page = await pdfDocument.getPage(1);

    try {
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = PDF_COVER_TARGET_WIDTH / Math.max(baseViewport.width, 1);
      const viewport = page.getViewport({
        scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));

      const context = canvas.getContext("2d", { alpha: false });
      if (!context) {
        throw new Error(`${PDF_COVER_ERROR_PREFIX}: canvas context unavailable`);
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;

      return canvas.toDataURL("image/jpeg", PDF_COVER_QUALITY);
    } finally {
      page.cleanup?.();
    }
  } finally {
    await pdfDocument?.destroy?.();
  }
}

export async function extractBookCover(file: Blob, format: BookFormat) {
  try {
    if (format === "epub") {
      return await extractEpubCover(file);
    }

    if (format === "pdf") {
      return await extractPdfCover(file);
    }

    return null;
  } catch (error) {
    const prefix = format === "epub" ? EPUB_COVER_ERROR_PREFIX : PDF_COVER_ERROR_PREFIX;
    console.warn(prefix, error);
    return null;
  }
}
