import type { AnnotationSnapshot, PluginAnnotation, PluginFormView, PluginView } from "@read-aware/plugin-types";
import { preview, readBooks, subtitle, type Books } from "./format";
import { exportAnnotations } from "./export";
import { colorForm, commit } from "./mutations";
import { tr } from "./strings";
import type { DeskContext, Refresh } from "./types";

export async function reviewView(ctx: DeskContext, snapshots: AnnotationSnapshot[], refresh: Refresh): Promise<PluginView> {
  const items = snapshots.map(snapshot => snapshot.annotation);
  const books = await readBooks(ctx, items);
  return { kind: "blocks", title: `${tr(ctx.locale, "review")} (${items.length})`, blocks: [
    { kind: "list", items: items.map(item => ({ id: item.id, title: preview(item) || tr(ctx.locale, item.kind), subtitle: subtitle(ctx, item, books),
      icon: item.kind === "highlight" ? "highlighter" : item.kind === "note" ? "note-pencil" : "chat-circle-dots" })) },
    { kind: "actions", actions: [
      { id: "json", label: tr(ctx.locale, "json"), icon: "download-simple", run: () => exportAnnotations(ctx, items, books, "selection", "json") },
      { id: "csv", label: tr(ctx.locale, "csv"), icon: "download-simple", run: () => exportAnnotations(ctx, items, books, "selection", "csv") },
      { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: refresh },
    ] },
    ...(items.every(item => item.kind === "highlight") ? [colorForm(ctx, snapshots, refresh)] : []),
    { kind: "form", title: tr(ctx.locale, "remove"), submitLabel: tr(ctx.locale, "remove"),
      fields: [{ kind: "checkbox", id: "confirm", label: tr(ctx.locale, "confirm"), value: false }],
      onSubmit: async values => {
        if (values.confirm !== true) return { fieldErrors: { confirm: tr(ctx.locale, "confirmRequired") } };
        return commit(ctx, snapshots.map(({ annotation, revision }) => ({ op: "remove", annotationId: annotation.id,
          expectedRevision: revision, kind: annotation.kind })), "confirm", refresh);
      } },
  ] };
}

export function selectionView(ctx: DeskContext, items: PluginAnnotation[], books: Books, refresh: Refresh): PluginFormView {
  return { kind: "form", title: tr(ctx.locale, "select"), submitLabel: tr(ctx.locale, "review"),
    fields: items.map((item, index) => ({ kind: "checkbox", id: `item-${index}`, label: preview(item) || tr(ctx.locale, item.kind),
      description: subtitle(ctx, item, books), value: false })),
    onSubmit: async values => {
      const selected = items.filter((_, index) => values[`item-${index}`] === true);
      if (!selected.length) return { fieldErrors: { "item-0": tr(ctx.locale, "choose") } };
      const snapshots: AnnotationSnapshot[] = [];
      for (const item of selected) {
        const snapshot = await ctx.domains.annotations.queries.inspect(item.id);
        if (!snapshot) return { fieldErrors: { [`item-${items.indexOf(item)}`]: tr(ctx.locale, "missing") } };
        snapshots.push(snapshot);
      }
      return { view: await reviewView(ctx, snapshots, refresh) };
    } };
}
