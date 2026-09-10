import type { PluginBook, PluginContext, PluginDetailView, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { assetStrings } from "./assets-strings";

export async function bookAssets(ctx: PluginContext, book: PluginBook): Promise<PluginView> {
  const library = ctx.domains.library!, resources = ctx.services.resources, t = assetStrings(ctx.locale);
  let snapshot = await library.queries.books.getEnrichment(book.id), failure: string | undefined;
  const unavailable = (): PluginViewResult => ({ toast: t.unavailable });
  const saveOriginal = async (): Promise<PluginViewResult> => {
    const resource = await resources.openBook!(book.id);
    if (!resource) return unavailable();
    try { return (await resources.save(resource.id, resource.name)).saved ? { toast: t.saved } : null; }
    finally { await resources.release(resource.id); }
  };
  const cover = async (): Promise<PluginViewResult> => {
    const resource = await resources.openCover!(book.id);
    if (!resource) return unavailable();
    return { view: { kind: "detail", title: book.title,
      content: [{ kind: "image", resourceId: resource.id, alt: book.title, aspectRatio: 2 / 3 }],
      actions: [
        { id: "save-cover", label: t.save, icon: "download-simple", run: async () =>
          (await resources.save(resource.id, resource.name)).saved ? { toast: t.saved } : null },
        { id: "copy-cover", label: t.copy, icon: "copy", run: async () => {
          await ctx.services.clipboard!.writeImage(resource.id); return { toast: t.copied };
        } },
      ], onClose: () => resources.release(resource.id),
    } };
  };
  const content = (): PluginDetailView => ({ kind: "detail", title: book.title,
    content: [
      { kind: "group", blocks: failure ? [{ kind: "error", code: failure }] : [] },
      { kind: "keyValue", rows: [
        { label: t.cover, value: snapshot.cover.local ? t.ready : snapshot.cover.status === "ready" ? t.unavailable : t[snapshot.cover.status] },
        { label: t.source, value: snapshot.sourceLocal ? t.local : t.remote },
        { label: t.enrichment, value: `${snapshot.metadataPending ? t.pending : t.complete} / ${t[snapshot.job.phase]}` },
      ] },
      ...(snapshot.job.errorCode ? [{ kind: "error" as const, code: snapshot.job.errorCode }] : []),
    ], actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await bookAssets(ctx, book), navigation: "replace" }) },
      ...(!failure && snapshot.cover.local ? [{ id: "cover", label: t.preview, icon: "book-bookmark", run: cover }] : []),
      ...(!failure && snapshot.sourceLocal ? [{ id: "export", label: t.export, icon: "download-simple", run: saveOriginal }] : []),
      ...(!failure && snapshot.supported && snapshot.sourceLocal && snapshot.job.phase !== "queued" && snapshot.job.phase !== "running"
        && (snapshot.metadataPending || snapshot.cover.status === "unchecked") ? [{ id: "enrich", label: t.retry, icon: "arrows-clockwise", run: async () => {
          await library.commands!.books.retryEnrichment(book.id);
          return { view: await bookAssets(ctx, book), navigation: "replace" as const };
        } }] : []),
    ],
  });
  return { ...content(), live: { subscribe(channel) {
    let disposed = false, revision = 0;
    const subscription = library.events.observeEnrichment(book.id, async event => {
      if (disposed) return;
      if (event.status === "ready") { snapshot = event.snapshot; failure = undefined; }
      else failure = event.errorCode;
      await ctx.services.ui.publishView(channel, { revision: ++revision, view: content() });
    });
    return { dispose() { disposed = true; subscription.dispose(); } };
  } } };
}
