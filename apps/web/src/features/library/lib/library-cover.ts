const EPUB_COVER_ERROR_PREFIX = "Unable to extract EPUB cover";

type EpubBookLike = {
  ready: Promise<unknown>;
  coverUrl: () => Promise<string | null>;
  destroy: () => void;
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

export async function extractBookCover(file: Blob) {
  try {
    return await extractEpubCover(file);
  } catch (error) {
    console.warn(EPUB_COVER_ERROR_PREFIX, error);
    return null;
  }
}
