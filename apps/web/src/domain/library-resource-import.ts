import { AppError, errorCode, type EventOrigin, type BookImportReceipt } from "@read-aware/core";
import type { ResourceOwner } from "../services/resource-owner";
import { i18n } from "../i18n";
import { emitAppEvent } from "../platform/app-events";
import { importBook } from "../features/library/lib/book-import";
import { listLibraryBooks } from "../features/library/lib/library-db";
import { toBookSummary } from "./library";
import { createLogger } from "../platform/logger";

const log = createLogger("resource-import");

/** Library mutation over an actor's resource lease, not filesystem authority. */
export function importResourceBook(owner: ResourceOwner, id: string, origin: EventOrigin, signal?: AbortSignal): Promise<BookImportReceipt> {
  return owner.use(id, async resource => {
    const knownBooks = await listLibraryBooks();
    const outcome = await importBook({ kind: "native-resource", resourceId: resource.id,
      name: resource.name, size: resource.size, type: resource.mimeType },
    { t: i18n.getFixedT(null, "shelf"), knownBooks, origin, signal });
    // Duplicates may have repaired a synced-in book's missing local original.
    emitAppEvent("library-changed", {});
    return { status: outcome.status, book: toBookSummary(outcome.book) };
  }, signal).catch(error => {
    log.warn("Resource book import failed", error);
    throw new AppError(errorCode(error) ?? "internal", "Resource book import failed");
  });
}
