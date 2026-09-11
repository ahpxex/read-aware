import type { PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    ctx.contributions.commands.register({ id: "cancel", title: "Cancel", async run() {
      const controller = new AbortController();
      const scenario = ctx.manifest.description ?? "";
      if (scenario.endsWith("pre")) controller.abort(new Error("replaced"));
      const request = scenario.startsWith("query")
        ? ctx.domains.library!.queries.books.searchLocations({ bookId: "b", query: "q" }, { signal: controller.signal })
        : ctx.domains.reading!.commands!.step("next", { sessionId: "active" }, { signal: controller.signal });
      if (!controller.signal.aborted) setTimeout(() => controller.abort(new Error("replaced")), 20);
      try { await request; }
      catch (error) {
        if (error instanceof Error && error.message === "replaced") return { toast: "replaced" };
        throw error;
      }
    } });
  },
} satisfies PluginModule;
