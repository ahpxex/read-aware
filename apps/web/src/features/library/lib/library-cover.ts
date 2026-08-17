import {
  foliateAuthor,
  foliateTitle,
  makeFoliateBook,
  type FoliateBook,
} from "../../reader/lib/foliate-engine";
import { createLogger } from "../../../platform/logger";
import type { BookFormat } from "./library-types";

const log = createLogger("library");

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

/** Formats the vendored engine can parse headlessly (no view, no reader). */
const IMPORT_PARSE_FORMATS: ReadonlySet<BookFormat> = new Set([
  "epub",
  "mobi",
  "azw3",
  "fb2",
  "cbz",
  "pdf",
]);

/**
 * Import-time metadata for sources that arrive as in-memory files — the mobile
 * pick path and plugin `importBook`. The desktop path extracts natively so the
 * book never enters the webview, but these bytes are already here: parse them
 * with the engine and pull the same title/author/cover a first open would,
 * instead of shipping the shelf a nameless cover-less entry.
 */
export async function extractImportedFileMetadata(
  file: File,
  format: BookFormat,
): Promise<ExtractedBookMetadata | null> {
  if (!IMPORT_PARSE_FORMATS.has(format)) return null;
  try {
    return await extractOpenedBookMetadata(await makeFoliateBook(file));
  } catch (error) {
    log.warn(`Unable to extract ${format.toUpperCase()} metadata at import`, error);
    return null;
  }
}

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
    log.warn(COVER_ERROR_PREFIX, error);
  }
  return { title, author, coverUrl };
}
