import type { PluginModule } from "@read-aware/plugin-types";
export default {
  activate(ctx) {
    ctx.contributions.commands.register({
      id: "check",
      title: "Check prerequisites",
      run: async () => {
        const abort = new AbortController();
        const pending = ctx.services.session.operationAvailability(
          ctx.manifest.description === "reading"
            ? { operation: "reading.playback", bookId: "book", sessionId: "session", action: "start" }
            : ctx.manifest.description?.startsWith("text")
              ? {
                  operation: "library.text.prepare",
                  bookId: "book",
                  rebuild: true,
                  priority: "background",
                  timeoutMs: 2000,
                }
              : { operation: "llm.infer", model: "smart", images: true },
          { signal: abort.signal },
        );
        if (ctx.manifest.description?.includes("cancel"))
          abort.abort(Object.assign(new Error("Cancelled probe"), { code: "plugin/cancelled" }));
        try {
          return { toast: JSON.stringify(await pending) };
        } catch (error) {
          if (error && typeof error === "object" && "code" in error) return { toast: String(error.code) };
          throw error;
        }
      },
    });
  },
} satisfies PluginModule;
