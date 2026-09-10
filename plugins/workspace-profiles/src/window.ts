import type { PluginContext, PluginDetailView, PluginView } from "@read-aware/plugin-types";

const en = {
  title: "Window", minimized: "Minimized", maximized: "Maximized", fullscreen: "Full screen", focused: "Focused",
  yes: "Yes", no: "No", unavailable: "Window controls unavailable", refresh: "Refresh",
  minimize: "Minimize", maximize: "Maximize", restore: "Restore window", enter: "Enter full screen", leave: "Exit full screen",
  requested: "Window change requested",
};
const zh: typeof en = {
  title: "窗口", minimized: "已最小化", maximized: "已最大化", fullscreen: "全屏", focused: "已聚焦",
  yes: "是", no: "否", unavailable: "窗口控制不可用", refresh: "刷新",
  minimize: "最小化", maximize: "最大化", restore: "还原窗口", enter: "进入全屏", leave: "退出全屏",
  requested: "已请求窗口变更",
};
export const windowCopy = (locale: string) => locale.startsWith("zh") ? zh : en;

export async function windowView(ctx: PluginContext): Promise<PluginDetailView & PluginView> {
  const window = ctx.services.ui.window, t = windowCopy(ctx.locale);
  if (!window) throw Object.assign(Error("Window service unavailable"), { code: "ui/unavailable" });
  let snapshot = await window.snapshot();
  let error: string | undefined;
  const render = (): PluginDetailView => {
    const available = snapshot.supported && !error;
    const fullscreen = snapshot.supported && snapshot.fullscreen;
    const request = async (input: Parameters<typeof window.control>[0]) => {
      await window.control(input);
      // The native receipt acknowledges an intent, not a finished OS animation.
      return { toast: t.requested };
    };
    return { kind: "detail", title: t.title, content: error ? [{ kind: "error", code: error }]
      : !snapshot.supported ? [{ kind: "text", text: t.unavailable }]
      : [{ kind: "keyValue", rows: (["minimized", "maximized", "fullscreen", "focused"] as const)
        .map(key => ({ label: t[key], value: snapshot.supported && snapshot[key] ? t.yes : t.no })) }],
    actions: [
      ...(available ? [
        { id: "minimize", label: t.minimize, run: () => request({ action: "minimize" }) },
        { id: "maximize", label: t.maximize, run: () => request({ action: "maximize" }) },
        { id: "restore", label: t.restore, run: () => request({ action: "restore" }) },
        { id: fullscreen ? "exit-fullscreen" : "enter-fullscreen", label: fullscreen ? t.leave : t.enter,
          run: () => request({ action: "fullscreen", enabled: !fullscreen }) },
      ] : []),
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await windowView(ctx), navigation: "replace" as const }) },
    ] };
  };
  return { ...render(), live: { subscribe(channel) {
    let active = true, revision = 0;
    const subscription = window.observe(async value => {
      if (!active) return;
      if (value.status === "ready") { snapshot = value.snapshot; error = undefined; }
      else error = value.code;
      await ctx.services.ui.publishView(channel, { revision: ++revision, view: render() });
    });
    return { dispose() {
      if (!active) return;
      active = false;
      subscription.dispose();
    } };
  } } };
}
