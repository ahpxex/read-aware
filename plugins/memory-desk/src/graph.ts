import type { BookGraphQuery, PluginAction, PluginContext, PluginFormView, PluginListItem, PluginListView } from "@read-aware/plugin-types";
import { strings } from "./strings";
import { liveMemoryView, type MemoryDeskView } from "./live-memory";
import { graphTasksView, graphTaskWords } from "./tasks";

export function graphSearch(ctx: PluginContext, bookId: string): PluginFormView {
  const t = strings(ctx.locale);
  return { kind: "form", title: t[6], fields: [
    { id: "names", kind: "textarea", label: t[12], value: "" }, { id: "chapter", kind: "text", label: t[13], value: "" },
  ], onSubmit: async values => {
    const names = String(values.names ?? "").split("\n").map(name => name.trim()).filter(Boolean), chapter = String(values.chapter ?? "").trim();
    if ((names.length && chapter) || names.length > 8 || names.some(name => name.length > 256) ||
      (chapter && (!/^\d+$/.test(chapter) || !Number.isSafeInteger(Number(chapter)) || Number(chapter) < 1))) {
      return { fieldErrors: { names: t[14], chapter: t[14] } };
    }
    return { view: await graphView(ctx, bookId, chapter ? { chapterIndex: Number(chapter) - 1 } : names.length ? { names } : {}) };
  } };
}
export async function graphView(ctx: PluginContext, bookId: string, query: BookGraphQuery = {}, profileName?: string): Promise<MemoryDeskView> {
  const t = strings(ctx.locale);
  return liveMemoryView(ctx, { kind: "bookGraph", bookId, query }, t[4], result => {
  if (result.kind !== "bookGraph") throw Error("Unexpected memory observation result");
  const graph = result.graph;
  const actions: PluginAction[] = [
    { id: "tasks", label: graphTaskWords(ctx.locale)[0]!, icon: "list", run: async () => ({ view: await graphTasksView(ctx, bookId) }) },
    { id: "refresh", label: t[7], icon: "arrows-clockwise", run: async () => ({ view: await graphView(ctx, bookId, query, profileName), navigation: "replace" }) },
    { id: "search", label: t[6], icon: "magnifying-glass", run: () => ({ view: graphSearch(ctx, bookId) }) },
  ];
  if (graph.graph === "chapter") {
    return { kind: "detail", title: `${t[23]} ${graph.chapterIndex + 1}`, content: [
      { kind: "text", text: graph.summary },
      { kind: "keyValue", rows: graph.entities.map(entity => ({ label: entity.name, value: entity.note ?? entity.aliases?.join(", ") ?? "" })) },
      { kind: "keyValue", rows: graph.relations.map(edge => ({ label: `${edge.from} / ${edge.to}`, value: `${edge.kind}${edge.note ? `: ${edge.note}` : ""}` })) },
    ], actions: [...actions, { id: "source", label: t[15], icon: "book-open", run: async () => {
      // Recheck the fence before navigating from a potentially stale detail view.
      const current = await ctx.domains.memory!.queries.bookGraph(bookId, { chapterIndex: graph.chapterIndex });
      if (current.graph !== "chapter") return { view: await graphView(ctx, bookId, { chapterIndex: graph.chapterIndex }), navigation: "replace" };
      if (!current.chapterHref) return { view: { kind: "detail", title: t[15], content: [{ kind: "error", code: "reader/target-not-found" }] } };
      await ctx.domains.reading!.commands!.goTo({ bookId, href: current.chapterHref }); return { close: true };
    } }] };
  }
  if (graph.graph === "overview") {
    const list: PluginListView = { kind: "list", title: t[4], searchable: true, actions,
    items: graph.entities.map(entity => ({ id: entity.name, title: entity.name, subtitle: `${t[16]}: ${entity.chapters}`, icon: "brain",
      onSelect: async () => ({ view: await graphView(ctx, bookId, { names: [entity.name] }) }) })),
    emptyText: t[11] };
    return graph.truncated ? { kind: "detail", title: t[4], actions, content: [
      { kind: "text", text: t[19] }, { ...list, actions: undefined },
    ] } : list;
  }
  if (graph.graph === "profiles") {
    if (profileName) {
      const profile = graph.profiles.find(item => item.name === profileName);
      if (!profile) return { kind: "detail", title: profileName, content: [{ kind: "text", text: t[18] }], actions };
      return { kind: "detail", title: profile.name, content: [
        { kind: "text", text: profile.aliases?.join(", ") ?? "" }, { kind: "text", text: profile.note ?? "" },
        { kind: "list", title: t[16], items: profile.appearsInChapters.map(index => ({ id: String(index), title: `${t[23]} ${index + 1}`, icon: "book-open",
          onSelect: async () => ({ view: await graphView(ctx, bookId, { chapterIndex: index }) }) })) },
        { kind: "keyValue", rows: profile.relations.map(edge => ({ label: `${edge.from} / ${edge.to}`, value: `${edge.kind} (${t[23]} ${edge.establishedAt + 1})` })) },
        ...(profile.relationsTruncated ? [{ kind: "text" as const, text: t[19] }] : []),
      ], actions };
    }
    const items: PluginListItem[] = graph.profiles.map(profile => ({ id: profile.name, title: profile.name, subtitle: profile.note, icon: "brain",
      onSelect: async () => ({ view: await graphView(ctx, bookId, { names: [profile.name] }, profile.name) }) }));
    return { kind: "detail", title: t[4], actions, content: [
      { kind: "list", searchable: true, items, emptyText: t[18] },
      ...(graph.notFound.length ? [{ kind: "text" as const, text: `${t[18]}: ${graph.notFound.join(", ")}` }] : []),
      ...(graph.truncated ? [{ kind: "text" as const, text: t[19] }] : []),
    ] };
  }
  return { kind: "detail", title: t[4], actions, content: [{ kind: "text", text: t[graph.graph === "unavailable" ? 9 : graph.graph === "miss" ? 10 : 11] }] };
  });
}
