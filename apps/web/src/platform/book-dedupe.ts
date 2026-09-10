/**
 * Cross-device book dedup, the reconciliation half. The import gate stops a
 * duplicate at the door of ONE device; two devices importing the same file
 * concurrently (or before dedup existed) each hold a legitimate record until
 * their histories meet. This pass runs after every pull merge: shelf books
 * sharing a source sha256 collapse via `book.merged` events.
 *
 * Determinism is the whole design: the keeper is the group's oldest record
 * (then smallest id — the Rust query orders each group exactly so), which
 * means two devices detecting the same duplicate emit IDENTICAL merge
 * events, and applying the second is a no-op. No coordination needed.
 */
import { listDuplicateBooks, previewBookMerge, mergeDuplicateBooks } from "../domain/book-merge";
import { isTauri } from "./environment";
import { createLogger } from "./logger";

const log = createLogger("book-dedupe");

/** Collapse same-content book records. Returns how many merges were emitted. */
export async function reconcileDuplicateBooks(): Promise<number> {
  if (!isTauri()) return 0;
  try {
    const ids: string[] = []; let offset: number | null = 0;
    do {
      const page = await listDuplicateBooks({ offset, limit: 50 });
      ids.push(...page.groups.map(group => group.bookId)); offset = page.nextOffset;
    } while (offset !== null);
    let count = 0;
    for (const bookId of ids) {
      try {
        const preview = await previewBookMerge(bookId);
        if (!preview) continue;
        const receipt = await mergeDuplicateBooks({ bookId, expectedRevision: preview.revision }, "system");
        count += receipt.redirects.length;
      } catch (error) { log.warn("Duplicate group changed or failed; retry after the next pull", error); }
    }
    if (count) log.info(`merged ${count} duplicate book record(s)`);
    return count;
  } catch (error) {
    log.warn("reconcile failed; will retry after the next pull", error);
    return 0;
  }
}
