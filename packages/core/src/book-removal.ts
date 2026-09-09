import { AppError } from "./errors";

export const MAX_BOOK_REMOVAL_BATCH = 1_000;

/** A committed batch is not rolled back if subsequent local blob release fails. */
export type BookFileReleaseReceipt = {
  bookIds: string[];
  files: { status: "released" } | { status: "pending"; errorCode: string };
};
export type BookRemovalReceipt = BookFileReleaseReceipt & {
  /** The record transaction committed. This is not a filesystem transaction. */
  committed: true;
};

export function normalizeBookRemovalIds(input: unknown): string[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_BOOK_REMOVAL_BATCH
    || Array.from(input).some(id => typeof id !== "string" || !id.trim() || id.length > 256)) {
    throw new AppError("library/invalid-removal", "Expected 1-1000 non-empty book IDs of at most 256 characters");
  }
  return [...new Set(input as string[])];
}
