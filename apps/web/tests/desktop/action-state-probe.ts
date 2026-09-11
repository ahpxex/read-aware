import type { PluginActionRegistration, PluginActionState, PluginModule, PluginView } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    let revision = 0, calls = 0, views = 0;
    const handles: PluginActionRegistration[] = [];
    let finish: (() => void) | undefined;
    const view = (): PluginView => {
      views++;
      return { kind: "form", title: "Action state draft", fields: [{ kind: "text", id: "draft", label: "Draft", value: "Initial draft" }],
        submitLabel: "Save", onSubmit: () => { calls++; return { close: true }; } };
    };
    handles.push(ctx.contributions.commands.register({ id: "target", title: "State probe command",
      defaultShortcut: { key: "u", alt: true, shift: true }, run() { calls++; } }));
    for (const [id, surface, presentation] of [["popup", "shelf", "popup"], ["page", "shelf", "page"], ["reader", "reader", "popup"]] as const) {
      handles.push(ctx.contributions.headerActions.register({ id, title: `State probe ${id}`, icon: "check", surface, presentation, view }));
    }
    handles.push(ctx.contributions.selectionActions.register({ id: "selection", title: "State probe selection", icon: "check", role: "lookup", run() { calls++; } }));
    handles.push(ctx.contributions.agentTools!.register({ name: "target", description: "State probe tool", execute: async input => {
      calls++;
      if (input.wait) await new Promise<void>(resolve => { finish = resolve; });
      return { calls };
    } }));
    const command = (id: string, run: () => unknown | Promise<unknown>) => ctx.contributions.commands.register({ id, title: `Probe control ${id}`,
      run: async () => ({ toast: JSON.stringify(await run()) }) });
    const publish = (state: PluginActionState) => Promise.all(handles.map(handle => handle.updateState(state)));
    command("disable", () => publish({ revision: ++revision, visible: true, enabled: false, checked: true }));
    command("hide", () => publish({ revision: ++revision, visible: false, enabled: true }));
    command("enable", () => publish({ revision: ++revision, visible: true, enabled: true, checked: true }));
    command("stale", () => publish({ revision: 0, visible: true, enabled: true }));
    command("inspect", () => ({ revision, calls, views, waiting: !!finish }));
    command("finish", () => { finish?.(); finish = undefined; return true; });
  },
} satisfies PluginModule;
