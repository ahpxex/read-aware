import { errorCode, normalizeBookRemovalIds, type BookRemovalReceipt, type BookFileReleaseReceipt } from "@read-aware/core";

type RemovalDeps = {
  commit(ids: string[]): Promise<unknown>;
  releaseFiles(ids: string[]): Promise<void>;
  removed(id: string): void;
  warn(error: unknown): void;
};

/** One event transaction, followed by separately reported filesystem cleanup. */
export async function removeBookBatch(input: unknown, deps: RemovalDeps): Promise<BookRemovalReceipt> {
  const bookIds = normalizeBookRemovalIds(input);
  await deps.commit(bookIds);
  for (const id of bookIds) {
    try { deps.removed(id); } catch (error) { deps.warn(error); }
  }
  return { ...await releaseRemovedBookFiles(bookIds, deps), committed: true };
}

/** Native release verifies that all IDs are still absent while holding the DB lock. */
export async function releaseRemovedBookFiles(input: unknown, deps: Pick<RemovalDeps, "releaseFiles" | "warn">): Promise<BookFileReleaseReceipt> {
  const bookIds = normalizeBookRemovalIds(input);
  try {
    await deps.releaseFiles(bookIds);
    return { bookIds, files: { status: "released" } };
  } catch (error) {
    deps.warn(error);
    return { bookIds, files: { status: "pending", errorCode: errorCode(error) ?? "fs/unknown" } };
  }
}
