import type { PluginContext, PluginDetailView, PluginListView, PluginAction, PluginListItem } from "@read-aware/plugin-types";
import { tr } from "./strings";
import { rebuildForm, requestList, startRequest } from "./task-views";
import { textSearchForm } from "./search-views";
import { capturedRangeDetail, rangeSearchForm } from "./range-views";

export async function textDetail(ctx: PluginContext, bookId: string, title: string): Promise<PluginDetailView> {
  const state = await ctx.domains.library!.queries.books.getTextState(bookId);
  const rows = [{ label: tr(ctx.locale, "status"), value: tr(ctx.locale, state.status) },
    { label: tr(ctx.locale, "text"), value: tr(ctx.locale, state.text) },
    { label: tr(ctx.locale, "chapters"), value: String(state.chapterCount) }];
  if (state.progress) rows.push(
    { label: tr(ctx.locale, "sections"), value: `${state.progress.completed} / ${state.progress.total}` },
    { label: tr(ctx.locale, "failed"), value: String(state.progress.failed) },
    { label: tr(ctx.locale, "unsupportedSections"), value: String(state.progress.unsupported) },
  );
  return { kind: "detail", title, content: [{ kind: "keyValue", rows }], actions: [
    { id: "search", label: tr(ctx.locale, "searchBook"), icon: "magnifying-glass", run: () => ({ view: textSearchForm(ctx, bookId) }) },
    { id: "find-passage", label: tr(ctx.locale, "findPassage"), icon: "magnifying-glass", run: () => ({ view: rangeSearchForm(ctx, bookId) }) },
    { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({ view: await textDetail(ctx, bookId, title), navigation: "replace" }) },
    { id: "open", label: tr(ctx.locale, "open"), icon: "book-open", run: async () => {
      await ctx.domains.reading!.commands!.openBook(bookId); return { close: true };
    } },
    { id: "requests", label: tr(ctx.locale, "requests"), icon: "list-bullets", run: async () => ({ view: await requestList(ctx, bookId, title) }) },
    ...(state.status !== "unsupported" ? [
      { id: "prepare", label: tr(ctx.locale, "prepare"), icon: "play", run: () => startRequest(ctx, bookId, title) },
      { id: "rebuild", label: tr(ctx.locale, "rebuild"), icon: "arrows-clockwise", run: () => ({ view: rebuildForm(ctx, bookId, title) }) },
    ] : []),
  ] };
}

/** Limit per-refresh native reads; failed status is a row, not a vanished book. */
export async function textDesk(ctx: PluginContext, page = 0): Promise<PluginListView> {
  const books = await ctx.domains.library!.queries.books.list();
  const index = Math.min(Math.max(0, page), Math.max(0, Math.ceil(books.length / 20) - 1));
  const items: PluginListItem[] = [];
  for (const book of books.slice(index * 20, (index + 1) * 20)) {
    let label: string;
    try { label = tr(ctx.locale, (await ctx.domains.library!.queries.books.getTextState(book.id)).status); }
    catch { label = tr(ctx.locale, "queryError"); } // A visible failed row retains retry through its detail action.
    items.push({ id: book.id, title: book.title, subtitle: `${book.format.toUpperCase()} · ${label}`, icon: "book-open",
      onSelect: async () => ({ view: await textDetail(ctx, book.id, book.title) }) });
  }
  const actions: PluginAction[] = [{ id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise",
    run: async () => ({ view: await textDesk(ctx, index), navigation: "replace" }) }];
  actions.push({ id: "search", label: tr(ctx.locale, "searchShelf"), icon: "magnifying-glass", run: () => ({ view: textSearchForm(ctx) }) });
  actions.push({ id: "selection", label: tr(ctx.locale, "inspectSelection"), icon: "text-aa",
    run: async () => ({ view: await capturedRangeDetail(ctx, (await ctx.domains.reading!.queries.session()).selection?.range) }) });
  for (const direction of [-1, 1]) if (index + direction >= 0 && (index + direction) * 20 < books.length) actions.push({
    id: direction < 0 ? "previous" : "next", label: tr(ctx.locale, direction < 0 ? "previous" : "next"), icon: direction < 0 ? "arrow-left" : "arrow-right",
    run: async () => ({ view: await textDesk(ctx, index + direction), navigation: "replace" }),
  });
  return { kind: "list", title: `${tr(ctx.locale, "title")} · ${index + 1}`, items, actions, emptyText: tr(ctx.locale, "empty") };
}
