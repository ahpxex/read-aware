import type { PluginModule } from "@read-aware/plugin-types";

export default { activate(ctx) {
  const { bookId } = JSON.parse(ctx.manifest.description!) as { bookId: string };
  let taskId = "", subscription: { dispose(): void } | undefined;
  const observations: unknown[] = [];
  for (const action of ["start", "rebuild", "retry", "cancel", "list", "get", "observe", "stop", "events", "foreign"]) ctx.contributions.commands.register({
    id: action, title: action, run: async () => {
      try {
        const memory = ctx.domains.memory!;
        let value: unknown;
        if (action === "start" || action === "rebuild") { const task = await memory.commands!.startGraphTask(bookId, action === "rebuild" ? "rebuild" : "catch-up"); taskId = task.taskId; value = task; }
        else if (action === "retry") { const task = await memory.commands!.retryGraphTask(bookId, taskId); taskId = task.taskId; value = task; }
        else if (action === "cancel") value = await memory.commands!.cancelGraphTask(bookId, taskId);
        else if (action === "get") value = await memory.queries.getGraphTask(bookId, taskId);
        else if (action === "foreign") value = await memory.queries.getGraphTask("another-book", taskId);
        else if (action === "list") value = await memory.queries.listGraphTasks(bookId);
        else if (action === "observe") { subscription?.dispose(); subscription = memory.events.observe({ kind: "graphTasks", bookId }, event => { observations.push(event); }); value = true; }
        else if (action === "stop") { subscription?.dispose(); subscription = undefined; value = true; }
        else value = observations;
        return { toast: JSON.stringify({ status: "ok", value }) };
      } catch (error) { return { toast: JSON.stringify({ status: "error", code: error && typeof error === "object" && "code" in error ? error.code : "unavailable" }) }; }
    },
  });
} } satisfies PluginModule;
