import type { PluginAction, PluginFormView, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { selectionView } from "./batch";
import { detailView } from "./detail";
import { exportAnnotations } from "./export";
import { preview, readBooks, subtitle } from "./format";
import { tr } from "./strings";
import type { DeskContext, PageState } from "./types";

async function filterView(ctx: DeskContext, state: PageState): Promise<PluginFormView> {
  const books = await ctx.domains.library.queries.books.list();
  const kinds = ["highlight", "note", "ask"] as const;
  return { kind: "form", title: tr(ctx.locale, "filter"), submitLabel: tr(ctx.locale, "filter"), fields: [
    { kind: "select", id: "bookId", label: tr(ctx.locale, "book"), value: state.bookId ?? "",
      options: [{ value: "", label: tr(ctx.locale, "allBooks") }, ...books.map(book => ({ value: book.id, label: book.title }))] },
    { kind: "select", id: "kind", label: tr(ctx.locale, "kind"), value: state.kind ?? "",
      options: [{ value: "", label: tr(ctx.locale, "all") }, ...kinds.map(value => ({ value, label: tr(ctx.locale, value) }))] },
    { kind: "text", id: "query", label: tr(ctx.locale, "query"), value: state.query ?? "" },
  ], onSubmit: async (values): Promise<PluginViewResult> => {
    if (typeof values.query !== "string" || values.query.length > 500) return { fieldErrors: { query: tr(ctx.locale, "invalidQuery") } };
    const bookId = String(values.bookId ?? "");
    if (bookId && !books.some(book => book.id === bookId)) return { fieldErrors: { bookId: tr(ctx.locale, "invalid") } };
    const kind = kinds.find(kind => kind === values.kind);
    if (values.kind && !kind) return { fieldErrors: { kind: tr(ctx.locale, "invalid") } };
    return { view: await deskView(ctx, { bookId: bookId || undefined, kind, query: values.query.trim() || undefined, previous: [] }), navigation: "reset" };
  } };
}

export async function deskView(ctx: DeskContext, state: PageState = { previous: [] }): Promise<PluginView> {
  const { previous, ...query } = state;
  const page = await ctx.domains.annotations.queries.page({ ...query, limit: 20 });
  const books = await readBooks(ctx, page.items);
  if (state.bookId && !books.has(state.bookId)) books.set(state.bookId, await ctx.domains.library.queries.books.get(state.bookId));
  const refresh = async () => ({ view: await deskView(ctx, { ...state, cursor: undefined, previous: [] }), navigation: "reset" as const });
  const actions: PluginAction[] = [
    { id: "filter", label: tr(ctx.locale, "filter"), icon: "magnifying-glass", run: async () => ({ view: await filterView(ctx, state) }) },
    { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: refresh },
  ];
  if (page.items.length) actions.push(
    { id: "select", label: tr(ctx.locale, "select"), icon: "check", run: () => ({ view: selectionView(ctx, page.items, books, refresh) }) },
    ...(["json", "csv"] as const).map(format => ({ id: format, label: tr(ctx.locale, format === "json" ? "pageJson" : "pageCsv"), icon: "download-simple",
      run: () => exportAnnotations(ctx, page.items, books, "page", format) })),
  );
  if (previous.length) actions.push({ id: "previous", label: tr(ctx.locale, "previous"), icon: "arrow-left", run: async () => ({
    view: await deskView(ctx, { ...state, cursor: previous[previous.length - 1], previous: previous.slice(0, -1) }), navigation: "replace",
  }) });
  if (page.nextCursor) actions.push({ id: "next", label: tr(ctx.locale, "next"), icon: "arrow-right", run: async () => ({
    view: await deskView(ctx, { ...state, cursor: page.nextCursor!, previous: [...previous, state.cursor] }), navigation: "replace",
  }) });
  return { kind: "list", title: [state.bookId ? books.get(state.bookId)?.title ?? tr(ctx.locale, "missingBook") : tr(ctx.locale, "allBooks"),
    state.kind ? tr(ctx.locale, state.kind) : undefined, state.query, String(previous.length + 1)].filter(Boolean).join(" · "), actions,
    emptyText: tr(ctx.locale, "empty"), items: page.items.map(item => ({ id: item.id, title: preview(item) || tr(ctx.locale, item.kind),
      subtitle: subtitle(ctx, item, books), timestamp: item.createdAt, icon: item.kind === "highlight" ? "highlighter" : item.kind === "note" ? "note-pencil" : "chat-circle-dots",
      onSelect: async () => ({ view: await detailView(ctx, item.id, refresh) }) })) };
}
