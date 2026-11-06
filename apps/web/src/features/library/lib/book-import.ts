import { runDomainWrite } from "../../../platform/domain-write-gate";
import type { BookImportPhase, HlcStamp } from "@read-aware/core";
import type { TFunction } from "i18next";
import { invoke } from "../../../platform/ipc";
import { putDesktopBlob } from "../../../platform/blob-store";
import {
  broadcastDomainEventDrafts,
  observeCommittedStamps,
  type DomainEventDraft,
} from "../../../platform/domain-events";
import { actorOrigin, type DomainActor } from "../../../platform/domain-actor";
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

/** What `library_import` hands back (see crates/store/src/import.rs). */
type NativeImportOutcome =
  | {
      status: "imported";
      cover: "ready" | "none" | "deferred";
      metadataDeferred: boolean;
      /** The committed events, stamped natively inside the import transaction. */
      events: { type: DomainEventDraft["type"]; hlc: HlcStamp; payload: unknown }[];
    }
  | { status: "duplicate"; book: { id: string } };

/**
 * The shelf entry the picker can show BEFORE the file is durable: it carries
 * the final id and the file-name-derived title, so its sorted slot is the
 * committed book's slot and the tile does not jump when the import lands.
 */
export function pendingImportPlaceholder(bookId: string, source: BookImportSource, format: BookFormat): LibraryBook {
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
  origin?: DomainActor;
  /** Cancellation before the first durable write; accepted imports are finalized. */
  signal?: AbortSignal;
  /** Host resource lease/admission recheck immediately before that first write. */
  beforeWrite?: () => void;
  onProgress?: (phase: BookImportPhase) => void;
  /**
   * Called once the format is known and the id reserved, before the (possibly
   * long) copy — the UI can show the placeholder in its final slot.
   */
  onPrepared?: (placeholder: LibraryBook) => void;
};

/**
 * Import one source. The whole pipeline is ONE native call, `library_import`
 * (crates/store/src/import.rs, shared with the `ra` CLI): dedupe by name and
 * content, format, intent, copy, native metadata and cover, and the commit of
 * `book.imported` (+ `book.coverExtracted`). Whatever the native extractors
 * could not settle (PDF metadata, PDF covers off macOS, RAR comics) is handed
 * to the engine job, which fills the tile in a moment later — the shelf never
 * waits on it.
 */
export async function importBook(source: BookImportSource, options: ImportBookOptions): Promise<ImportOutcome> {
  options.signal?.throwIfAborted();
  if (!isTauri()) {
    throw new Error("Importing a book is desktop-only — the browser build is a UI shell without storage.");
  }
  const file = sourceFileInfo(source);
  const progress = (phase: BookImportPhase) => {
    try {
      options.onProgress?.(phase);
    } catch (error) {
      log.warn("Import progress observer failed", error);
    }
  };
  progress("preparing");

  // Cheap pass over the shelf already in memory: the identical file (same
  // name + size) is already imported. The native pipeline checks again.
  const byFile = options.knownBooks.find((entry) => entry.fileName === file.name && entry.fileSize === file.size);
  if (byFile && source.kind !== "native-resource") return { status: "duplicate", book: byFile };

  const startedAt = performance.now();
  // The placeholder's format; the native pipeline decides the stored one with
  // the same rules (crates/store/src/import_cases pins both).
  const format = await detectBookFormat(source, options.t);
  options.signal?.throwIfAborted();
  const bookId = crypto.randomUUID();
  const placeholder = pendingImportPlaceholder(bookId, source, format);
  options.onPrepared?.(placeholder);

  return runDomainWrite(async () => {
    let began = false;
    try {
      // In-memory sources (drag-and-drop, plugin importBook, mobile picks that
      // arrive as Files) stream into the blob store first, under an intent
      // recorded here; native paths are read by Rust without ever entering
      // the webview, and the native pipeline records their intent itself.
      if (source.kind === "file") {
        const bytes = new Uint8Array(await source.file.arrayBuffer());
        options.signal?.throwIfAborted();
        options.beforeWrite?.();
        progress("staging");
        await invoke("library_begin_import", { bookId });
        began = true;
        await putDesktopBlob(bookFileKey(bookId), bytes, file.type || undefined);
      } else {
        options.signal?.throwIfAborted();
        options.beforeWrite?.();
        progress("staging");
      }
      const outcome = await invoke<NativeImportOutcome>("library_import", {
        request: {
          bookId,
          fileName: file.name,
          mimeType: file.type || null,
          sourcePath: source.kind !== "native-resource" && source.sourcePath ? source.sourcePath : null,
          origin: options.origin === undefined ? null : actorOrigin(options.origin),
          dedupeByName: source.kind !== "native-resource",
          ...(source.kind === "native-path" && source.externalOpenEpoch !== undefined
            ? { externalOpenEpoch: source.externalOpenEpoch }
            : {}),
          source:
            source.kind === "native-path"
              ? { kind: "path", path: source.path }
              : source.kind === "native-resource"
                ? { kind: "resource", id: source.resourceId }
                : { kind: "blob" },
        },
      });

      if (outcome.status === "duplicate") {
        // The native gate caught what the shelf list couldn't: this exact file
        // is already on the shelf (possibly synced in under a different title,
        // or sitting there as a shell whose bytes the pick just supplied).
        const existing =
          options.knownBooks.find((entry) => entry.id === outcome.book.id) ?? (await getBookRecord(outcome.book.id));
        if (!existing) throw new Error(`Duplicate of an unknown book ${outcome.book.id}`);
        return { status: "duplicate", book: existing };
      }

      progress("committing");
      observeCommittedStamps(outcome.events.map((event) => event.hlc));
      broadcastDomainEventDrafts(
        outcome.events.map(
          (event) => ({ type: event.type, payload: event.payload, origin: options.origin }) as DomainEventDraft,
        ),
      );
      const book = await getBookRecord(bookId);
      if (!book) throw new Error("Imported book was not persisted");

      log.info(
        `imported ${book.format} ${bookId}: ${Math.round(performance.now() - startedAt)} ms total (cover ${outcome.cover})`,
      );
      if (outcome.cover === "deferred" || outcome.metadataDeferred) {
        scheduleBookEnrichment({
          bookId,
          cover: outcome.cover === "deferred",
          metadata: outcome.metadataDeferred,
        });
      }
      return { status: "imported", book };
    } finally {
      if (began) {
        // A committed book atomically clears the intent. Failed/duplicate
        // staging releases only this import's assets; failed cleanup remains
        // durable for the next native process and must not mask the outcome.
        try {
          await invoke("library_finish_import", { bookId });
        } catch (error) {
          log.warn("Import staging cleanup deferred", error);
        }
      }
    }
  });
}
