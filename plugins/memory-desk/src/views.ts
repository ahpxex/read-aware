import type { MemoryScope, PluginContext, PluginFormView, PluginListView } from "@read-aware/plugin-types";
import { graphView } from "./graph";
import { strings } from "./strings";
import { memoryDetail } from "./management";

export async function memoryDesk(ctx: PluginContext): Promise<PluginListView> {
  const t = strings(ctx.locale);
  return { kind: "list", title: t[0], items: [
    { id: "user", title: t[1], icon: "brain", onSelect: async () => ({ view: await memories(ctx, "user") }) },
    { id: "global", title: t[2], icon: "brain", onSelect: async () => ({ view: await memories(ctx, "global") }) },
    { id: "books", title: t[3], icon: "books", onSelect: async () => ({ view: await booksView(ctx) }) },
  ] };
}
export async function booksView(ctx: PluginContext, page = 0): Promise<PluginListView> {
  const t = strings(ctx.locale), books = await ctx.domains.library!.queries.books.list();
  const current = Math.min(Math.max(page, 0), Math.max(0, Math.ceil(books.length / 40) - 1));
  return { kind: "list", title: t[3], searchable: true,
    items: books.slice(current * 40, (current + 1) * 40).map(book => ({ id: book.id, title: book.title, subtitle: book.author, icon: "book-open",
      onSelect: async () => ({ view: { kind: "list", title: book.title, items: [
        { id: "graph", title: t[4], icon: "brain", onSelect: async () => ({ view: await graphView(ctx, book.id) }) },
        { id: "memory", title: t[5], icon: "brain", onSelect: async () => ({ view: await memories(ctx, `book:${book.id}`) }) },
      ] } }) })), actions: [
      { id: "refresh", label: t[7], icon: "arrows-clockwise", run: async () => ({ view: await booksView(ctx, current), navigation: "replace" }) },
      ...[-1, 1].filter(direction => current + direction >= 0 && (current + direction) * 40 < books.length).map(direction => ({
        id: direction < 0 ? "previous" : "next", label: t[direction < 0 ? 20 : 21], icon: direction < 0 ? "arrow-left" : "arrow-right",
        run: async () => ({ view: await booksView(ctx, current + direction), navigation: "replace" as const }),
      })),
    ] };
}
export async function memories(ctx: PluginContext, scope: MemoryScope, query?: string): Promise<PluginListView> {
  const t = strings(ctx.locale), rows = await ctx.domains.memory!.queries.search({ scopes: [scope], query, limit: 100 });
  return { kind: "list", title: t[scope === "user" ? 1 : scope === "global" ? 2 : 5], searchable: true, emptyText: t[8],
    items: rows.map(row => ({ id: row.id, title: row.content, subtitle: row.updatedAt, icon: "brain",
      onSelect: async () => ({ view: await memoryDetail(ctx, row.id, () => memories(ctx, scope, query)) }) })), actions: [
      { id: "refresh", label: t[7], icon: "arrows-clockwise", run: async () => ({ view: await memories(ctx, scope, query), navigation: "replace" }) },
      { id: "search", label: t[6], icon: "magnifying-glass", run: () => ({ view: { kind: "form", title: t[6], fields: [
        { id: "query", kind: "text", label: t[22], value: query ?? "" },
      ], onSubmit: async values => {
        const value = String(values.query ?? "");
        if (value.length > 2000) return { fieldErrors: { query: t[19] } };
        return { view: await memories(ctx, scope, value) };
      } } satisfies PluginFormView }) },
    ] };
}
