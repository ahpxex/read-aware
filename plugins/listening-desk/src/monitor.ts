import type { PluginBlock, PluginContext, PluginDisposable, PluginView } from "@read-aware/plugin-types";
import { monitorCopy } from "./monitor-strings";
import { panelWidths } from "./panel-widths";
import { tr } from "./strings";

export async function readingMonitor(ctx: PluginContext, signal: AbortSignal): Promise<PluginView> {
  signal.throwIfAborted();
  const reading = ctx.domains.reading!, reader = ctx.services.ui.reader!, t = monitorCopy(ctx.locale);
  let session = await reading.queries.session();
  let environment = await ctx.services.session.environment();
  let panels = await reader.snapshot();
  signal.throwIfAborted();
  const render = (): PluginView => {
    const playback = session.playback, mode = session.mode;
    const matching = panels?.sessionId === session.sessionId && panels?.bookId === session.bookId ? panels : null;
    const errors = [...new Set([session.errorCode, mode.errorCode, playback.errorCode].filter((code): code is string => Boolean(code)))];
    const content: PluginBlock[] = [
      ...errors.map(code => ({ kind: "error" as const, code })),
      { kind: "keyValue", rows: [
        { label: t.reader, value: t[session.status] },
        { label: t.mode, value: mode.status === "unavailable" ? t.unknown : mode.status === "error" ? t.modeError : t[mode.status] },
        { label: tr(ctx.locale, "title"), value: tr(ctx.locale, playback.status) },
        { label: t.network, value: environment.networkHint === "unknown" ? t.networkUnknown : t[environment.networkHint] },
        { label: t.layoutMode, value: matching ? t[matching.layout] : t.unknown },
      ] },
      ...(playback.unavailableReason ? [{ kind: "text" as const, text: tr(ctx.locale, playback.unavailableReason) }] : []),
      ...(playback.backend ? [{ kind: "text" as const, text: tr(ctx.locale, playback.fallback ? "fallback" : playback.backend) }] : []),
    ];
    if (["preparing", "advancing"].includes(playback.status)) content.push({ kind: "progress", value: null, label: tr(ctx.locale, playback.status) });
    if (mode.progress && mode.progress.total > 0) content.push({ kind: "keyValue", rows: [{ label: t.progress, value: `${mode.progress.ordinal + 1} / ${mode.progress.total}` }] });
    if (matching) content.push({ kind: "heading", text: t.panels }, { kind: "keyValue", rows:
      (["toc", "chat", "annotations", "appearance"] as const).map(panel => ({ label: tr(ctx.locale, panel),
        value: `${matching.panels[panel].open ? t.open : t.closed} / ${matching.panels[panel].visible ? t.visible : t.hidden}` })),
    });
    const busy = ["preparing", "playing", "advancing"].includes(playback.status);
    const ready = session.status === "ready" && session.sessionId && session.bookId;
    const guard = { sessionId: session.sessionId ?? undefined, bookId: session.bookId ?? undefined };
    const action = busy ? "stop" : "start";
    return { kind: "detail", title: t.title, content, actions: [
      ...(ready && reading.commands && (busy || !playback.unavailableReason) ? [{ id: action, label: tr(ctx.locale, action), icon: busy ? "stop" : "play",
        run: async () => { signal.throwIfAborted(); await reading.commands!.controlPlayback(action, guard, { signal }); },
      }] : []),
      ...(ready && matching && reader.setWidth ? [{ id: "widths", label: t.layout, icon: "rows", run: async () => ({ view: await panelWidths(ctx, signal) }) }] : []),
      { id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: async () => ({ view: await readingMonitor(ctx, signal), navigation: "replace" as const }) },
    ] };
  };
  return { ...render(), live: { subscribe(channel) {
    signal.throwIfAborted();
    let active = true, revision = 0;
    const subscriptions: PluginDisposable[] = [];
    const dispose = () => {
      if (!active) return;
      active = false;
      signal.removeEventListener("abort", dispose);
      for (const subscription of subscriptions) subscription.dispose();
    };
    const publish = async () => {
      if (!active || signal.aborted) return;
      try { await ctx.services.ui.publishView(channel, { revision: ++revision, view: render() }); }
      catch (error) {
        const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "ipc/unknown";
        try { await ctx.services.logging.write({ level: "warn", event: "listening-view-publish-failed", errorCode: code }); }
        catch { /* Host retirement may reject logging as well; reopening reads a fresh snapshot. */ }
      }
    };
    try {
      subscriptions.push(reading.events.observeSession(value => { session = value; return publish(); }));
      subscriptions.push(ctx.services.session.observeEnvironment(value => { environment = value; return publish(); }));
      subscriptions.push(reader.observe(value => { panels = value; return publish(); }));
      signal.addEventListener("abort", dispose, { once: true });
      if (signal.aborted) dispose();
      return { dispose };
    } catch (error) { dispose(); throw error; }
  } } };
}
