import type { PluginContext, PluginDetailView, PluginListView, PluginView } from "@read-aware/plugin-types";
import type { ReadingTimeQuery, ReadingTimeSnapshot, ReadingTimeObservation } from "@read-aware/plugin-types";
import { timeCopy } from "./time-strings";
import { timeDuration } from "./time-format";
import { readingInsightsForm } from "./insights-view";
import { insightsCopy } from "./insights-strings";
export { timeDuration } from "./time-format";
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export async function readingTimeView(ctx: PluginContext, query: ReadingTimeQuery = {}): Promise<PluginView> {
  const reading = ctx.domains.reading!, t = timeCopy(ctx.locale);
  let sample = await reading.queries.stats.time({ ...query, limit: 10 });
  const book = query.bookId ? await ctx.domains.library!.queries.books.get(query.bookId) : null;
  const title = book?.title ?? t.allBooks;
  const pendingView = async (after?: ReadingTimeQuery["after"]): Promise<PluginListView> => {
    const page = await reading.queries.stats.time({ ...query, after, limit: 25 });
    return { kind: "list", title: t.pending, emptyText: t.empty,
      items: page.pending.map(bucket => ({ id: `${bucket.bookId}/${bucket.localDay}/${bucket.localHour}`,
        title: `${bucket.localDay} ${String(bucket.localHour).padStart(2, "0")}:00`, subtitle: bucket.bookId,
        accessories: [{ kind: "text", text: timeDuration(bucket.ms) }],
        onSelect: () => ({ view: { kind: "detail", title: t.pending, content: [
          { kind: "text", text: bucket.bookId },
          { kind: "keyValue", rows: [
            { label: t.pending, value: timeDuration(bucket.ms) },
            { label: t.lastActivity, value: new Date(bucket.lastAt).toISOString() },
            { label: t.positionAt, value: bucket.positionAt === null ? t.noPosition : new Date(bucket.positionAt).toISOString() },
          ] },
        ] } }),
      })), actions: [
        { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await pendingView(after), navigation: "replace" }) },
        ...(page.nextCursor ? [{ id: "next", label: t.next, icon: "arrow-right", run: async () => ({ view: await pendingView(page.nextCursor!) }) }] : []),
      ] };
  };
  const content = (snapshot: ReadingTimeSnapshot, failure?: string): PluginDetailView => ({ kind: "detail", title: t.title, content: [
    { kind: "text", text: title },
    ...(failure ? [{ kind: "error" as const, code: failure }, { kind: "text" as const, text: t.lastSuccessful }] : []),
    { kind: "metric", label: t.active, value: timeDuration(snapshot.totalMs) },
    { kind: "keyValue", rows: [
      { label: t.settled, value: timeDuration(snapshot.settledMs) }, { label: t.pending, value: timeDuration(snapshot.pendingMs) },
      { label: t.sampledAt, value: new Date(snapshot.observedAtEpochMs).toISOString() },
      { label: t.day, value: query.localDay ?? t.allTime },
    ] },
  ], actions: [
    { id: "insights", label: insightsCopy(ctx.locale).title, icon: "chart-line-up", run: () => ({ view: readingInsightsForm(ctx, query.bookId) }) },
    { id: "pending", label: t.pending, icon: "clock", run: async () => ({ view: await pendingView() }) },
    { id: "today", label: t.today, icon: "calendar", run: async () => ({ view: await readingTimeView(ctx, { bookId: query.bookId, localDay: today() }), navigation: "replace" }) },
    { id: "all-time", label: t.allTime, icon: "clock", run: async () => ({ view: await readingTimeView(ctx, { bookId: query.bookId }), navigation: "replace" }) },
    ...(query.bookId ? [{ id: "all-books", label: t.allBooks, icon: "books", run: async () => ({ view: await readingTimeView(ctx, { localDay: query.localDay }) }) }] : []),
  ] });
  return { ...content(sample), live: { subscribe(channel) {
    let revision = 0;
    return reading.events.observeTime({ ...query, limit: 10 }, async (event: ReadingTimeObservation) => {
      if (event.status === "ready") sample = event.snapshot;
      await ctx.services.ui.publishView(channel, { revision: ++revision, view: content(sample, event.status === "error" ? event.errorCode : undefined) });
    });
  } } };
}
