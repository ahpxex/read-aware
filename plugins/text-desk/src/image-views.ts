import type { PluginContext, PluginLibraryDomain, PluginListView, PluginView } from "@read-aware/plugin-types";
import { tr } from "./strings";
import { contentPagination } from "./content-pagination";
import { ensureReadingSession } from "./reader-session";

type Books = PluginLibraryDomain["queries"]["books"];
type Source = Parameters<Books["listImages"]>[0];
type Image = Awaited<ReturnType<Books["listImages"]>>["items"][number];

export async function imageList(ctx: PluginContext, source: Source, offsets = [0]): Promise<PluginListView> {
  const page = await ctx.domains.library!.queries.books.listImages({ ...source, offset: offsets[offsets.length - 1], limit: 20 });
  return { kind: "list", title: tr(ctx.locale, "images"), searchable: true,
    emptyText: tr(ctx.locale, page.status === "unsupported" ? "unsupported" : "noImages"),
    items: page.items.map(item => ({ id: String(item.image.index), title: item.alt || `${tr(ctx.locale, "image")} ${item.image.index + 1}`,
      icon: "book-bookmark", onSelect: async () => ({ view: await imageDetail(ctx, item) }),
    })), pagination: contentPagination(offsets, page.nextOffset, next => imageList(ctx, source, next)),
  };
}

export async function imageDetail(ctx: PluginContext, image: Image): Promise<PluginView> {
  const query = { image: image.image }, resources = ctx.services.resources;
  const result = await ctx.domains.library!.queries.books.openImageResource(query);
  const title = image.alt || `${tr(ctx.locale, "image")} ${image.image.index + 1}`;
  if (result.status !== "ready") return { kind: "detail", title,
    content: [{ kind: "text", text: tr(ctx.locale, `image_${result.status}`) }],
  };
  const resource = result.resource;
  return { kind: "detail", title,
    content: [{ kind: "image", resourceId: resource.id, alt: result.image.alt || title }],
    actions: [
      { id: "native-image", label: tr(ctx.locale, "nativeImage"), icon: "arrow-square-out", run: async () => {
        const guard = await ensureReadingSession(ctx, image.image.bookId);
        const receipt = await ctx.services.ui.reader!.image!.open!(query, guard);
        return receipt.status === "opened" ? { close: true } : { toast: tr(ctx.locale, `image_${receipt.reason}`) };
      } },
      { id: "save-image", label: tr(ctx.locale, "saveImage"), icon: "download-simple", run: async () =>
        (await resources.save(resource.id, resource.name)).saved ? { toast: tr(ctx.locale, "imageSaved") } : null },
      { id: "copy-image", label: tr(ctx.locale, "copyImage"), icon: "copy", run: async () => {
        await ctx.services.clipboard!.writeImage(resource.id); return { toast: tr(ctx.locale, "imageCopied") };
      } },
      ...(result.image.location ? [{ id: "open-source", label: tr(ctx.locale, "openPassage"), icon: "book-open", run: async () => {
        await ctx.domains.reading!.commands!.goTo(result.image.location!); return { close: true };
      } }] : []),
    ], onClose: () => resources.release(resource.id),
  };
}
