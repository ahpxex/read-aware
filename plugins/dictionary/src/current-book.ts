import type { DictionaryPluginContext } from "./types";

/** Query on demand: activation can happen after a book opened or was renamed. */
export async function currentBookTitle(ctx: DictionaryPluginContext): Promise<string | undefined> {
  const before = await ctx.domains.reading.queries.session();
  if (before.status !== "ready" || !before.bookId || !before.sessionId) return undefined;
  const book = await ctx.domains.library.queries.books.get(before.bookId);
  const after = await ctx.domains.reading.queries.session();
  if (after.status !== "ready" || after.bookId !== before.bookId || after.sessionId !== before.sessionId) return undefined;
  return book?.title;
}
