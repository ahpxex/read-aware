import type { PluginContext, PluginAction, PluginView, PluginFormView, PluginViewResult } from "@read-aware/plugin-types";
import { tr } from "./strings";

export async function listeningView(ctx: PluginContext, boundary?: "start-of-book" | "end-of-book"): Promise<PluginView> {
  const reading = ctx.domains.reading;
  if (!reading?.commands) throw new Error("Listening Desk requires reading:write");
  const state = await reading.queries.session();
  const environment = await ctx.services.session.environment();
  const playback = state.playback;
  const guard = { sessionId: state.sessionId ?? undefined, bookId: state.bookId ?? undefined };
  const refresh = async () => ({ view: await listeningView(ctx), navigation: "replace" as const });
  const actions: PluginAction[] = [];
  const mode = state.mode;
  const providerForm: PluginFormView | null = state.status === "ready" && state.sessionId && mode.availableModes.length > 0
    && mode.unavailableReason !== "unsupported-format"
    && (mode.availableModes.length > 1 || !mode.availableModes.some(provider => provider.key === mode.modeKey)) ? {
    kind: "form", submitLabel: tr(ctx.locale, "apply"), fields: [
      { kind: "select", id: "selectModeKey", label: tr(ctx.locale, "provider"), value: mode.modeKey ?? undefined,
        options: mode.availableModes.map(provider => ({ value: provider.key, label: provider.label })) },
    ], onSubmit: async (values): Promise<PluginViewResult> => {
      if (typeof values.selectModeKey !== "string" || !mode.availableModes.some(provider => provider.key === values.selectModeKey)) {
        return { fieldErrors: { selectModeKey: tr(ctx.locale, "invalid") } };
      }
      await reading.commands!.configureMode({ active: mode.requestedActive, modeKey: mode.modeKey ?? undefined, selectModeKey: values.selectModeKey }, guard);
      return refresh();
    },
  } : null;
  const modeForm: PluginFormView | null = state.status === "ready" && state.sessionId && mode.modeKey && !mode.unavailableReason ? {
    kind: "form", title: mode.label ?? undefined, submitLabel: tr(ctx.locale, "apply"), fields: [
      { kind: "toggle", id: "active", label: tr(ctx.locale, "enabled"), value: mode.requestedActive },
      { kind: "choice", id: "unitId", label: tr(ctx.locale, "unit"), value: mode.unitId ?? undefined,
        options: mode.units.map(unit => ({ value: unit.id, label: unit.label })) },
    ], onSubmit: async (values): Promise<PluginViewResult> => {
      if (typeof values.active !== "boolean") return { fieldErrors: { active: tr(ctx.locale, "invalid") } };
      if (typeof values.unitId !== "string" || !mode.units.some(unit => unit.id === values.unitId)) {
        return { fieldErrors: { unitId: tr(ctx.locale, "invalid") } };
      }
      await reading.commands!.configureMode({ active: values.active, unitId: values.unitId, modeKey: mode.modeKey! }, guard);
      return refresh();
    },
  } : null;
  if (state.status === "ready" && state.sessionId) {
    if (mode.requestedActive && ["ready", "empty"].includes(mode.status)) {
      for (const direction of ["previous", "next"] as const) actions.push({
        id: `${direction}-unit`, label: tr(ctx.locale, direction === "next" ? "nextUnit" : "previousUnit"),
        icon: direction === "next" ? "arrow-right" : "arrow-left",
        run: async () => {
          const result = await reading.commands!.stepMode(direction, guard);
          return { view: await listeningView(ctx, result.outcome === "moved" ? undefined : result.outcome), navigation: "replace" };
        },
      });
    }
    if (mode.requestedActive && mode.position) actions.push({ id: "return-to-unit", label: tr(ctx.locale, "returnToUnit"), icon: "book-bookmark",
      run: async () => { await reading.commands!.returnToMode(guard); return refresh(); } });
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
    ...(providerForm ? [providerForm] : []),
    ...(modeForm ? [modeForm] : []),
    ...(boundary ? [{ kind: "text" as const, text: tr(ctx.locale, boundary) }] : []),
    { kind: "text", text: tr(ctx.locale, playback.status) },
    ...(environment.networkHint === "offline" ? [{ kind: "text" as const, text: tr(ctx.locale, "offline") }] : []),
    ...(playback.unavailableReason ? [{ kind: "text" as const, text: tr(ctx.locale, playback.unavailableReason) }] : []),
    ...(playback.backend ? [{ kind: "text" as const, text: tr(ctx.locale, playback.fallback ? "fallback" : playback.backend) }] : []),
    { kind: "actions", actions },
  ] };
}
