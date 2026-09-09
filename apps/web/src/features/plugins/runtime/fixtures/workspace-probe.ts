import type { PluginModule, WorkspaceSnapshot, WorkspaceTarget } from "@read-aware/plugin-types";

export default { activate(ctx) {
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
