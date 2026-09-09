import { AppError, type ChapterDigest } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";

/** Native transactions/replay remain authoritative; this fixture also rejects competing test writes. */
export function createBookMemoryFixture(rows: Map<string, ChapterDigest[]>, classification: RuntimeDeps["bookClassification"]): RuntimeDeps["bookMemory"] {
  const versions = new Map<string, { fingerprint: string; revision: string }>();
  const key = (bookId: string, index: number) => JSON.stringify([bookId, index]);
  const inspect: RuntimeDeps["bookMemory"]["inspectDigest"] = async (bookId, chapterIndex, signal) => {
    if (!Number.isSafeInteger(chapterIndex) || chapterIndex < 0) throw new AppError("memory/invalid-input", "Invalid chapter");
    const book = await classification.inspect(bookId, signal); if (!book) return null;
    const fingerprint = JSON.stringify([book.revision, rows.get(bookId)?.find(d => d.chapterIndex === chapterIndex)]);
    let entry = versions.get(key(bookId, chapterIndex));
    if (!entry || entry.fingerprint !== fingerprint) {
      entry = { fingerprint, revision: `bdg1:${Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,"0")).join("")}` };
      versions.set(key(bookId, chapterIndex), entry);
    }
    return { bookId, chapterIndex, flavor: book.narrativity ?? "narrative", revision: entry.revision };
  };
  return { listDigests: async bookId => structuredClone(rows.get(bookId) ?? []), inspectDigest: inspect,
    saveDigest: async (bookId, digest, revision, signal) => {
      const copy = structuredClone(digest), snapshot = await inspect(bookId, copy.chapterIndex, signal);
      if (signal?.aborted) throw new AppError("memory/cancelled", "Cancelled");
      if (!snapshot) throw new AppError("reader/book-not-found", "Book not found");
      if (snapshot.revision !== revision || versions.get(key(bookId, copy.chapterIndex))?.revision !== revision || snapshot.flavor !== (copy.flavor ?? "narrative")) throw new AppError("memory/conflict", "Digest changed");
      const next = (rows.get(bookId) ?? []).filter(d => d.chapterIndex !== copy.chapterIndex);
      next.push(copy); next.sort((a,b) => a.chapterIndex - b.chapterIndex); rows.set(bookId, next);
      versions.delete(key(bookId, copy.chapterIndex));
    } };
}
