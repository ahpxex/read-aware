import type { PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    ctx.contributions.commands.register({
      id: "ask", title: "Inference policy probe",
      run: async () => {
        const mode = ctx.services.storage.get<string>("mode") ?? "plain";
        let result: unknown;
        const deltas: string[] = [];
        try {
          const prompt = `privacy probe ${mode}`;
          const text = mode === "structured"
            ? await ctx.services.llm!.ask({ prompt, schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } })
            : await ctx.services.llm!.ask({ prompt, ...(mode === "stream" || mode === "HOLD" ? { onText: (delta: string) => { deltas.push(delta); } } : {}) });
          result = { status: "completed", text, deltas };
        } catch (error) {
          result = { status: "failed", code: error && typeof error === "object" && "code" in error ? error.code : null, deltas };
        }
        await ctx.services.storage.set("result", result);
      },
    });
  },
} satisfies PluginModule;
