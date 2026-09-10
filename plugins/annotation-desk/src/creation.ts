import type { PluginAnnotation, PluginBlock, PluginView, PluginViewResult, SelectionActionInput } from "@read-aware/plugin-types";
import { detailView } from "./detail";
import { tr } from "./strings";
import type { DeskContext, Refresh } from "./types";

function createdView(ctx: DeskContext, item: PluginAnnotation, refresh: Refresh): PluginView {
  return { kind: "detail", title: tr(ctx.locale, "created"), content: [
    { kind: "text", text: item.kind === "note" ? item.body : item.text },
  ], metadata: [{ kind: "label", label: tr(ctx.locale, "kind"), value: tr(ctx.locale, item.kind) }], actions: [
    { id: "inspect-created", label: tr(ctx.locale, "viewCreated"), icon: "note-pencil",
      run: async () => ({ view: await detailView(ctx, item.id, refresh) }) },
    { id: "annotations", label: tr(ctx.locale, "title"), icon: "list-bullets", run: refresh },
  ] };
}

export async function newNoteView(ctx: DeskContext, refresh: Refresh, bookId?: string): Promise<PluginView> {
  const books = bookId ? [await ctx.domains.library.queries.books.get(bookId)].filter(book => book !== null)
    : await ctx.domains.library.queries.books.list();
  if (!books.length) return { kind: "list", title: tr(ctx.locale, "newNote"), items: [], emptyText: tr(ctx.locale, "missingBook") };
  const choices = books.map(book => ({ value: book.id, label: book.title }));
  return { kind: "form", title: tr(ctx.locale, "newNote"), submitLabel: tr(ctx.locale, "save"), fields: [
    { kind: "select", id: "bookId", label: tr(ctx.locale, "book"), value: bookId ?? "",
      options: [{ value: "", label: tr(ctx.locale, "chooseBook") }, ...choices] },
    { kind: "textarea", id: "body", label: tr(ctx.locale, "body"), value: "", rows: 8 },
  ], onSubmit: async (values): Promise<PluginViewResult> => {
    if (!choices.some(book => book.value === values.bookId)) return { fieldErrors: { bookId: tr(ctx.locale, "invalid") } };
    if (typeof values.body !== "string" || !values.body.trim()) return { fieldErrors: { body: tr(ctx.locale, "bodyRequired") } };
    if (values.body.length > 100_000) return { fieldErrors: { body: tr(ctx.locale, "bodyLimit") } };
    const item = await ctx.domains.annotations.commands.createNote({ bookId: values.bookId as string, body: values.body });
    // Show the write receipt first. A subsequent inspection failure must not invite a duplicate create.
    return { view: createdView(ctx, item, refresh), navigation: "replace" };
  } };
}

export function selectionCreationView(ctx: DeskContext, input: SelectionActionInput,
  kind: "note" | "highlight", refresh: Refresh): PluginView {
  const captured = structuredClone(input);
  if (!captured.text.trim() || captured.text.length > 100_000) return {
    kind: "blocks", blocks: [{ kind: "text", text: tr(ctx.locale, "selectionLimit") }],
  };
  const colors = ["yellow", "green", "blue", "pink"] as const;
  const styles = ["highlight", "underline"] as const;
  const content: PluginBlock[] = [{ kind: "quote", text: captured.text }];
  if (!captured.cfiRange) content.push({ kind: "text", text: tr(ctx.locale, "unanchored") });
  content.push({ kind: "form", submitLabel: tr(ctx.locale, "save"), fields: kind === "note"
    ? [{ kind: "textarea", id: "body", label: tr(ctx.locale, "body"), value: "", rows: 8 }]
    : [
      { kind: "choice", id: "color", label: tr(ctx.locale, "color"), value: "yellow",
        options: colors.map(value => ({ value, label: tr(ctx.locale, value) })) },
      { kind: "choice", id: "style", label: tr(ctx.locale, "style"), value: "highlight",
        options: styles.map(value => ({ value, label: tr(ctx.locale, value) })) },
    ], onSubmit: async values => {
    const location = { bookId: captured.book.id, anchor: captured.cfiRange, chapterHref: captured.chapterHref };
    let item: PluginAnnotation;
    if (kind === "note") {
      if (typeof values.body !== "string" || !values.body.trim()) return { fieldErrors: { body: tr(ctx.locale, "bodyRequired") } };
      if (values.body.length > 100_000) return { fieldErrors: { body: tr(ctx.locale, "bodyLimit") } };
      item = await ctx.domains.annotations.commands.createNote({ ...location, quotedText: captured.text, body: values.body });
    } else {
      const color = colors.find(color => color === values.color), style = styles.find(style => style === values.style);
      if (!color || !style) return { fieldErrors: { [!color ? "color" : "style"]: tr(ctx.locale, "invalid") } };
      item = await ctx.domains.annotations.commands.createHighlight({ ...location, text: captured.text, color, style });
    }
    return { view: createdView(ctx, item, refresh), navigation: "replace" };
  } });
  return { kind: "detail", title: tr(ctx.locale, kind === "note" ? "newNote" : "newHighlight"), content,
    metadata: [{ kind: "label", label: tr(ctx.locale, "book"), value: captured.book.title, icon: "book-open" }] };
}
