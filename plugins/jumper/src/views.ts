import type { BookLocationSearch, BookTocEntry, PluginAction, PluginFormView, PluginListView, PluginView, ReadingLocation } from "@read-aware/plugin-types";
import { findChapters } from "./chapters";
import { tr } from "./strings";
import type { JumperContext } from "./types";

async function jump(ctx: JumperContext, location: ReadingLocation) {
  await ctx.domains.reading.commands.goTo(location);
  return { close: true };
}

function chapterResults(ctx: JumperContext, entries: BookTocEntry[]): PluginListView {
  return { kind: "list", items: entries.map(entry => ({
    id: entry.id, title: entry.label || String(entry.ordinal), icon: "book-open",
    subtitle: `${tr(ctx.locale, "ordinal")}: ${entry.ordinal}`,
    ...(entry.location ? { onSelect: () => jump(ctx, entry.location!) } : { subtitle: tr(ctx.locale, "unavailable") }),
  })) };
}

async function textResults(ctx: JumperContext, input: BookLocationSearch): Promise<PluginListView> {
  const page = await ctx.domains.library.queries.books.searchLocations(input);
  return { kind: "list", title: input.query,
    emptyText: tr(ctx.locale, page.nextCursor ? "pending" : page.textStatus === "textless" ? "textless"
      : page.textStatus === "unsupported" || page.textStatus === "partial" ? "unsupported" : "noHits"),
    items: page.hits.map(hit => ({ id: hit.id, title: hit.excerpt.pre + hit.excerpt.match + hit.excerpt.post,
      icon: "magnifying-glass", onSelect: () => jump(ctx, hit.location) })),
    actions: page.nextCursor ? [{ id: "more", label: tr(ctx.locale, "more"), icon: "arrow-right", run: async () => ({
      view: await textResults(ctx, { ...input, contentVersion: page.contentVersion, cursor: page.nextCursor! }),
    }) }] : [],
  };
}

export async function jumperView(ctx: JumperContext): Promise<PluginView> {
  const session = await ctx.domains.reading.queries.session();
  if (!session.bookId) return { kind: "list", items: [], emptyText: tr(ctx.locale, "noBook") };
  const bookId = session.bookId;
  const form: PluginFormView = {
    kind: "form", submitLabel: tr(ctx.locale, "search"), fields: [
      { kind: "choice", id: "mode", label: tr(ctx.locale, "mode"), value: "chapter", options: [
        { value: "chapter", label: tr(ctx.locale, "chapter"), icon: "book-open" },
        { value: "ordinal", label: tr(ctx.locale, "ordinal"), icon: "list-bullets" },
        { value: "text", label: tr(ctx.locale, "text"), icon: "magnifying-glass" },
      ] },
      { kind: "text", id: "query", label: tr(ctx.locale, "query") },
      { kind: "checkbox", id: "matchCase", label: tr(ctx.locale, "matchCase"), value: false, visibleWhen: { field: "mode", equals: "text" } },
      { kind: "checkbox", id: "wholeWords", label: tr(ctx.locale, "wholeWords"), value: false, visibleWhen: { field: "mode", equals: "text" } },
    ],
    onSubmit: async values => {
      const query = String(values.query ?? "").trim();
      if (!query || query.length > 500) return { fieldErrors: { query: tr(ctx.locale, "invalid") } };
      if (values.mode === "text") return { view: await textResults(ctx, { bookId, query, limit: 20,
        matchCase: values.matchCase === true, wholeWords: values.wholeWords === true }) };
      const toc = await ctx.domains.library.queries.books.getNavigationToc(bookId);
      const entries = findChapters(toc.entries, query, values.mode === "ordinal" ? "ordinal" : "chapter");
      if (!entries.length) return { fieldErrors: { query: tr(ctx.locale, "missing") } };
      if (entries.length === 1) return entries[0].location ? jump(ctx, entries[0].location)
        : { fieldErrors: { query: tr(ctx.locale, "unavailable") } };
      return { view: chapterResults(ctx, entries) };
    },
  };
  const actions: PluginAction[] = [];
  const guard = { sessionId: session.sessionId ?? undefined };
  for (const direction of ["back", "forward"] as const) {
    if (!(direction === "back" ? session.history.canGoBack : session.history.canGoForward)) continue;
    actions.push({ id: direction, label: tr(ctx.locale, direction), icon: direction === "back" ? "arrow-left" : "arrow-right",
      run: async () => { await ctx.domains.reading.commands[direction](guard); return { close: true }; } });
  }
  return { kind: "blocks", blocks: [...(actions.length ? [{ kind: "actions" as const, actions }] : []), form] };
}
