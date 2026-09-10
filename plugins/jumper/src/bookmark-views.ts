import type { PluginDetailView, PluginDocument, PluginFormView, PluginListView, PluginView } from "@read-aware/plugin-types";
import { bookmarkCollection, bookmarkName, captureBookmark, openBookmark, parseBookmark, removeBookmark, writeBookmark, type Bookmark } from "./bookmarks";
import { bookmarkCopy } from "./bookmark-strings";
import type { JumperContext } from "./types";

function message(ctx: JumperContext, text: string): PluginDetailView {
  const t = bookmarkCopy(ctx.locale);
  return { kind: "detail", title: t.title, content: [{ kind: "text", text }], actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await bookmarksView(ctx), navigation: "reset" }) },
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

export async function bookmarkDetail(ctx: JumperContext, id: string): Promise<PluginDetailView> {
  const doc = await bookmarkCollection(ctx).get(id), t = bookmarkCopy(ctx.locale);
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
}

export async function bookmarksView(ctx: JumperContext, bookId?: string, cursors: (string | undefined)[] = [undefined]): Promise<PluginView> {
  const t = bookmarkCopy(ctx.locale);
  const page = await bookmarkCollection(ctx).page({ bookId, limit: 40, cursor: cursors[cursors.length - 1] });
  if (page.status === "stale-cursor") return message(ctx, t.stale);
  const session = await ctx.domains.reading.queries.session();
  const ready = session.status === "ready" && session.location && session.bookId;
  const next = async (values: (string | undefined)[]) => ({ view: await bookmarksView(ctx, bookId, values), navigation: "replace" as const });
  return { kind: "list", title: t.title, emptyText: t.empty, searchable: true,
    items: page.items.map(doc => {
      const bookmark = parseBookmark(doc.data);
      return { id: doc.id, title: bookmark?.name ?? t.invalid, subtitle: bookmark?.bookTitle, timestamp: doc.updatedAt, icon: "book-bookmark",
        onSelect: async () => ({ view: await bookmarkDetail(ctx, doc.id) }) };
    }), actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: () => next([undefined]) },
      ...(ready ? [{ id: "save-location", label: t.current, icon: "plus", run: async () => ({ view: await saveBookmarkView(ctx, "location") }) },
        ...(session.selection?.range ? [{ id: "save-selection", label: t.selection, icon: "highlighter", run: async () => ({ view: await saveBookmarkView(ctx, "selection") }) }] : [])] : []),
      ...(bookId ? [{ id: "all", label: t.all, icon: "books", run: async () => ({ view: await bookmarksView(ctx), navigation: "replace" as const }) }]
        : ready ? [{ id: "this-book", label: t.thisBook, icon: "book-open", run: async () => ({ view: await bookmarksView(ctx, session.bookId!), navigation: "replace" as const }) }] : []),
    ], pagination: { page: cursors.length,
      ...(cursors.length > 1 ? { onPrevious: () => next(cursors.slice(0, -1)) } : {}),
      ...(page.nextCursor ? { onNext: () => next([...cursors, page.nextCursor!]) } : {}),
    },
  } satisfies PluginListView;
}
