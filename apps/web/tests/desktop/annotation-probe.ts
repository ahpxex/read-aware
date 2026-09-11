import type { PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    const annotations = ctx.domains.annotations!;
    ctx.contributions.commands.register({ id: "probe", title: "Annotation capability probe", run: async () => {
      const input = ctx.services.storage.get<{ highlightId: string; askId: string }>("input")!;
      const highlight = await annotations.queries.get(input.highlightId);
      if (highlight?.kind !== "highlight" || highlight.style !== "underline") throw new Error("Agent underline did not survive storage and Worker lookup");
      if (await annotations.queries.get("missing-annotation-probe")) throw new Error("Missing ID did not return null");
      if (ctx.manifest.description === "read-only") {
        if (annotations.commands) throw new Error("Read-only annotations received commands");
        await ctx.services.storage.set("result", { highlight, commandsAvailable: false });
        return;
      }
      if ("createAsk" in annotations.commands!) throw new Error("Plugin can fabricate ask traces");
      const snapshot = (await annotations.queries.inspect(input.askId))!;
      const ask = snapshot.annotation;
      if (ask?.kind !== "ask") throw new Error("Ask query failed");
      const events: unknown[] = [];
      const subscription = annotations.events.subscribe("ask.removed", event => { events.push(event); });
      try {
        await annotations.commands!.applyChanges([{ op: "remove", kind: "ask", annotationId: input.askId, expectedRevision: snapshot.revision }]);
        if (await annotations.queries.get(input.askId)) throw new Error("Ask deletion acknowledged before persistence");
        const failures: Record<string, string> = {};
        for (const [name, id] of [["missing", input.askId], ["wrongKind", input.highlightId]]) {
          try { await annotations.commands!.applyChanges([{ op: "remove", kind: "ask", annotationId: id, expectedRevision: snapshot.revision }]); throw new Error("Invalid ask removal succeeded"); }
          catch (error) {
            const code = (error as { code?: string }).code;
            if (code !== "annotations/not-found") throw error;
            failures[name] = code;
          }
        }
        await ctx.services.storage.set("result", { highlight, ask, removed: true, failures, events });
      } finally { subscription.dispose(); }
    } });
  },
} satisfies PluginModule;
