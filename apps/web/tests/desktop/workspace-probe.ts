import type { HostCommandId, HostCommandObservation, PluginModule, WorkspaceSnapshot, WorkspaceTarget } from "@read-aware/plugin-types";

export default { activate(ctx) {
  const commands = ctx.services.ui.commands;
  const commandStates: HostCommandObservation[] = [];
  const watch = commands?.observe(state => { commandStates.push(state); if (commandStates.length > 20) commandStates.shift(); });
  ctx.contributions.commands.register({ id: "host-observed", title: "Observed commands", run: () => ({ toast: JSON.stringify(commandStates) }) });
  ctx.contributions.commands.register({ id: "host-unwatch", title: "Stop observing commands", run: () => { watch?.dispose(); return { toast: JSON.stringify(commandStates.length) }; } });
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
  if (commands?.execute) {
    const requests = {
      "host-open-book": { id: "open-book", args: { bookId: data.bookIds[0] } },
      "host-open-collection": { id: "open-collection", args: { collectionId: data.collectionId } },
      "host-missing-book": { id: "open-book", args: { bookId: "missing-command-book" } },
      "host-missing-collection": { id: "open-collection", args: { collectionId: "missing-command-collection" } },
    } as const;
    for (const [id, request] of Object.entries(requests)) ctx.contributions.commands.register({ id, title: id,
      run: async () => ({ toast: JSON.stringify(await commands.execute!(request)) }) });
  }
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
