import type { PluginDetailView, PluginView } from "@read-aware/plugin-types";
import { REFRESH_SCHEDULE } from "./refresh";
import { scheduleCopy } from "./schedule-strings";
import type { RssPluginContext } from "./types";

function when(time: number | null, locale: string, none: string): string {
  if (time === null) return none;
  const date = new Date(time);
  try { return date.toLocaleString(locale); }
  catch { return date.toISOString(); } // Unknown locale: retain the actual timestamp.
}

export async function refreshScheduleView(ctx: RssPluginContext): Promise<PluginView> {
  const t = scheduleCopy(ctx.locale), query = { limit: 64 };
  let schedule = (await ctx.services.schedules.list(query)).schedules.find(item => item.id === REFRESH_SCHEDULE);
  const render = (): PluginDetailView => {
    const current = schedule;
    const refresh = { id: "refresh", label: t.refresh, icon: "arrows-clockwise",
      run: async () => ({ view: await refreshScheduleView(ctx), navigation: "replace" as const }) };
    if (!current) return { kind: "detail", title: t.title, content: [{ kind: "text", text: t.unavailable }], actions: [refresh] };
    const action = current.paused ? "resume" : "pause";
    return { kind: "detail", title: t.title, content: [
      { kind: "keyValue", rows: [
        { label: t.state, value: current.paused ? t.paused : t.enabled },
        { label: t.interval, value: String(current.everyMinutes) },
        { label: t.attempt, value: current.running ? t.running : current.lastOutcome ? t[current.lastOutcome] : t.none },
        { label: t.started, value: when(current.lastStartedAt, ctx.locale, t.none) },
        { label: t.finished, value: when(current.lastFinishedAt, ctx.locale, t.none) },
        { label: t.succeededAt, value: when(current.lastSuccessAt, ctx.locale, t.none) },
      ] },
      ...(current.lastErrorCode ? [{ kind: "error" as const, code: current.lastErrorCode }] : []),
    ], actions: [
      { id: action, label: t[action], icon: action === "pause" ? "pause" : "play", run: async () => {
        await ctx.services.schedules.control(REFRESH_SCHEDULE, action);
        return { toast: action === "pause" ? t.pausedReceipt : t.resumedReceipt };
      } },
      { id: "run", label: t.run, icon: "arrows-clockwise", run: async () => {
        const result = await ctx.services.schedules.control(REFRESH_SCHEDULE, "run");
        return { toast: result.status === "already-running" ? t.alreadyRunning : t.completed };
      } }, refresh,
    ] };
  };
  return { ...render(), live: { subscribe(channel) {
    let active = true, revision = 0;
    const subscription = ctx.services.schedules.observe(query, async page => {
      if (!active) return;
      schedule = page.schedules.find(item => item.id === REFRESH_SCHEDULE);
      try { await ctx.services.ui.publishView(channel, { revision: ++revision, view: render() }); }
      catch (error) { console.warn("RSS schedule view publication failed", error); }
    });
    return { dispose() { if (!active) return; active = false; subscription.dispose(); } };
  } } };
}
