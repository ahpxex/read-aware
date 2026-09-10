import type { BookTextRange, PluginContext, PluginListView, PluginDetailView, PluginView, ReadingEmphasisSnapshot } from "@read-aware/plugin-types";
import { ensureReadingSession } from "./reader-session";
import { tr } from "./strings";

export async function markPassages(ctx: PluginContext, ranges: BookTextRange[]) {
  const guard = await ensureReadingSession(ctx, ranges[0].bookId);
  const receipt = await ctx.domains.reading!.commands!.putEmphasis({ ranges }, guard);
  return { view: emphasisDetail(ctx, receipt.emphasis, ranges) };
}

function emphasisDetail(ctx: PluginContext, mark: ReadingEmphasisSnapshot, ranges: BookTextRange[]): PluginDetailView {
  const guard = { bookId: mark.bookId, sessionId: mark.sessionId };
  return { kind: "detail", title: tr(ctx.locale, "temporaryMarks"), content: [{ kind: "keyValue", rows: [
    { label: tr(ctx.locale, "status"), value: tr(ctx.locale, `emphasis_${mark.status}`) },
    { label: tr(ctx.locale, "attachedPassages"), value: `${mark.attached} / ${mark.count}` },
  ] }], actions: [
    { id: "show-mark", label: tr(ctx.locale, "openPassage"), icon: "book-open", run: async () => {
      await ctx.domains.reading!.commands!.goTo(ranges[0]); return { close: true };
    } },
    { id: "style", label: tr(ctx.locale, mark.style === "highlight" ? "underlineMarks" : "highlightMarks"), icon: "text-aa", run: async () => {
      const next = await ctx.domains.reading!.commands!.putEmphasis({ ranges, id: mark.id, expectedRevision: mark.revision,
        style: mark.style === "highlight" ? "underline" : "highlight" }, guard);
      return { view: emphasisDetail(ctx, next.emphasis, ranges), navigation: "replace" };
    } },
    { id: "remove-mark", label: tr(ctx.locale, "removeMarks"), icon: "x", run: async () => {
      await ctx.domains.reading!.commands!.removeEmphasis({ id: mark.id, expectedRevision: mark.revision }, guard);
      return { view: await emphasisList(ctx), navigation: "replace" };
    } },
    { id: "all-marks", label: tr(ctx.locale, "temporaryMarks"), icon: "list-bullets", run: async () => ({ view: await emphasisList(ctx) }) },
  ] };
}

function emphasisSnapshot(ctx: PluginContext, marks: ReadingEmphasisSnapshot[]): PluginListView {
  return { kind: "list", title: tr(ctx.locale, "temporaryMarks"), emptyText: tr(ctx.locale, "noTemporaryMarks"),
    items: marks.map(mark => ({ id: mark.id, title: `${tr(ctx.locale, "passage")} · ${mark.count}`,
      subtitle: `${tr(ctx.locale, `emphasis_${mark.status}`)} · ${mark.attached} / ${mark.count}`, icon: "text-aa",
      actions: [{ id: "remove", label: tr(ctx.locale, "removeMarks"), icon: "x", run: async () => {
        await ctx.domains.reading!.commands!.removeEmphasis({ id: mark.id, expectedRevision: mark.revision }, { bookId: mark.bookId, sessionId: mark.sessionId });
        return { view: await emphasisList(ctx), navigation: "replace" };
      } }],
    })), actions: [{ id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise",
      run: async () => ({ view: await emphasisList(ctx), navigation: "replace" }) }] };
}
export async function emphasisList(ctx: PluginContext): Promise<PluginListView & Pick<PluginView, "live">> {
  return { ...emphasisSnapshot(ctx, await ctx.domains.reading!.queries.emphasis()), live: { subscribe: channel => {
    let revision = 0;
    return ctx.domains.reading!.events.observeEmphasis(async marks => {
      await ctx.services.ui.publishView(channel, { revision: ++revision, view: emphasisSnapshot(ctx, marks) });
    });
  } } };
}
