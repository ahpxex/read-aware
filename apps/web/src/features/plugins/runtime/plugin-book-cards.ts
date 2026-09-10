import { AppError, type BookSummary } from "@read-aware/core";
import { MAX_PRESENTED_ITEMS, type BookReference, type ThreadScope } from "@read-aware/agent";

export type PluginBookCardResolver = (ids: readonly string[], signal?: AbortSignal) => Promise<BookReference[]>;

/** Hydrate identities through the registering plugin's authorized library,
 * never from plugin-supplied titles, covers, URLs or executable UI. */
export async function resolvePluginBookCards(ids: readonly string[], list: () => Promise<BookSummary[]>, signal?: AbortSignal): Promise<BookReference[]> {
  signal?.throwIfAborted();
  const shelf = await list();
  signal?.throwIfAborted();
  const byId = new Map(shelf.map(book => [String(book.id), book]));
  return ids.flatMap(bookId => {
    const book = byId.get(bookId);
    return book ? [{ bookId, title: book.title, author: book.author }] : [];
  });
}

export async function pluginBookCardResult(result: unknown, scope: ThreadScope, resolve: PluginBookCardResolver | undefined, signal?: AbortSignal) {
  if (!result || typeof result !== "object" || !Object.prototype.hasOwnProperty.call(result, "bookCards")) return null;
  const invalid = (): never => { throw new AppError("plugin/invalid-input", "Expected 1 to 24 book cards containing only a bookId"); };
  if (Array.isArray(result) || Object.keys(result).some(key => key !== "gist" && key !== "bookCards")) return invalid();
  const candidate = result as { gist?: unknown; bookCards?: unknown };
  if (!Array.isArray(candidate.bookCards) || !candidate.bookCards.length || candidate.bookCards.length > MAX_PRESENTED_ITEMS) return invalid();
  const ids: string[] = [];
  for (const card of candidate.bookCards) {
    if (!card || typeof card !== "object" || Array.isArray(card) || Object.keys(card).some(key => key !== "bookId")
      || typeof card.bookId !== "string" || !card.bookId.trim() || card.bookId.length > 256) return invalid();
    if (!ids.includes(card.bookId)) ids.push(card.bookId);
  }
  if (!resolve) throw new AppError("memory/forbidden", "Book cards require library read access");
  const allowed = ids.filter(id => scope.kind === "global" || id === scope.bookId);
  const skippedScope = ids.filter(id => !allowed.includes(id));
  signal?.throwIfAborted();
  const books = allowed.length ? await resolve(allowed, signal) : [];
  signal?.throwIfAborted();
  const presented = books.map(book => book.bookId);
  return { books, ack: { gist: candidate.gist ?? null, presented, skippedUnknown: allowed.filter(id => !presented.includes(id)), skippedScope } };
}
