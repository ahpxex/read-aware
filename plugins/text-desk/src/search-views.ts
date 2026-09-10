import type { BookTextHit, PluginContext, PluginDetailView, PluginFormView, PluginListView } from "@read-aware/plugin-types";
import { tr } from "./strings";
import { textSearchTask } from "./search-task";

export function textSearchForm(ctx: PluginContext, bookId?: string): PluginFormView {
  return { kind: "form", title: tr(ctx.locale, bookId ? "searchBook" : "searchShelf"),
    fields: [{ kind: "textarea", id: "queries", label: tr(ctx.locale, "variants"), value: "" }],
    submitLabel: tr(ctx.locale, "search"), onSubmit: async values => {
      const queries = String(values.queries ?? "").split("\n").map(query => query.trim()).filter(Boolean);
      if (!queries.length || queries.length > 12 || queries.some(query => query.length > 1024)) {
        return { fieldErrors: { queries: tr(ctx.locale, "invalidQueries") } };
      }
      return { view: textSearchTask(ctx, { queries, bookId, limit: 40 }, hits => textSearchResults(ctx, hits)) };
    } };
}

async function textSearchResults(ctx: PluginContext, hits: BookTextHit[]): Promise<PluginListView> {
  const books = new Map((await ctx.domains.library!.queries.books.list()).map(book => [book.id, book]));
  return { kind: "list", title: tr(ctx.locale, "searchResults"), emptyText: tr(ctx.locale, "noMatches"),
    items: hits.map(hit => ({ id: `${hit.bookId}:${hit.chapterIndex}:${hit.offset}`,
      title: books.get(hit.bookId)?.title ?? tr(ctx.locale, "unavailable"),
      icon: "book-open",
      subtitle: `${tr(ctx.locale, hit.match === "exact" ? "exactMatch" : "partialMatch")} · ${hit.chapterTitle ?? String(hit.chapterIndex + 1)}`,
      onSelect: () => ({ view: hitDetail(ctx, hit, books.get(hit.bookId)?.title ?? tr(ctx.locale, "unavailable")) }),
    })) };
}

function hitDetail(ctx: PluginContext, hit: BookTextHit, title: string): PluginDetailView {
  return { kind: "detail", title, content: [{ kind: "text", text: hit.snippet }], actions: [
    { id: "open", label: tr(ctx.locale, "open"), icon: "book-open", run: async () => {
      await ctx.domains.reading!.commands!.openBook(hit.bookId); return { close: true };
    } },
    { id: "search-book", label: tr(ctx.locale, "searchBook"), icon: "magnifying-glass", run: () => ({ view: textSearchForm(ctx, hit.bookId) }) },
  ] };
}
