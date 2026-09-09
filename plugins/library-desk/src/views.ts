import type { PluginContext, PluginBook, PluginDetailView, PluginListView, PluginView, PluginViewChannel } from "@read-aware/plugin-types";
import type { BookFileReleaseReceipt } from "@read-aware/plugin-types";
import { strings, cleanupStrings } from "./strings";
import { workspaceStrings, workspaceView } from "./workspace";

export async function libraryDesk(ctx: PluginContext): Promise<PluginView> {
  const library = ctx.domains.library!, write = library.commands!.books, t = strings(ctx.locale);
  const cleanupText = cleanupStrings(ctx.locale);
  let books = await library.queries.books.list(), channel: PluginViewChannel | undefined, revision = 0, refreshGeneration = 0;
  const selected = new Set<string>();
  const refresh = async () => {
    const generation = ++refreshGeneration;
    const refreshed = await library.queries.books.list();
    if (generation !== refreshGeneration) return null;
    books = refreshed;
    const present = new Set(books.map(book => book.id));
    for (const id of selected) if (!present.has(id)) selected.delete(id);
    if (channel) await ctx.services.ui.publishView(channel, { revision: ++revision, view: content() });
    return null;
  };
  const result = (receipt: BookFileReleaseReceipt, removed: boolean): PluginDetailView => ({
    kind: "detail", title: removed ? t[4] : receipt.files.status === "released" ? t[10] : t[5],
    content: [{ kind: "text", text: receipt.files.status === "released" ? t[10] : t[5] }],
    actions: [
      ...(receipt.files.status === "pending" ? [{ id: "retry", label: t[6], icon: "arrows-clockwise", run: async () => ({
        view: result(await write.retryRemovalCleanup(receipt.bookIds), false), navigation: "replace" as const,
      }) }] : []),
      { id: "library", label: t[11], icon: "books", run: async () => ({ view: await libraryDesk(ctx), navigation: "reset" }) },
    ],
  });
  const review = (chosen: PluginBook[]): PluginDetailView => {
    const ids = chosen.map(book => book.id);
    return { kind: "detail", title: `${t[1]} (${ids.length})`, content: [
      { kind: "text", text: t[3] },
      ...chosen.map((book, index) => ({ kind: "text" as const, text: `${index + 1}. ${book.title}\n${book.author ?? ""}` })),
    ], actions: [{ id: "remove", label: t[2], icon: "trash", variant: "danger", run: async () => {
      const receipt = await write.removeMany(ids);
      selected.clear();
      return { view: result(receipt, true), navigation: "reset" };
    } }] };
  };
  const pendingCleanup = async (after?: string): Promise<PluginListView> => {
    const page = await library.queries.books.listRemovalCleanup({ limit: 50, ...(after ? { after } : {}) });
    return { kind: "list", title: cleanupText[0], searchable: true,
      items: page.items.map(item => ({ id: item.bookId, title: item.title, subtitle: item.bookId, icon: "file-text",
        onSelect: () => ({ view: { kind: "detail", title: cleanupText[0], content: [
          { kind: "text", text: item.title }, { kind: "text", text: item.bookId },
        ], actions: [{ id: "retry", label: t[6], icon: "arrows-clockwise", run: async () => ({
          view: result(await write.retryRemovalCleanup([item.bookId]), false), navigation: "replace",
        }) }] } }),
      })),
      actions: [
        { id: "refresh", label: t[7], icon: "arrows-clockwise", run: async () => ({ view: await pendingCleanup(after), navigation: "replace" }) },
        ...(page.nextCursor ? [{ id: "next", label: cleanupText[1], icon: "arrow-right", run: async () => ({ view: await pendingCleanup(page.nextCursor!) }) }] : []),
      ],
    };
  };
  const content = (): PluginListView => ({ kind: "list", title: `${t[0]} (${selected.size})`, searchable: true,
    items: books.map(book => ({ id: book.id, title: book.title, subtitle: book.author, icon: "book-open",
      accessories: selected.has(book.id) ? [{ kind: "icon", icon: "check", label: t[8] }] : [],
      onSelect: async () => {
        if (selected.has(book.id)) selected.delete(book.id);
        else if (selected.size < 1000) selected.add(book.id);
        else return { toast: t[9] };
        if (channel) await ctx.services.ui.publishView(channel, { revision: ++revision, view: content() });
        return null;
      },
    })),
    actions: [{ id: "refresh", label: t[7], icon: "arrows-clockwise", run: refresh },
      { id: "workspace", label: workspaceStrings(ctx.locale)[0], icon: "books", run: async () => ({ view: await workspaceView(ctx) }) },
      ...(selected.size ? [{ id: "show-selection", label: workspaceStrings(ctx.locale)[7], icon: "arrow-right", run: async () => ({ view: await workspaceView(ctx, books.filter(book => selected.has(book.id))) }) }] : []),
      { id: "cleanup", label: cleanupText[0], icon: "arrows-clockwise", run: async () => ({ view: await pendingCleanup() }) },
      ...(selected.size ? [{ id: "review", label: `${t[1]} (${selected.size})`, icon: "trash", run: () => ({ view: review(books.filter(book => selected.has(book.id))) }) }] : [])],
  });
  return { ...content(), live: { subscribe: async next => {
    channel = next;
    await refresh();
    return { dispose() { if (channel?.id === next.id) { channel = undefined; ++refreshGeneration; } } };
  } } };
}
