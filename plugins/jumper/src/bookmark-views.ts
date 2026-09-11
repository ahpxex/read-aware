import type { PluginDetailView, PluginDocument, PluginFormView, PluginListView, PluginView } from "@read-aware/plugin-types";
import { BOOKMARKS, bookmarkCollection, bookmarkName, bookmarkSearchQuery, captureBookmark, openBookmark, parseBookmark, removeBookmark, writeBookmark, type Bookmark } from "./bookmarks";
import { bookmarkCopy } from "./bookmark-strings";
import type { JumperContext } from "./types";
import { liveBookmarks, type BookmarkReadView } from "./live-bookmarks";
import { tr } from "./strings";

function message(ctx: JumperContext, text: string, refresh = () => bookmarksView(ctx)): PluginDetailView {
  const t = bookmarkCopy(ctx.locale);
  return { kind: "detail", title: t.title, content: [{ kind: "text", text }], actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await refresh(), navigation: "reset" }) },
  ] };
}

function nameForm(ctx: JumperContext, data: Bookmark, id: string, expectedRevision: string | null): PluginFormView {
  const t = bookmarkCopy(ctx.locale);
  return { kind: "form", title: data.bookTitle, submitLabel: expectedRevision === null ? t.save : t.rename,
    fields: [{ id: "name", kind: "text", label: t.name, value: data.name }], onSubmit: async values => {
      const name = bookmarkName(values.name);
      if (!name) return { fieldErrors: { name: t.invalidName } };
      const receipt = await writeBookmark(ctx, id, { ...data, name }, expectedRevision);
      return { view: message(ctx, receipt.status === "conflict" ? t.conflict : expectedRevision === null ? t.saved : t.renamed), navigation: "replace" };
    } };
}

export async function saveBookmarkView(ctx: JumperContext, kind: Bookmark["kind"]): Promise<PluginView> {
  const data = await captureBookmark(ctx, kind), t = bookmarkCopy(ctx.locale);
  return { kind: "blocks", blocks: [
    { kind: "text", text: kind === "selection" ? t.range : t.location },
    nameForm(ctx, data, crypto.randomUUID(), null),
  ] };
}

function deleteForm(ctx: JumperContext, doc: PluginDocument): PluginFormView {
  const t = bookmarkCopy(ctx.locale), bookmark = parseBookmark(doc.data);
  return { kind: "form", title: bookmark?.name ?? t.invalid, submitLabel: t.remove,
    fields: [{ id: "confirm", kind: "checkbox", label: t.confirm, value: false }], onSubmit: async values => {
      if (values.confirm !== true) return { fieldErrors: { confirm: t.required } };
      const receipt = await removeBookmark(ctx, doc);
      return { view: message(ctx, receipt.status === "conflict" ? t.conflict : t.removed), navigation: "replace" };
    } };
}

export async function bookmarkDetail(ctx: JumperContext, id: string): Promise<BookmarkReadView> {
  const t = bookmarkCopy(ctx.locale);
  return liveBookmarks(ctx, { kind: "get", collection: BOOKMARKS, id },
    async () => ({ kind: "get", document: await bookmarkCollection(ctx).get(id) }), async result => {
  if (result.kind !== "get") throw Error("Expected bookmark document");
  const doc = result.document;
  if (!doc) return message(ctx, t.missing);
  const bookmark = parseBookmark(doc.data);
  return { kind: "detail", title: bookmark?.name ?? t.invalid,
    content: bookmark ? [{ kind: "keyValue", rows: [
      { label: t.book, value: bookmark.bookTitle }, { label: t.kind, value: bookmark.kind === "selection" ? t.range : t.location },
      { label: t.version, value: bookmark.target.contentVersion },
    ] }] : [{ kind: "text", text: t.invalid }], actions: [
      ...(bookmark ? [
        { id: "open", label: t.open, icon: "arrow-right", run: () => openBookmark(ctx, bookmark) },
        { id: "rename", label: t.rename, icon: "pencil-simple", run: () => ({ view: nameForm(ctx, bookmark, doc.id, doc.revision) }) },
      ] : []),
      { id: "remove", label: t.remove, icon: "trash", run: () => ({ view: deleteForm(ctx, doc) }) },
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await bookmarkDetail(ctx, id), navigation: "replace" }) },
    ] };
  });
}

export async function bookmarksView(ctx: JumperContext, bookId?: string, cursors: (string | undefined)[] = [undefined], query?: string): Promise<PluginView> {
  const t = bookmarkCopy(ctx.locale);
  const filter = { bookId, limit: 40, cursor: cursors[cursors.length - 1], ...(query ? { query } : {}) };
  return liveBookmarks(ctx, { kind: "page", collection: BOOKMARKS, filter },
    async () => ({ kind: "page", page: await bookmarkCollection(ctx).page(filter) }), async result => {
  if (result.kind !== "page") throw Error("Expected bookmark page");
  const page = result.page;
  if (page.status === "stale-cursor") return message(ctx, t.stale, () => bookmarksView(ctx, bookId, [undefined], query));
  const session = await ctx.domains.reading.queries.session();
  const ready = session.status === "ready" && session.location && session.bookId;
  const next = async (values: (string | undefined)[]) => ({ view: await bookmarksView(ctx, bookId, values, query), navigation: "replace" as const });
  return { kind: "list", title: t.title, emptyText: query ? tr(ctx.locale, "noHits") : t.empty,
    items: page.items.map(doc => {
      const bookmark = parseBookmark(doc.data);
      return { id: doc.id, title: bookmark?.name ?? t.invalid, subtitle: bookmark?.bookTitle, timestamp: doc.updatedAt, icon: "book-bookmark",
        onSelect: async () => ({ view: await bookmarkDetail(ctx, doc.id) }) };
    }), actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: () => next([undefined]) },
      { id: "search", label: tr(ctx.locale, "search"), icon: "magnifying-glass", run: () => ({ view: {
        kind: "form", title: t.title, submitLabel: tr(ctx.locale, "search"),
        fields: [{ kind: "text", id: "query", label: tr(ctx.locale, "searchQuery"), value: query ?? "" }],
        onSubmit: async values => {
          const search = bookmarkSearchQuery(values.query);
          if (search === null) return { fieldErrors: { query: tr(ctx.locale, "invalidSearch") } };
          return { view: await bookmarksView(ctx, bookId, [undefined], search || undefined), navigation: "replace" };
        },
      } satisfies PluginFormView }) },
      ...(query ? [{ id: "clear-search", label: tr(ctx.locale, "clearSearch"), icon: "x", run: async () => ({ view: await bookmarksView(ctx, bookId), navigation: "replace" as const }) }] : []),
      ...(ready ? [{ id: "save-location", label: t.current, icon: "plus", run: async () => ({ view: await saveBookmarkView(ctx, "location") }) },
        ...(session.selection?.range ? [{ id: "save-selection", label: t.selection, icon: "highlighter", run: async () => ({ view: await saveBookmarkView(ctx, "selection") }) }] : [])] : []),
      ...(bookId ? [{ id: "all", label: t.all, icon: "books", run: async () => ({ view: await bookmarksView(ctx, undefined, [undefined], query), navigation: "replace" as const }) }]
        : ready ? [{ id: "this-book", label: t.thisBook, icon: "book-open", run: async () => ({ view: await bookmarksView(ctx, session.bookId!, [undefined], query), navigation: "replace" as const }) }] : []),
    ], pagination: { page: cursors.length,
      ...(cursors.length > 1 ? { onPrevious: () => next(cursors.slice(0, -1)) } : {}),
      ...(page.nextCursor ? { onNext: () => next([...cursors, page.nextCursor!]) } : {}),
    },
  } satisfies PluginListView;
  });
}
