import type { PluginContext, PluginDetailView, PluginLibraryDomain, PluginListView } from "@read-aware/plugin-types";
import { tr } from "./strings";
import { contentPagination } from "./content-pagination";
import { ensureReadingSession } from "./reader-session";

type Books = PluginLibraryDomain["queries"]["books"];
type Source = Parameters<Books["listReferences"]>[0];
type Reference = Parameters<Books["readReference"]>[0]["reference"];

export async function referenceList(ctx: PluginContext, source: Source, offsets = [0]): Promise<PluginListView> {
  const page = await ctx.domains.library!.queries.books.listReferences({ ...source, offset: offsets[offsets.length - 1], limit: 20 });
  return { kind: "list", title: tr(ctx.locale, "references"), searchable: true,
    emptyText: tr(ctx.locale, page.status === "unsupported" ? "unsupported" : "noReferences"),
    items: page.items.map(item => ({ id: String(item.reference.index), title: item.label || `${tr(ctx.locale, "reference")} ${item.reference.index + 1}`,
      icon: item.kind === "inline-note" ? "note-pencil" : "link",
      onSelect: async () => ({ view: await referenceDetail(ctx, item.reference) }),
    })),
    pagination: contentPagination(offsets, page.nextOffset, next => referenceList(ctx, source, next)),
  };
}

export async function referenceDetail(ctx: PluginContext, reference: Reference, offsets = [0]): Promise<PluginDetailView> {
  const input = { reference, offset: offsets[offsets.length - 1], limit: 4000 };
  const preview = await ctx.domains.library!.queries.books.readReference(input);
  const pagination = contentPagination(offsets, preview.nextOffset, next => referenceDetail(ctx, preview.reference, next));
  return { kind: "detail", title: preview.label || tr(ctx.locale, "reference"), content: [
    { kind: "text", text: tr(ctx.locale, `reference_${preview.status}`) },
    ...(preview.text ? [{ kind: "quote" as const, text: preview.text,
      caption: `${preview.offset + 1}-${preview.offset + preview.text.length} / ${preview.totalLength}` }] : []),
    ...(preview.url ? [{ kind: "text" as const, text: preview.url }] : []),
  ], actions: [
    ...(preview.location ? [{ id: "open-source", label: tr(ctx.locale, "openPassage"), icon: "book-open", run: async () => {
      await ctx.domains.reading!.commands!.goTo(preview.location!); return { close: true };
    } }] : []),
    ...(preview.status === "resolved" ? [{ id: "native-preview", label: tr(ctx.locale, "nativeReference"), icon: "note-pencil", run: async () => {
      const guard = await ensureReadingSession(ctx, reference.bookId);
      const receipt = await ctx.services.ui.reader!.previewReference!(input, guard);
      return receipt.status === "opened" ? { close: true } : { toast: tr(ctx.locale, `reference_${receipt.preview.status}`) };
    } }] : []),
    ...(pagination.onPrevious ? [{ id: "previous", label: tr(ctx.locale, "previous"), icon: "arrow-left", run: pagination.onPrevious }] : []),
    ...(pagination.onNext ? [{ id: "next", label: tr(ctx.locale, "next"), icon: "arrow-right", run: pagination.onNext }] : []),
  ] };
}
