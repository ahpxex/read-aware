import type { MemoryObservation, PluginDisposable, PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    const seed = JSON.parse(ctx.manifest.description!) as { bookId: string; memoryId: string; marker: string };
    const subscriptions = new Map<string, PluginDisposable>(), events: Record<string, MemoryObservation[]> = {};
    const report = async (run: () => unknown) => {
      try { return { toast: JSON.stringify({ status: "ok", value: await run() }) }; }
      catch (error) { return { toast: JSON.stringify({ status: "error", code: error && typeof error === "object" && "code" in error ? error.code : null }) }; }
    };
    for (const action of ["inspect", "search", "record", "graph", "state", "stop", "correct", "invalid"] as const) {
      ctx.contributions.commands.register({ id: action, title: action, run: () => report(async () => {
        const memory = ctx.domains.memory;
        if (action === "inspect") return { observe: !!memory?.events.observe, write: !!memory?.commands };
        if (action === "state") return events;
        if (action === "stop") { for (const item of subscriptions.values()) item.dispose(); subscriptions.clear(); return events; }
        if (!memory) return { unavailable: true };
        if (action === "correct") {
          const snapshot = await memory.queries.inspect(seed.memoryId);
          return memory.commands!.mutate({ op: "correct", memoryId: seed.memoryId, expectedRevision: snapshot!.revision, content: `${seed.marker}: Observer Worker corrected` });
        }
        if (action === "invalid") return memory.events.observe({ kind: "bookGraph", bookId: seed.bookId, query: { confirmSpoiler: true } } as never, () => {});
        if (!subscriptions.has(action)) {
          events[action] = [];
          const query = action === "search" ? { kind: "search" as const, query: { scopes: ["user" as const], query: seed.marker } }
            : action === "record" ? { kind: "inspect" as const, memoryId: seed.memoryId }
            : { kind: "bookGraph" as const, bookId: seed.bookId };
          subscriptions.set(action, await memory.events.observe(query, event => {
            events[action]!.push(event); if (events[action]!.length > 32) events[action]!.shift();
          }));
        }
        return events;
      }) });
    }
  },
} satisfies PluginModule;
