import type { MemorySnapshot, PluginModule } from "@read-aware/plugin-types";
export default { activate(ctx) {
  const { memoryId } = JSON.parse(ctx.manifest.description!) as { memoryId: string };
  let snapshot: MemorySnapshot | null = null;
  for (const action of ["inspect", "correct", "pin", "unpin", "forget"] as const) ctx.contributions.commands.register({ id: action, title: action, run: async () => {
    try {
      if (action === "inspect") { snapshot = await ctx.domains.memory!.queries.inspect(memoryId); return { toast: JSON.stringify({ status: "ok", snapshot, write: !!ctx.domains.memory!.commands }) }; }
      if (!snapshot) throw Error("Inspect first");
      const common = { memoryId, expectedRevision: snapshot.revision };
      const result = await ctx.domains.memory!.commands!.mutate(action === "correct" ? { ...common, op: "correct", content: "Corrected by real Worker" }
        : action === "forget" ? { ...common, op: "forget" } : { ...common, op: "setPinned", pinned: action === "pin" });
      return { toast: JSON.stringify({ status: "ok", result }) };
    } catch (error) { return { toast: JSON.stringify({ status: "error", code: error && typeof error === "object" && "code" in error ? error.code : "probe/no-method" }) }; }
  } });
} } satisfies PluginModule;
