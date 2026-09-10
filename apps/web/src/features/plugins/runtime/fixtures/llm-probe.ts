import type { PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    ctx.contributions.commands.register({ id: "ask", title: "Ask", async run() {
      const controller = new AbortController();
      if (ctx.manifest.description === "pre-abort") controller.abort(new Error("stopped"));
      const request = ctx.services.llm!.ask({ prompt: "probe", timeoutMs: 5000, signal: controller.signal });
      if (!controller.signal.aborted) setTimeout(() => controller.abort(new Error("stopped")), 20);
      try { await request; }
      catch (error) {
        if (error instanceof Error && error.message === "stopped") return { toast: "stopped" };
        throw error;
      }
    } });
  },
} satisfies PluginModule;
