import type { PluginContext, PluginDetailView, PluginFormView, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { organizeStrings } from "./organize-strings";

export function mutationDone(ctx: PluginContext, reload: () => Promise<PluginView>): PluginViewResult {
  const t = organizeStrings(ctx.locale);
  return { view: { kind: "detail", title: t.done, content: [], actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await reload(), navigation: "replace" }) },
  ] }, navigation: "replace" };
}

export async function organizeBook(ctx: PluginContext, bookId: string): Promise<PluginDetailView> {
  const library = ctx.domains.library!, t = organizeStrings(ctx.locale);
  const book = await library.queries.books.get(bookId);
  if (!book) return { kind: "detail", title: t.organize, content: [{ kind: "text", text: t.missing }] };
  const reload = () => organizeBook(ctx, bookId);
  const metadata = (): PluginFormView => ({ kind: "form", title: t.metadata,
    fields: [{ kind: "text", id: "title", label: t.title, value: book.title },
      { kind: "text", id: "author", label: t.author, value: book.author ?? "" }], submitLabel: t.save,
    onSubmit: async values => {
      const title = typeof values.title === "string" ? values.title.trim() : "";
      const author = typeof values.author === "string" ? values.author.trim() : "";
      if (!title) return { fieldErrors: { title: t.required } };
      await library.commands!.books.editMetadata(bookId, {
        ...(title === book.title ? {} : { title }), ...(author === (book.author ?? "") ? {} : { author }),
      });
      return mutationDone(ctx, reload);
    },
  });
  return { kind: "detail", title: book.title, content: [{ kind: "keyValue", rows: [
    { label: t.author, value: book.author ?? "" }, { label: t.favorite, value: book.starred ? t.yes : t.no },
  ] }], actions: [
    { id: "metadata", label: t.metadata, icon: "note-pencil", run: () => ({ view: metadata() }) },
    { id: "favorite", label: book.starred ? t.removeFavorite : t.addFavorite, icon: "star", run: async () => {
      await library.commands!.books.setStarred(bookId, !book.starred); return mutationDone(ctx, reload);
    } },
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await reload(), navigation: "replace" }) },
  ] };
}
