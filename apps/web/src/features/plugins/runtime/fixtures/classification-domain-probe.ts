import type { BookClassificationSnapshot, MemoryObservation, PluginDisposable, PluginModule } from "@read-aware/plugin-types";

export default { activate(ctx) {
  const { bookId } = JSON.parse(ctx.manifest.description!) as { bookId: string };
  let snapshot: BookClassificationSnapshot | null | undefined, observer: PluginDisposable | undefined;
  const events: MemoryObservation[] = [];
  const register = (id: string, run: () => unknown) => ctx.contributions.commands.register({ id, title: id, run: async () => {
    try { return { toast: JSON.stringify({ status: "ok", value: await run() }) }; }
    catch (error) { return { toast: JSON.stringify({ status: "error", code: error && typeof error === "object" && "code" in error ? error.code : null }) }; }
  } });
  register("shape", () => ({ memory: !!ctx.domains.memory, classify: !!ctx.domains.memory?.commands?.classify }));
  register("inspect", async () => { snapshot = await ctx.domains.memory?.queries.classification(bookId); return snapshot; });
  for (const narrativity of ["narrative", "expository"] as const) register(narrativity, () => ctx.domains.memory!.commands!.classify({ bookId, narrativity, expectedRevision: snapshot!.revision }));
  register("invalid", () => ctx.domains.memory!.commands!.classify({ bookId, narrativity: "expository", expectedRevision: snapshot!.revision, onlyIfUnclassified: true } as never));
  register("observe", () => { observer?.dispose(); observer = ctx.domains.memory!.events.observe({ kind: "classification", bookId }, event => { events.push(event); }); return true; });
  register("events", () => events);
  register("stop", () => { observer?.dispose(); observer = undefined; return events.length; });
} } satisfies PluginModule;
