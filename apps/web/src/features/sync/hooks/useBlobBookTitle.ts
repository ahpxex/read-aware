/**
 * Resolve a sync blob key (`bookfile:<id>` / `cover:<id>`) to its book title
 * for the progress surfaces' "syncing <book>…" line. Titles come from one
 * shelf load, cached module-wide — the library changes rarely and a stale
 * title in a progress caption is harmless; a missed NEW book refreshes on the
 * next lookup because unknown ids retry once per key.
 */
import { useEffect, useState } from "react";
import { isTauri } from "../../../platform/environment";
import { listLibraryBooks } from "../../library/lib/library-db";

export function bookIdFromBlobKey(blobKey: string | null): string | null {
  if (!blobKey) return null;
  for (const prefix of ["bookfile:", "cover:"]) {
    if (blobKey.startsWith(prefix)) return blobKey.slice(prefix.length);
  }
  return null;
}

const titles = new Map<string, string>();
/** Ids a load already failed to find — retried at most once per session key. */
const missing = new Set<string>();
let loading: Promise<void> | null = null;

async function loadTitles(): Promise<void> {
  loading ??= listLibraryBooks()
    .then((books) => {
      for (const book of books) titles.set(book.id, book.title);
    })
    .catch(() => {})
    .finally(() => {
      loading = null;
    });
  await loading;
}

export function useBlobBookTitle(blobKey: string | null): string | null {
  const bookId = bookIdFromBlobKey(blobKey);
  const [title, setTitle] = useState<string | null>(bookId ? (titles.get(bookId) ?? null) : null);

  useEffect(() => {
    if (!bookId || !isTauri()) {
      setTitle(null);
      return;
    }
    const cached = titles.get(bookId);
    if (cached) {
      setTitle(cached);
      return;
    }
    if (missing.has(bookId)) {
      setTitle(null);
      return;
    }
    let cancelled = false;
    void loadTitles().then(() => {
      if (cancelled) return;
      const resolved = titles.get(bookId) ?? null;
      if (!resolved) missing.add(bookId);
      setTitle(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  return bookId ? title : null;
}
