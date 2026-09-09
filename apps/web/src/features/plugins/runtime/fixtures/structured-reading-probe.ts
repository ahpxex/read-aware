import type { PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    ctx.contributions.commands.register({
      id: "ask", title: "Structured reading context probe",
      run: async () => {
        const mode = ctx.services.storage.get<string>("mode") ?? "plain";
        const deltas: string[] = [];
        const input = { prompt: "Controlled structured reading request", readingContext: {
          selection: "SELECTION_MARKER_947", surrounding: "VIEWPORT_MARKER_628",
        } };
        try {
          const text = mode === "structured"
            ? await ctx.services.llm!.ask({ ...input, schema: { type: "object", required: ["headword", "senses"] } })
            : await ctx.services.llm!.ask({ ...input, ...(mode === "stream" ? { onText: (delta: string) => deltas.push(delta) } : {}) });
          return { toast: JSON.stringify({ status: "completed", text, deltas }) };
        } catch (error) {
          return { toast: JSON.stringify({ status: "failed", code: error && typeof error === "object" && "code" in error ? error.code : null, deltas }) };
        }
      },
    });
  },
} satisfies PluginModule;
