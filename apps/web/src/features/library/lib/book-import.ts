import type { EventOrigin } from "@read-aware/core";
import type { TFunction } from "i18next";
import { invoke } from "../../../platform/ipc";
import { putDesktopBlob } from "../../../platform/blob-store";
import { commitDomainEvents } from "../../../platform/domain-events";
import { isTauri } from "../../../platform/environment";
import { createLogger } from "../../../platform/logger";
import { parseFileName } from "./book-file-name";
import { scheduleBookEnrichment } from "./book-enrichment";
import { detectBookFormat, sourceFileInfo } from "./import-format";
import { bookFileKey, getBookRecord } from "./library-db";
import type { BookFormat, BookImportSource, LibraryBook } from "./library-types";

const log = createLogger("library");

/**
 * Per-source result of an import. A duplicate carries the EXISTING shelf book
 * it matched, so callers (the external "open with" flow) can open it anyway.
 */
export type ImportOutcome = {
  status: "imported" | "duplicate";
  book: LibraryBook;
};

/** What `library_stage_import` hands back (see import.rs). */
type StagedImport = {
  sha256: string;
  byteSize: number;
  duplicateOf: string | null;
  title: string | null;
  author: string | null;
  cover: "ready" | "none" | "deferred";
  metadataDeferred: boolean;
};

/**
 * The shelf entry the picker can show BEFORE the file is durable: it carries
 * the final id and the file-name-derived title, so its sorted slot is the
 * committed book's slot and the tile does not jump when the import lands.
 */
export function pendingImportPlaceholder(
  bookId: string,
  source: BookImportSource,
  format: BookFormat,
): LibraryBook {
  const now = new Date().toISOString();
  const file = sourceFileInfo(source);
  const parsed = parseFileName(file.name);
  return {
    id: bookId,
    title: parsed.title,
    author: parsed.author,
    format,
    fileName: file.name,
    mimeType: file.type || "",
    fileSize: file.size,
    coverStatus: "unchecked",
    coverBlobKey: null,
    coverLocal: false,
    coverVersion: null,
    coverUrl: null,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null,
    progressPercent: 0,
    readingStatus: "unread",
    progress: null,
    starred: false,
    collectionId: null,
  };
}

export type ImportBookOptions = {
  t: TFunction<"shelf">;
  /** Shelf books already loaded — the free name+size duplicate check. */
  knownBooks: readonly LibraryBook[];
  origin?: EventOrigin;
  /**
   * Called once the format is known and the id reserved, before the (possibly
   * long) copy — the UI can show the placeholder in its final slot.
   */
  onPrepared?: (placeholder: LibraryBook) => void;
};

/**
 * Import one source. Everything heavy happens in ONE native round trip
 * (`library_stage_import`: hash → dedupe → copy → extract → cover), then the
 * `book.imported` event commits with the real title/author and the cover
 * verdict. Whatever the native extractors could not settle (PDF metadata,
 * PDF covers off macOS, RAR comics) is handed to the engine job, which fills
 * the tile in a moment later — the shelf never waits on it.
 */
export async function importBook(
  source: BookImportSource,
  options: ImportBookOptions,
): Promise<ImportOutcome> {
  if (!isTauri()) {
    throw new Error("Importing a book is desktop-only — the browser build is a UI shell without storage.");
  }
  const file = sourceFileInfo(source);

  // Cheap pass: the identical file (same name + size) is already imported.
  const byFile = options.knownBooks.find(
    (entry) => entry.fileName === file.name && entry.fileSize === file.size,
  );
  if (byFile) return { status: "duplicate", book: byFile };

  const startedAt = performance.now();
  const format = await detectBookFormat(source, options.t);
  const bookId = crypto.randomUUID();
  const placeholder = pendingImportPlaceholder(bookId, source, format);
  options.onPrepared?.(placeholder);

  // In-memory sources (drag-and-drop, plugin importBook, mobile picks that
  // arrive as Files) stream into the blob store first; native paths are
  // copied by Rust without ever entering the webview.
  if (source.kind === "file") {
    await putDesktopBlob(
      bookFileKey(bookId),
      new Uint8Array(await source.file.arrayBuffer()),
      file.type || undefined,
    );
  }
  const stagingAt = performance.now();
  const staged = await invoke<StagedImport>("library_stage_import", {
    request: {
      bookId,
      format,
      mimeType: file.type || null,
      source: source.kind === "native-path" ? { kind: "path", path: source.path } : { kind: "blob" },
    },
  });

  if (staged.duplicateOf) {
    // The content gate caught what the name couldn't: this exact file is
    // already on the shelf (possibly synced in under a different title, or
    // sitting there as a shell whose bytes the pick just supplied).
    const existing =
      options.knownBooks.find((entry) => entry.id === staged.duplicateOf) ??
      (await getBookRecord(staged.duplicateOf));
    if (!existing) {
      // The registry matched a sha whose book row is gone; the staging step
      // kept nothing for this id, so there is no book to show either way.
      throw new Error(`Duplicate of an unknown book ${staged.duplicateOf}`);
    }
    return { status: "duplicate", book: existing };
  }

  const title = staged.title?.trim() || placeholder.title;
  const author = staged.author?.trim() || placeholder.author;
  await commitDomainEvents(
    {
      type: "book.imported",
      payload: {
        bookId,
        title,
        author,
        format,
        fileName: file.name,
        mimeType: file.type || undefined,
        fileSize: staged.byteSize,
        sourceBlobKey: bookFileKey(bookId),
        sourceSha256: staged.sha256,
      },
      origin: options.origin,
    },
    ...(staged.cover === "ready"
      ? [
          {
            type: "book.coverExtracted" as const,
            payload: { bookId, status: "ready" as const, coverBlobKey: `cover:${bookId}` },
            origin: options.origin,
          },
        ]
      : staged.cover === "none"
        ? [
            {
              type: "book.coverExtracted" as const,
              payload: { bookId, status: "none" as const },
              origin: options.origin,
            },
          ]
        : []),
  );

  const book = await getBookRecord(bookId);
  if (!book) throw new Error("Imported book was not persisted");

  const stagedMs = Math.round(performance.now() - stagingAt);
  const totalMs = Math.round(performance.now() - startedAt);
  log.info(
    `imported ${format} ${bookId}: ${totalMs} ms total (native staging ${stagedMs} ms, cover ${staged.cover})`,
  );
  if (staged.cover === "deferred" || staged.metadataDeferred) {
    scheduleBookEnrichment({
      bookId,
      cover: staged.cover === "deferred",
      metadata: staged.metadataDeferred,
    });
  }
  return { status: "imported", book };
}
