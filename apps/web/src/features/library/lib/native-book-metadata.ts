import { invoke } from "@tauri-apps/api/core";

export type NativeBookMetadata = {
  title: string | null;
  author: string | null;
  coverUrl: string | null;
};

/**
 * Read only an EPUB's container, package document, and cover entry in Rust.
 * The full book never enters the webview and foliate is not started.
 */
export async function extractNativeEpubMetadata(path: string): Promise<NativeBookMetadata | null> {
  try {
    return await invoke<NativeBookMetadata>("extract_epub_metadata", { path });
  } catch (error) {
    // Malformed or unusual EPUBs still import normally. Foliate gets another
    // chance to fill metadata when the reader opens the book.
    console.warn("Unable to extract lightweight EPUB metadata", error);
    return null;
  }
}

/** Render a bounded PDF cover through the desktop's native PDF engine. */
export async function extractNativePdfMetadata(path: string): Promise<NativeBookMetadata | null> {
  try {
    return await invoke<NativeBookMetadata>("extract_pdf_metadata", { path });
  } catch (error) {
    // Unsupported platforms and malformed PDFs still import normally. PDF.js
    // gets another chance when the reader opens the document.
    console.warn("Unable to extract lightweight PDF metadata", error);
    return null;
  }
}
