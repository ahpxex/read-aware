/**
 * A book's ZIP container (EPUB, CBZ), read by the native shell where the file
 * is stored (`book_archive.rs`).
 *
 * The reading engine used to receive the file and unpack it in the webview:
 * every image and font a page referred to was inflated in JavaScript, one
 * after another, before the page could load. Through this source the engine
 * asks only for the documents it parses itself — the package, the navigation,
 * a page — and refers to everything a page merely displays by URL, which the
 * webview fetches off the main thread, in parallel, as the page lays out.
 */
import { AppError } from "@read-aware/core";
import type { BookArchive } from "../../foliate-js/src/book-loader";
import { customSchemeUrl } from "./custom-scheme";
import { invoke } from "./ipc";

type OpenedArchive = { contentVersion: string; entries: { name: string; size: number }[] };

export type BookArchivePort = {
  open(bookId: string): Promise<OpenedArchive | null>;
  texts(bookId: string, contentVersion: string, names: string[]): Promise<(string | null)[]>;
  resourceUrl(path: string): string;
  fetch(url: string): Promise<Response>;
};

const nativePort: BookArchivePort = {
  open: (bookId) => invoke<OpenedArchive | null>("book_archive_open", { bookId }),
  texts: (bookId, contentVersion, names) =>
    invoke<(string | null)[]>("book_archive_texts", { bookId, contentVersion, names }),
  resourceUrl: (path) => customSchemeUrl("rablob", path),
  fetch: (url) => fetch(url),
};

/**
 * What every opening of an EPUB parses before it has a page to show: the
 * container, its encryption and display options, the package and the NCX.
 * They are asked for together, in the round trip after the directory.
 */
const PACKAGE_DOCUMENT = /^META-INF\/[^/]+\.xml$|\.(?:opf|ncx)$/i;
/** Past this, a "package document" is not one worth sending ahead of being asked for. */
const PACKAGE_DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;

const unavailable = (message: string, cause?: unknown) =>
  new AppError("library/content-unavailable", message, cause === undefined ? undefined : { cause });

/**
 * Open the book's archive, or null when its file is not on this device.
 * `name` and `type` tell the engine which container it is, as a file's would.
 */
export async function openBookArchive(
  bookId: string,
  name: string,
  type: string,
  port: BookArchivePort = nativePort,
): Promise<BookArchive | null> {
  const opened = await port.open(bookId);
  if (!opened) return null;
  const { contentVersion } = opened;
  const revision = contentVersion.replace(/^sha256:/, "");
  const sizes = new Map(opened.entries.map((entry) => [entry.name, entry.size]));

  const ahead = opened.entries
    .filter((entry) => PACKAGE_DOCUMENT.test(entry.name) && entry.size <= PACKAGE_DOCUMENT_MAX_BYTES)
    .map((entry) => entry.name);
  // Each is handed over once: the engine keeps what it parsed, not the text.
  const sentAhead = new Map<string, Promise<string | null>>();
  if (ahead.length) {
    const texts = port.texts(bookId, contentVersion, ahead);
    ahead.forEach((entry, index) => {
      const text = texts.then((values) => values[index] ?? null);
      // A failure belongs to whoever reads the document; one nobody reads is not a failure to report.
      text.catch(() => {});
      sentAhead.set(entry, text);
    });
  }

  // The entry name is one path segment: a webview would otherwise resolve its dot segments away.
  const resourceURL = (entry: string) =>
    sizes.has(entry)
      ? port.resourceUrl(`book/${encodeURIComponent(bookId)}/${revision}/${encodeURIComponent(entry)}`)
      : null;

  return {
    name,
    type,
    entries: opened.entries.map((entry) => ({ filename: entry.name })),
    getSize: (entry) => sizes.get(entry) ?? 0,
    resourceURL,
    async loadText(entry) {
      if (!sizes.has(entry)) return null;
      const sent = sentAhead.get(entry);
      if (sent) {
        sentAhead.delete(entry);
        return sent;
      }
      const [text] = await port.texts(bookId, contentVersion, [entry]);
      return text ?? null;
    },
    async loadBlob(entry) {
      const url = resourceURL(entry);
      if (!url) return null;
      let response: Response;
      try {
        response = await port.fetch(url);
      } catch (error) {
        throw unavailable(`Book resource could not be read: ${entry}`, error);
      }
      // The directory lists it, so a refusal is the file having changed or gone, not a missing entry.
      if (!response.ok) throw unavailable(`Book resource could not be read (${response.status}): ${entry}`);
      return response.blob();
    },
  };
}
