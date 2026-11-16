/**
 * A headless shell for the app: the part of the native side the web code
 * talks to, without a window or a webview.
 *
 * App code reaches the native side through one seam (`platform/ipc`). This
 * installs that seam over an in-memory library, blob store and book archive,
 * together with the DOM the reader engine parses with. Everything above the
 * seam is then the app's own code, unchanged: it opens a book, parses it,
 * extracts its text and answers the agent's ports as it does on the desktop.
 *
 * What stands in for native code is small and explicit. A command this shell
 * does not provide fails by name, so nothing is quietly faked: the business
 * store (annotations, memory, conversations, settings) is not here yet, and a
 * caller that reaches for it finds out at once.
 *
 * The DOM is jsdom, not WebKit. The parity suite in tests/runtime runs the same
 * extraction in a browser engine and holds both to the same result.
 */
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { JSDOM } from "jsdom";
import type { EngineAPI } from "../../foliate-js/src/engine-api";

export type HeadlessBook = {
  id: string;
  title: string;
  author?: string;
  fileName: string;
  fileType: string;
  bytes: Uint8Array;
};

export type HeadlessShell = {
  addBook(book: HeadlessBook): void;
  /** How many times each native command was called, for tests that count round trips. */
  calls: ReadonlyMap<string, number>;
  /** Every call to a native command this shell does not provide, in order. Each one also failed its caller. */
  unprovided: readonly string[];
  dispose(): void;
};

const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "Node",
  "NodeFilter",
  "Range",
  "XMLSerializer",
  "DOMParser",
  "Element",
  "HTMLElement",
  "Document",
  "CustomEvent",
  "Event",
  "EventTarget",
] as const;

const BLOB_KEY_HEADER = "x-blob-key";
const BLOB_MIME_HEADER = "x-blob-mime";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

let active: HeadlessShell | null = null;

/** Install the shell for this process. One at a time: the app's modules hold process-wide state. */
export async function installHeadlessShell(): Promise<HeadlessShell> {
  if (active) throw new Error("A headless shell is already installed in this process");
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "http://localhost/" });
  const scope = globalThis as unknown as Record<string, unknown>;
  const windowValues = dom.window as unknown as Record<string, unknown>;
  const previous = DOM_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const name of DOM_GLOBALS)
    Object.defineProperty(globalThis, name, {
      value: name === "window" ? dom.window : windowValues[name],
      configurable: true,
      writable: true,
    });

  type Stored = { bytes: Uint8Array; mime: string | null };
  const books = new Map<string, HeadlessBook & { sha: string; entries: Record<string, Uint8Array> | null }>();
  const blobs = new Map<string, Stored>();
  const calls = new Map<string, number>();
  const unprovided: string[] = [];
  const fileOf = (key: string) => (key.startsWith("bookfile:") ? books.get(key.slice("bookfile:".length)) : undefined);
  const stored = (key: string): Stored | undefined => {
    const file = fileOf(key);
    return file ? { bytes: file.bytes, mime: file.fileType } : blobs.get(key);
  };

  const native = (command: string, payload: unknown, options?: { headers?: Record<string, string> }): unknown => {
    calls.set(command, (calls.get(command) ?? 0) + 1);
    const args = (payload ?? {}) as Record<string, unknown>;
    switch (command) {
      case "library_get_book": {
        const book = books.get(String(args.id));
        return book
          ? {
              id: book.id,
              title: book.title,
              author: book.author ?? "",
              format: book.fileName.split(".").pop() ?? "",
              fileName: book.fileName,
              fileType: book.fileType,
              fileSize: book.bytes.length,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            }
          : null;
      }
      case "get_blob_info": {
        const blob = stored(String(args.key));
        return blob ? { byteSize: blob.bytes.length, mimeType: blob.mime, sha256: sha256(blob.bytes) } : null;
      }
      case "get_blob":
        return (stored(String(args.key))?.bytes ?? new Uint8Array()).slice().buffer;
      case "get_blob_range": {
        const bytes = stored(String(args.key))?.bytes ?? new Uint8Array();
        const offset = Number(args.offset);
        return bytes.slice(offset, offset + Number(args.length)).buffer;
      }
      case "put_blob": {
        const key = options?.headers?.[BLOB_KEY_HEADER];
        if (!key) throw new Error("headless shell: put_blob without a blob key");
        const bytes = new Uint8Array(payload as ArrayBuffer);
        blobs.set(key, { bytes, mime: options?.headers?.[BLOB_MIME_HEADER] ?? null });
        return { sha256: sha256(bytes), byteSize: bytes.length };
      }
      case "delete_blob":
        blobs.delete(String(args.key));
        return null;
      // Device-local key-value writes: the app keeps its own copy in memory, which is all a headless run reads.
      case "set_kv":
      case "remove_kv":
        return null;
      case "book_archive_open": {
        const book = books.get(String(args.bookId));
        if (!book?.entries) return null;
        return {
          contentVersion: `sha256:${book.sha}`,
          entries: Object.entries(book.entries).map(([name, data]) => ({ name, size: data.length })),
        };
      }
      case "book_archive_texts": {
        const entries = books.get(String(args.bookId))?.entries ?? {};
        return (args.names as string[]).map((name) => (entries[name] ? new TextDecoder().decode(entries[name]) : null));
      }
      default:
        unprovided.push(command);
        throw new Error(`headless shell: native command "${command}" is not provided`);
    }
  };

  Object.defineProperty(dom.window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      invoke: async (command: string, payload: unknown, options?: { headers?: Record<string, string> }) =>
        native(command, payload, options),
      transformCallback: () => 0,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });

  // The engine as the app finds it once loaded: its parsing and content queries. There is no
  // renderer here, so nothing that draws a page (the view, overlays, footnotes) is offered.
  const [{ makeBook }, navigation, ranges] = await Promise.all([
    import("../../foliate-js/src/book-loader"),
    import("../../foliate-js/src/content-navigation"),
    import("../../foliate-js/src/content-range"),
  ]);
  const hadEngine = "__readawareFoliate" in scope;
  scope.__readawareFoliate = {
    makeBook,
    contentCFI: navigation.contentCFI,
    searchContentSection: navigation.searchContentSection,
    resolveTextQuote: navigation.resolveTextQuote,
    readContentRange: ranges.readContentRange,
    locateContentRange: ranges.locateContentRange,
  } as Partial<EngineAPI>;

  active = {
    calls,
    unprovided,
    addBook: (book) => {
      // A ZIP container is read where it is stored and handed over entry by entry, as book_archive.rs does.
      const zipped = /\.(epub|cbz)$/i.test(book.fileName);
      books.set(book.id, { ...book, sha: sha256(book.bytes), entries: zipped ? unzipSync(book.bytes) : null });
    },
    dispose: () => {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
      if (!hadEngine) Reflect.deleteProperty(scope, "__readawareFoliate");
      dom.window.close();
      active = null;
    },
  };
  return active;
}
