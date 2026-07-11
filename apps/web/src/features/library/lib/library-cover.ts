import { foliateAuthor, foliateTitle, type FoliateBook } from "../../reader/lib/foliate-engine";

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

type FoliateMetadataSource = {
  getCover?: () => Promise<Blob | null | undefined> | Blob | null | undefined;
};

/** Pull metadata from a foliate book that the reader has already parsed. */
export async function extractOpenedBookMetadata(book: FoliateBook): Promise<ExtractedBookMetadata> {
  const opened = book as FoliateMetadataSource;
  const title = foliateTitle(book) || null;
  const author = foliateAuthor(book) || null;
  let coverUrl: string | null = null;
  try {
    const cover = await opened.getCover?.();
    if (cover) coverUrl = await blobToDataUrl(cover);
  } catch (error) {
    console.warn(COVER_ERROR_PREFIX, error);
  }
  return { title, author, coverUrl };
}
