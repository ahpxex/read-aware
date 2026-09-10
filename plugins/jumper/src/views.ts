import type { BookTocEntry, PluginAction, PluginFormView, PluginListView, PluginView, ReadingLocation } from "@read-aware/plugin-types";
import { findChapters } from "./chapters";
import { tr } from "./strings";
import type { JumperContext } from "./types";
import { textSearchView } from "./text-search";

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
      if (values.mode === "text") return { view: textSearchView(ctx, { bookId, query, limit: 20,
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
