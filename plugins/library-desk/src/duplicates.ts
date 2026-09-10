import type { PluginContext, PluginDetailView, PluginLibraryDomain, PluginListView, PluginView } from "@read-aware/plugin-types";
import { organizeStrings } from "./organize-strings";
import { organizeBook } from "./organize-books";

type Preview = NonNullable<Awaited<ReturnType<PluginLibraryDomain["queries"]["books"]["previewMerge"]>>>;
type Receipt = Awaited<ReturnType<NonNullable<PluginLibraryDomain["commands"]>["books"]["mergeDuplicates"]>>;

export async function duplicateList(ctx: PluginContext, offset = 0): Promise<PluginListView> {
  const t = organizeStrings(ctx.locale), page = await ctx.domains.library!.queries.books.listDuplicates({ offset, limit: 20 });
  return { kind: "list", title: t.duplicates, emptyText: t.noDuplicates,
    items: page.groups.map(group => ({ id: group.bookId, title: group.title, subtitle: String(group.count), icon: "books",
      onSelect: async () => ({ view: await duplicateReview(ctx, group.bookId) }),
    })), actions: [{ id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await duplicateList(ctx), navigation: "replace" }) }],
    pagination: { page: Math.floor(offset / 20) + 1,
      ...(offset > 0 ? { onPrevious: async () => ({ view: await duplicateList(ctx, Math.max(0, offset - 20)), navigation: "replace" as const }) } : {}),
      ...(page.nextOffset === null ? {} : { onNext: async () => ({ view: await duplicateList(ctx, page.nextOffset!), navigation: "replace" as const }) }),
    },
  };
}

export async function duplicateReview(ctx: PluginContext, bookId: string): Promise<PluginView> {
  const preview = await ctx.domains.library!.queries.books.previewMerge(bookId);
  if (!preview) return duplicateList(ctx);
  const frozen = { revision: preview.revision, keep: { ...preview.keep }, merged: preview.merged.map(member => ({ ...member })) };
  return reviewPage(ctx, frozen, 0);
}

function reviewPage(ctx: PluginContext, preview: Preview, offset: number): PluginDetailView {
  const t = organizeStrings(ctx.locale), bookId = preview.keep.id, expectedRevision = preview.revision;
  return { kind: "detail", title: t.duplicates, content: [
    { kind: "keyValue", rows: [{ label: t.keep, value: `${preview.keep.title}\n${preview.keep.author}\n${bookId}` }] },
    { kind: "list", title: `${t.merge} (${preview.merged.length})`, items: preview.merged.slice(offset, offset + 20).map(member => ({
      id: member.id, title: member.title, subtitle: `${member.author}\n${member.id}`, icon: "book-open",
    })), pagination: { page: Math.floor(offset / 20) + 1, pageCount: Math.ceil(preview.merged.length / 20),
      ...(offset > 0 ? { onPrevious: () => ({ view: reviewPage(ctx, preview, offset - 20), navigation: "replace" as const }) } : {}),
      ...(offset + 20 < preview.merged.length ? { onNext: () => ({ view: reviewPage(ctx, preview, offset + 20), navigation: "replace" as const }) } : {}),
    } },
  ], actions: [
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await duplicateReview(ctx, bookId), navigation: "replace" }) },
    { id: "merge", label: t.merge, icon: "books", variant: "danger", run: () => ({ view: {
      kind: "form", title: `${t.keep}: ${preview.keep.title}`, fields: [{ kind: "checkbox", id: "confirm", label: t.mergeWarning, value: false }],
      submitLabel: t.merge, onSubmit: async values => {
        if (values.confirm !== true) return { fieldErrors: { confirm: t.confirmRequired } };
        const receipt = await ctx.domains.library!.commands!.books.mergeDuplicates({ bookId, expectedRevision });
        return { view: receiptPage(ctx, receipt, 0), navigation: "reset" };
      },
    } }) },
  ] };
}

function receiptPage(ctx: PluginContext, receipt: Receipt, offset: number): PluginListView {
  const t = organizeStrings(ctx.locale);
  return { kind: "list", title: `${t.merged} (${receipt.redirects.length})`,
    items: receipt.redirects.slice(offset, offset + 20).map(redirect => ({ id: redirect.from, title: redirect.from, subtitle: redirect.to, icon: "arrow-right" })),
    actions: [
      { id: "keeper", label: t.openKeeper, icon: "book-open", run: async () => {
        const current = await ctx.domains.library!.queries.books.resolveId(receipt.keepId);
        return { view: current ? await organizeBook(ctx, current) : { kind: "detail", title: t.openKeeper, content: [{ kind: "text", text: t.missing }] } };
      } },
      { id: "duplicates", label: t.duplicates, icon: "books", run: async () => ({ view: await duplicateList(ctx), navigation: "reset" }) },
    ], pagination: { page: Math.floor(offset / 20) + 1, pageCount: Math.max(1, Math.ceil(receipt.redirects.length / 20)),
      ...(offset > 0 ? { onPrevious: () => ({ view: receiptPage(ctx, receipt, offset - 20), navigation: "replace" as const }) } : {}),
      ...(offset + 20 < receipt.redirects.length ? { onNext: () => ({ view: receiptPage(ctx, receipt, offset + 20), navigation: "replace" as const }) } : {}),
    },
  };
}
