import type { PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    const seed = JSON.parse(ctx.manifest.description!) as { bookId: string; anchor: string; chapterHref: string; noteId: string };
    let highlightId: string | undefined;
    const domain = ctx.domains.annotations!, commands = domain.commands!;
    ctx.contributions.commands.register({ id: "close", title: "Close reader", async run() {
      await ctx.domains.reading!.commands!.close();
      return { toast: JSON.stringify({ action: "close", completed: true }) };
    } });
    for (const action of ["mark", "recolor", "remove", "note"] as const) ctx.contributions.commands.register({
      id: action, title: action, async run() {
        if (action === "mark") highlightId = (await commands.createHighlight({ bookId: seed.bookId,
          anchor: seed.anchor, chapterHref: seed.chapterHref, text: "Shared annotation target", color: "yellow" })).id;
        else if (action === "note") {
          const snapshot = (await domain.queries.inspect(seed.noteId))!;
          await commands.applyChanges([{ op: "updateNote", annotationId: seed.noteId, body: "Worker note changed", expectedRevision: snapshot.revision }]);
        }
        else {
          if (!highlightId) throw Error("Create a mark first");
          const current = await domain.queries.inspect(highlightId);
          if (!current) throw Error("Expected existing fixture mark");
          await commands.applyChanges([{ annotationId: highlightId, expectedRevision: current.revision,
            ...(action === "remove" ? { op: "remove", kind: "highlight" } as const
              : { op: "recolorHighlight", color: "blue", style: "underline" } as const) }]);
        }
        return { toast: JSON.stringify({ highlightId, action }) };
      },
    });
  },
} satisfies PluginModule;
