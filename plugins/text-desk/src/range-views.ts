import type { BookLocationSearch, BookRangeQuery, BookTextRange, PluginContext, PluginDetailView, PluginFormView, PluginListView } from "@read-aware/plugin-types";
import { tr } from "./strings";

export async function capturedRangeDetail(ctx: PluginContext, range?: BookTextRange | null): Promise<PluginDetailView> {
  if (range) return rangeDetail(ctx, { range });
  return { kind: "detail", title: tr(ctx.locale, "passage"), content: [{ kind: "text", text: tr(ctx.locale, "noSourceRange") }] };
}

export function rangeSearchForm(ctx: PluginContext, bookId: string): PluginFormView {
  return { kind: "form", title: tr(ctx.locale, "findPassage"), fields: [
    { kind: "text", id: "query", label: tr(ctx.locale, "passage") },
    { kind: "checkbox", id: "matchCase", label: tr(ctx.locale, "matchCase"), value: false },
    { kind: "checkbox", id: "wholeWords", label: tr(ctx.locale, "wholeWords"), value: false },
  ], submitLabel: tr(ctx.locale, "search"), onSubmit: async values => {
    const query = String(values.query ?? "").trim();
    if (!query || query.length > 500) return { fieldErrors: { query: tr(ctx.locale, "invalidPassage") } };
    return { view: await rangeResults(ctx, { bookId, query, matchCase: values.matchCase === true, wholeWords: values.wholeWords === true, limit: 20 }) };
  } };
}

export async function rangeResults(ctx: PluginContext, input: BookLocationSearch): Promise<PluginListView> {
  const page = await ctx.domains.library!.queries.books.searchLocations(input);
  return { kind: "list", title: input.query,
    emptyText: tr(ctx.locale, page.nextCursor ? "searchPending" : page.textStatus === "available" ? "noPassageMatches"
      : page.textStatus === "textless" ? "textless" : "unsupportedSections"),
    items: page.hits.map(hit => ({ id: hit.id, title: hit.excerpt.pre + hit.excerpt.match + hit.excerpt.post, icon: "magnifying-glass",
      subtitle: `${tr(ctx.locale, "sourceSection")} ${hit.sectionIndex + 1} · ${hit.id}`,
      onSelect: async () => ({ view: await rangeDetail(ctx, { range: hit.range }) }) })),
    actions: page.nextCursor ? [{ id: "next", label: tr(ctx.locale, "next"), icon: "arrow-right",
      run: async () => ({ view: await rangeResults(ctx, { ...input, contentVersion: page.contentVersion, cursor: page.nextCursor! }), navigation: "replace" }) }] : [],
  };
}

export async function rangeDetail(ctx: PluginContext, input: BookRangeQuery): Promise<PluginDetailView> {
  const page = await ctx.domains.library!.queries.books.readRange(input);
  return { kind: "detail", title: tr(ctx.locale, "passage"), content: [
    ...(page.context.before ? [{ kind: "text" as const, text: page.context.before }] : []),
    { kind: "quote", text: page.text, caption: `${page.offset + 1}-${page.offset + page.text.length} / ${page.totalLength}` },
    ...(page.context.after ? [{ kind: "text" as const, text: page.context.after }] : []),
  ], actions: [
    { id: "select-passage", label: tr(ctx.locale, "selectPassage"), icon: "text-aa", run: async () => {
      const reading = ctx.domains.reading!;
      const current = await reading.queries.session();
      const session = current.bookId === page.range.bookId && current.status === "ready"
        ? current : await reading.commands!.openBook(page.range.bookId);
      await reading.commands!.selectRange(page.range, { bookId: page.range.bookId, sessionId: session.sessionId! });
      return { close: true };
    } },
    { id: "open-passage", label: tr(ctx.locale, "openPassage"), icon: "book-open", run: async () => {
      await ctx.domains.reading!.commands!.goTo(page.range); return { close: true };
    } },
    ...(page.nextOffset === null ? [] : [{ id: "next", label: tr(ctx.locale, "next"), icon: "arrow-right",
      run: async () => ({ view: await rangeDetail(ctx, { ...input, range: page.range, offset: page.nextOffset! }), navigation: "replace" as const }) }]),
    { id: "search-again", label: tr(ctx.locale, "findPassage"), icon: "magnifying-glass", run: () => ({ view: rangeSearchForm(ctx, page.range.bookId) }) },
  ] };
}
