import { invoke } from "@tauri-apps/api/core";
import type { BookFormat } from "./library-types";

export type NativeBookMetadata = {
  title: string | null;
  author: string | null;
  coverUrl: string | null;
};

/**
 * Import-time metadata, read natively per format.
 *
 * Every extractor reads only the bytes that carry title, author, and cover —
 * the book itself never enters the webview and foliate never starts. A format
 * with no native extractor (plain text, HTML) simply waits for the reader to
 * fill its metadata on first open.
 */
const NATIVE_EXTRACTORS: Partial<Record<BookFormat, string>> = {
  epub: "extract_epub_metadata",
  pdf: "extract_pdf_metadata",
  mobi: "extract_mobi_metadata",
  azw3: "extract_mobi_metadata",
  fb2: "extract_fb2_metadata",
  cbz: "extract_comic_metadata",
};

export async function extractNativeBookMetadata(
  format: BookFormat,
  path: string,
): Promise<NativeBookMetadata | null> {
  const command = NATIVE_EXTRACTORS[format];
  if (!command) return null;
  try {
    return await invoke<NativeBookMetadata>(command, { path });
  } catch (error) {
    // Malformed or unusual files still import normally: the reader gets
    // another chance to fill metadata when the book is first opened.
    console.warn(`Unable to extract lightweight ${format.toUpperCase()} metadata`, error);
    return null;
  }
}
