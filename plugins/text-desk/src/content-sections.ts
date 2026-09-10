import type { PluginContext, PluginListView } from "@read-aware/plugin-types";
import { tr } from "./strings";
import { contentPagination } from "./content-pagination";
import { referenceList } from "./reference-views";
import { imageList } from "./image-views";

export async function contentSections(ctx: PluginContext, bookId: string, title: string,
  kind: "images" | "references", contentVersion?: string, offsets = [0]): Promise<PluginListView> {
  const library = ctx.domains.library!.queries.books;
  const version = contentVersion ?? (await library.getNavigationToc(bookId)).contentVersion;
  const page = await library.listNavigationTargets({ bookId, contentVersion: version, kind: "sections",
    offset: offsets[offsets.length - 1], limit: 20 });
  return { kind: "list", title: `${title} / ${tr(ctx.locale, kind)}`, searchable: true,
    emptyText: tr(ctx.locale, "noSections"), items: page.items.map(item => ({
      id: String(item.index), title: item.label || `${tr(ctx.locale, "sourceSection")} ${item.index + 1}`, icon: "file-text",
      ...(item.sectionIndex === null ? {} : { onSelect: async () => {
        const input = { bookId: page.bookId, contentVersion: page.contentVersion, sectionIndex: item.sectionIndex! };
        return { view: await (kind === "images" ? imageList(ctx, input) : referenceList(ctx, input)) };
      } }),
    })),
    actions: [{ id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise",
      run: async () => ({ view: await contentSections(ctx, bookId, title, kind), navigation: "replace" }) }],
    pagination: contentPagination(offsets, page.nextOffset, next => contentSections(ctx, bookId, title, kind, page.contentVersion, next)),
  };
}
