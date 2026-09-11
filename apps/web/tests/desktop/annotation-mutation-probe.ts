import type { AnnotationSnapshot, PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    ctx.contributions.commands.register({ id: "mutations", title: "Annotation mutation probe", run: async () => {
      const { stale, highlightId } = ctx.services.storage.get<{ stale: AnnotationSnapshot; highlightId: string }>("input")!;
      const annotations = ctx.domains.annotations!;
      const highlight = (await annotations.queries.inspect(highlightId))!;
      if (ctx.manifest.description === "read-only") {
        if (annotations.commands) throw new Error("Read-only plugin received mutations");
        await ctx.services.storage.set("result", { highlight, commandsAvailable: false });
        return;
      }
      const events: unknown[] = [];
      const subscriptions = [annotations.events.subscribe("note.updated", event => { events.push(event); }), annotations.events.subscribe("highlight.recolored", event => { events.push(event); })];
      try {
        try {
          await annotations.commands!.applyChanges([
            { op: "recolorHighlight", annotationId: highlightId, expectedRevision: highlight.revision, color: "pink" },
            { op: "updateNote", annotationId: stale.annotation.id, expectedRevision: stale.revision, body: "Lost edit" },
          ]);
          throw new Error("Stale batch unexpectedly succeeded");
        } catch (error) { if ((error as { code?: string }).code !== "annotations/conflict") throw error; }
        const unchanged = (await annotations.queries.inspect(highlightId))!;
        if (unchanged.revision !== highlight.revision || events.length) throw new Error("Rejected batch had side effects");
        const fresh = (await annotations.queries.inspect(stale.annotation.id))!;
        const receipt = await annotations.commands!.applyChanges([
          { op: "updateNote", annotationId: fresh.annotation.id, expectedRevision: fresh.revision, body: "Worker batch note" },
          { op: "recolorHighlight", annotationId: highlightId, expectedRevision: highlight.revision, color: "blue", style: "underline" },
        ]);
        const noteAfter = await annotations.queries.inspect(fresh.annotation.id);
        const highlightAfter = await annotations.queries.inspect(highlightId);
        if (noteAfter?.annotation.kind !== "note" || noteAfter.annotation.body !== "Worker batch note"
          || highlightAfter?.annotation.kind !== "highlight" || highlightAfter.annotation.style !== "underline"
          || receipt.changes[0].revision !== noteAfter.revision || receipt.changes[1].revision !== highlightAfter.revision) throw new Error("Batch receipt differs from persisted state");
        await ctx.services.storage.set("result", { conflict: "annotations/conflict", rejectedBatchUnchanged: true, receipt, noteAfter, highlightAfter, events });
      } finally { for (const subscription of subscriptions) subscription.dispose(); }
    } });
  },
} satisfies PluginModule;
