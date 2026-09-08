import { AppError } from "@read-aware/core";
import { getDesktopBlobInfo } from "../../../platform/blob-store";
import { retainBook } from "../../reader/lib/book-lifetime";
import type { FoliateBook } from "../../reader/lib/foliate-engine";
import { parseBookFile } from "../../reader/lib/parse-book";
import { ensureUsableToc } from "../../reader/lib/toc-synthesis";
import { buildVirtualFoliateBook } from "../../reader/lib/virtual-book";
import { getVirtualBookBinding, resolveContentProvider } from "../../plugins/lib/virtual-books";
import { getStoredBookFile, getBookRecord } from "./library-db";
import { virtualContentVersion } from "./content-version";
export { virtualContentVersion } from "./content-version";

type Content = { book: FoliateBook; contentVersion: string; provider?: ReturnType<typeof resolveContentProvider> };
const active = new Map<string, Content>();

export async function fileContentVersion(bookId: string): Promise<string> {
  const info = await getDesktopBlobInfo(`bookfile:${bookId}`);
  if (!info?.sha256) throw new AppError("library/content-unavailable", "Book source has no readable content revision");
  return `sha256:${info.sha256}`;
}

/** Borrows the reader's parser; each concurrent query retains its own lease. */
export function registerActiveBookContent(bookId: string, book: FoliateBook, contentVersion: string,
  provider?: ReturnType<typeof resolveContentProvider>): () => void {
  const entry: Content = { book, contentVersion, provider };
  active.set(bookId, entry);
  return () => { if (active.get(bookId) === entry) active.delete(bookId); };
}

export async function withBookContent<T>(bookId: string, expectedVersion: string | undefined,
  signal: AbortSignal | undefined, read: (content: Content) => Promise<T>): Promise<T> {
  signal?.throwIfAborted();
  const record = await getBookRecord(bookId);
  if (!record) throw new AppError("library/book-not-found", "Book is not in the library");
  const binding = getVirtualBookBinding(bookId);
  const provider = binding ? resolveContentProvider(binding) : null;
  if (binding && !provider) throw new AppError("library/content-unavailable", "Book content provider is unavailable");
  let content = active.get(bookId);
  let release: (() => Promise<void>) | undefined;
  try {
    if (content) {
      if (binding && content.provider !== provider) throw new AppError("library/content-unavailable", "Active book belongs to an earlier provider activation");
      release = retainBook(content.book);
    }
    else if (binding) {
      if (!provider) throw new AppError("library/content-unavailable", "Book content provider is unavailable");
      const value = await provider.load(binding.key);
      signal?.throwIfAborted();
      content = { book: buildVirtualFoliateBook(value), contentVersion: await virtualContentVersion(value) };
      release = retainBook(content.book);
    } else {
      const contentVersion = await fileContentVersion(bookId);
      const file = await getStoredBookFile(bookId);
      if (!file) throw new AppError("fs/not-found", "Book source is missing");
      signal?.throwIfAborted();
      const book = await parseBookFile(file);
      release = retainBook(book);
      await ensureUsableToc(book);
      content = { book, contentVersion };
    }
    const check = async () => {
      signal?.throwIfAborted();
      const currentBinding = getVirtualBookBinding(bookId);
      if (currentBinding?.pluginId !== binding?.pluginId || currentBinding?.providerId !== binding?.providerId
        || currentBinding?.key !== binding?.key) throw new AppError("reader/stale-location", "Book content binding changed");
      if (expectedVersion && expectedVersion !== content!.contentVersion
        || !binding && await fileContentVersion(bookId) !== content!.contentVersion) {
        throw new AppError("reader/stale-location", "Book content revision changed");
      }
      if (binding && resolveContentProvider(binding) !== provider) throw new AppError("library/content-unavailable", "Book content provider was replaced or removed");
      if (!await getBookRecord(bookId)) throw new AppError("library/book-not-found", "Book was removed during content access");
      signal?.throwIfAborted();
    };
    await check();
    const result = await read(content);
    await check();
    return result;
  } finally { await release?.(); }
}
