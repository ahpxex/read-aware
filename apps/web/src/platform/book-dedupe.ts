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
import { invoke } from "./ipc";
import { emitAppEvent } from "./app-events";
import { commitDomainEvents } from "./domain-events";
import { isTauri } from "./environment";
import { createLogger } from "./logger";

const log = createLogger("book-dedupe");

type DuplicateBookEntry = { id: string; createdAt: string };

/** Collapse same-content book records. Returns how many merges were emitted. */
export async function reconcileDuplicateBooks(): Promise<number> {
  if (!isTauri()) return 0;
  try {
    const groups = await invoke<DuplicateBookEntry[][]>("library_duplicate_book_groups");
    const merges = groups.flatMap((group) => {
      const [keeper, ...rest] = group;
      if (!keeper) return [];
      return rest.map((merged) => ({
        type: "book.merged" as const,
        payload: { keepId: keeper.id, mergedId: merged.id },
        origin: "system" as const,
      }));
    });
    if (merges.length === 0) return 0;
    await commitDomainEvents(...merges);
    log.info(`merged ${merges.length} duplicate book record(s)`);
    emitAppEvent("library-changed", {});
    return merges.length;
  } catch (error) {
    log.warn("reconcile failed; will retry after the next pull", error);
    return 0;
  }
}
