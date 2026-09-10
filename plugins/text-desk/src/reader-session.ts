import type { PluginContext } from "@read-aware/plugin-types";

export async function ensureReadingSession(ctx: PluginContext, bookId: string) {
  const reading = ctx.domains.reading!, current = await reading.queries.session();
  const session = current.bookId === bookId && current.status === "ready" ? current : await reading.commands!.openBook(bookId);
  return { bookId, sessionId: session.sessionId! };
}
