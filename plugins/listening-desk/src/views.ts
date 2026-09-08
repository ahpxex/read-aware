import type { PluginContext, PluginAction, PluginView } from "@read-aware/plugin-types";
import { tr } from "./strings";

export async function listeningView(ctx: PluginContext): Promise<PluginView> {
  const reading = ctx.domains.reading;
  if (!reading?.commands) throw new Error("Listening Desk requires reading:write");
  const state = await reading.queries.session();
  const playback = state.playback;
  const guard = { sessionId: state.sessionId ?? undefined, bookId: state.bookId ?? undefined };
  const refresh = async () => ({ view: await listeningView(ctx), navigation: "replace" as const });
  const actions: PluginAction[] = [];
  if (state.status === "ready" && state.sessionId) {
    if (["preparing", "playing", "advancing"].includes(playback.status)) {
      actions.push({ id: "stop", label: tr(ctx.locale, "stop"), icon: "stop", run: async () => {
        await reading.commands!.controlPlayback("stop", guard); return refresh();
      } });
    } else if (!playback.unavailableReason) {
      actions.push({ id: "start", label: tr(ctx.locale, "start"), icon: "play", run: async () => {
        await reading.commands!.controlPlayback("start", guard); return refresh();
      } });
    }
    for (const direction of ["back", "forward"] as const) {
      if (!(direction === "back" ? state.history.canGoBack : state.history.canGoForward)) continue;
      actions.push({ id: direction, label: tr(ctx.locale, direction), icon: direction === "back" ? "arrow-left" : "arrow-right", run: async () => {
        await reading.commands![direction](guard); return refresh();
      } });
    }
  }
  actions.push({ id: "refresh", label: tr(ctx.locale, "refresh"), icon: "arrows-clockwise", run: refresh });
  return { kind: "blocks", blocks: [
    { kind: "text", text: tr(ctx.locale, playback.status) },
    ...(playback.unavailableReason ? [{ kind: "text" as const, text: tr(ctx.locale, playback.unavailableReason) }] : []),
    ...(playback.backend ? [{ kind: "text" as const, text: tr(ctx.locale, playback.fallback ? "fallback" : playback.backend) }] : []),
    { kind: "actions", actions },
  ] };
}
