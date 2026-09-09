import type { HostCommandId, PluginModule, WorkspaceSnapshot, WorkspaceTarget } from "@read-aware/plugin-types";

export default { activate(ctx) {
  const commands = ctx.services.ui.commands;
  ctx.contributions.commands.register({ id: "host-list", title: "Inspect host commands", run: async () => ({ toast: JSON.stringify({
    readable: !!commands, writable: !!commands?.execute, snapshot: await commands?.list(),
  }) }) });
  if (commands?.execute) for (const id of ["go-stats", "go-shelf", "go-context", "open-settings", "layout-grid", "layout-list", "sort-title", "group-author"] satisfies HostCommandId[]) {
    ctx.contributions.commands.register({ id: `host-${id}`, title: id, run: async () => ({ toast: JSON.stringify(await commands.execute!({ id })) }) });
  }
  const api = ctx.services.ui.workspace;
  const seen: (WorkspaceSnapshot | null)[] = [];
  api?.observe({ limit: 1 }, snapshot => { seen.push(snapshot); if (seen.length > 20) seen.shift(); });
  ctx.contributions.commands.register({ id: "inspect", title: "Inspect workspace", run: async () => ({ toast: JSON.stringify({
    readable: !!api, writable: !!api?.navigate, snapshot: await api?.snapshot({ limit: 1 }), seen,
  }) }) });
  if (!api?.navigate) return;
  const data = JSON.parse(ctx.manifest.description!) as { collectionId: string; bookIds: string[] };
  const targets: Record<string, WorkspaceTarget> = {
    shelf: { surface: "shelf" }, stats: { surface: "stats" }, agent: { surface: "agent" },
    settings: { surface: "settings", section: "reading" }, search: { surface: "search", query: "Workspace Probe" },
    selection: { surface: "shelf", collectionId: data.collectionId, selection: { active: true, bookIds: data.bookIds } },
    missing: { surface: "shelf", collectionId: "nonexistent-workspace-collection" },
    hidden: { surface: "shelf", selection: { active: true, bookIds: data.bookIds } },
  };
  for (const [id, target] of Object.entries(targets)) ctx.contributions.commands.register({ id, title: id, run: async () => {
    return { toast: JSON.stringify(await api.navigate!(target)) };
  } });
} } satisfies PluginModule;
