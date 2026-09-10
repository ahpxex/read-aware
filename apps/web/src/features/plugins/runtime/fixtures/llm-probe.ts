import type { PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    ctx.contributions.commands.register({ id: "ask", title: "Ask", async run() {
      if (ctx.manifest.description === "detailed") {
        const result = await ctx.services.llm!.askDetailed({ prompt: "probe", maxOutputTokens: 128 });
        return { toast: `${result.value}:${result.attempts.length}` };
      }
      const controller = new AbortController();
      if (ctx.manifest.description?.startsWith("pre-abort")) controller.abort(new Error("stopped"));
      const method = ctx.manifest.description?.endsWith("detailed") ? "askDetailed" : "ask";
      const request = ctx.services.llm![method]({ prompt: "probe", timeoutMs: 5000, signal: controller.signal });
      if (!controller.signal.aborted) setTimeout(() => controller.abort(new Error("stopped")), 20);
      try { await request; }
      catch (error) {
        if (error instanceof Error && error.message === "stopped") return { toast: "stopped" };
        throw error;
      }
    } });
  },
} satisfies PluginModule;
