import type { PluginContext, PluginView, PluginDetailView, ReadingInsights, ReadingInsightsQuery, ReadingPeriod } from "@read-aware/plugin-types";
import { insightsCopy } from "./insights-strings";
import { timeDuration } from "./time-format";
import { timeCopy } from "./time-strings";

const periods: ReadingPeriod[] = ["week", "month", "year", "all"];
export function readingInsightsForm(ctx: PluginContext, bookId?: string): PluginView {
  const t = insightsCopy(ctx.locale);
  return { kind: "form", title: t.title, submitLabel: t.open, fields: [
    { kind: "choice", id: "period", label: t.period, value: "week", options: periods.map(value => ({ value, label: t[value] })) },
  ], onSubmit: async values => ({ view: await readingInsightsView(ctx, { bookId, period: values.period as ReadingPeriod }) }) };
}

export async function readingInsightsView(ctx: PluginContext, query: ReadingInsightsQuery): Promise<PluginView> {
  const t = insightsCopy(ctx.locale), reading = ctx.domains.reading!;
  let sample = await reading.queries.stats.insights(query);
  const detail = (data: ReadingInsights, code?: string): PluginDetailView => ({ kind: "detail", title: t.title, content: [
    { kind: "text", text: t[data.period] },
    ...(code ? [{ kind: "error" as const, code }, { kind: "text" as const, text: timeCopy(ctx.locale).lastSuccessful }] : []),
    { kind: "metric", label: t.total, value: timeDuration(data.totalMs) },
    { kind: "keyValue", rows: [{ label: t.reference, value: data.asOfDay }, { label: t.days, value: String(data.daysRead) },
      { label: t.books, value: String(data.booksRead) }, { label: t.average, value: timeDuration(data.avgPerDayMs) },
      { label: t.change, value: data.deltaRatio === null ? t.none : `${(data.deltaRatio * 100).toFixed(1)}%` }] },
  ], actions: [
    { id: "dates", label: t.dates, icon: "calendar", run: () => ({ view: { kind: "list", title: t.dates,
      items: data.bars.map(bar => ({ id: bar.key, title: bar.key, accessories: [{ kind: "text", text: timeDuration(bar.ms) }] })) } }) },
    { id: "hours", label: t.hours, icon: "clock", run: () => ({ view: { kind: "list", title: t.hours,
      items: data.allTimeHourlyMs.map((ms, hour) => ({ id: String(hour), title: `${String(hour).padStart(2, "0")}:00`,
        accessories: [{ kind: "text", text: timeDuration(ms) }] })) } }) },
    { id: "achievements", label: t.achievements, icon: "chart-line-up", run: () => ({ view: { kind: "detail", title: t.achievements,
      content: [{ kind: "keyValue", rows: [
        { label: t.total, value: timeDuration(data.achievements.totalMs) },
        { label: t.streak, value: String(data.achievements.currentStreak) },
        { label: t.longest, value: String(data.achievements.longestStreak) },
        { label: t.best, value: data.achievements.bestDayKey ? `${data.achievements.bestDayKey}: ${timeDuration(data.achievements.bestDayMs)}` : t.none },
        { label: t.next, value: data.achievements.nextMilestoneMs === null ? t.none : timeDuration(data.achievements.nextMilestoneMs) },
      ] }] } }) },
    { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await readingInsightsView(ctx, query), navigation: "replace" }) },
  ] });
  return { ...detail(sample), live: { subscribe(channel) {
    let disposed = false, revision = 0, dirty = false, running: Promise<void> | undefined;
    const refresh = (): Promise<void> => {
      dirty = true;
      if (running) return running;
      running = (async () => {
        while (dirty && !disposed) {
          dirty = false; let code: string | undefined;
          try { sample = await reading.queries.stats.insights(query); }
          catch (error) { code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "reading/stats-unavailable"; }
          if (!disposed) await ctx.services.ui.publishView(channel, { revision: ++revision, view: detail(sample, code) });
        }
      })().catch(error => { console.warn("Reading trends publication failed", error); }).finally(() => { running = undefined; });
      return running;
    };
    const subscriptions = ["book.sessionRecorded", "book.timeRecorded"].map(type => reading.events.subscribe(type as "book.sessionRecorded" | "book.timeRecorded", event => {
      if (!query.bookId || event.payload.bookId === query.bookId) void refresh();
    }));
    void refresh();
    return { dispose() { disposed = true; subscriptions.forEach(subscription => subscription.dispose()); } };
  } } };
}
