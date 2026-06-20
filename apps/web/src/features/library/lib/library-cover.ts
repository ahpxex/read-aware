import { foliateAuthor, foliateTitle, makeFoliateBook } from "../../reader/lib/foliate-engine";

const METADATA_ERROR_PREFIX = "Unable to read book metadata";
const COVER_ERROR_PREFIX = "Unable to extract book cover";

export type ExtractedBookMetadata = {
  title: string | null;
  author: string | null;
  coverUrl: string | null;
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

/**
 * Parse a book file with the foliate engine to pull title, author, and a cover
 * data URL. Works uniformly across EPUB / MOBI / AZW3 / FB2 / PDF. Best-effort —
 * any failure degrades to nulls so import never blocks on a malformed file.
 */
export async function extractBookMetadata(file: File): Promise<ExtractedBookMetadata> {
  try {
    const book = await makeFoliateBook(file);
    const title = foliateTitle(book) || null;
    const author = foliateAuthor(book) || null;

    let coverUrl: string | null = null;
    try {
      const cover = await book.getCover?.();
      if (cover) coverUrl = await blobToDataUrl(cover);
    } catch (error) {
      console.warn(COVER_ERROR_PREFIX, error);
    }

    return { title, author, coverUrl };
  } catch (error) {
    console.warn(METADATA_ERROR_PREFIX, error);
    return { title: null, author: null, coverUrl: null };
  }
}

/** Cover-only helper for back-filling existing library records. */
export async function extractBookCover(file: File): Promise<string | null> {
  return (await extractBookMetadata(file)).coverUrl;
}
