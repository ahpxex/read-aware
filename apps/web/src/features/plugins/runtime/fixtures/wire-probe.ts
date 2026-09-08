import type { PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    ctx.contributions.commands.register({
      id: "test",
      title: "Wire probe",
      run: async () => {
        const endpoint = ctx.services.storage.get<string>("endpoint");
        if (ctx.manifest.description === "request-storage") {
          const response = await ctx.services.network!.fetch(new Request(endpoint ?? "https://example.test/file", {
            method: "PUT", headers: { "x-token": "test" }, body: new Uint8Array([0, 255]),
          }));
          await ctx.services.storage.set("result", await response.text());
          return { toast: ctx.services.storage.get<string>("result") ?? "" };
        }
        if (ctx.manifest.description === "pre-abort") {
          const controller = new AbortController(); controller.abort(new Error("already stopped"));
          try { await ctx.services.network!.fetch(new Request(endpoint ?? "https://example.test/", { signal: controller.signal })); }
          catch (error) {
            if (!(error instanceof Error) || error.message !== "already stopped") throw error;
            return { toast: "already stopped" };
          }
        }
        if (ctx.manifest.description === "live-abort") {
          const controller = new AbortController();
          const request = ctx.services.network!.fetch(endpoint ?? "https://example.test/", { signal: controller.signal });
          setTimeout(() => controller.abort(new Error("stopped")), ctx.services.storage.get<number>("abortAfterMs") ?? 20);
          try { await request; } catch (error) {
            if (!(error instanceof Error) || error.message !== "stopped") throw error;
            return { toast: "stopped" };
          }
        }
        if (ctx.manifest.description === "stop") {
          const response = await ctx.services.network!.fetch(endpoint ?? "https://example.test/");
          return { toast: await response.text() };
        }
      },
    });
  },
  migrate(ctx) { void ctx.storage.set("schema", 2); },
} satisfies PluginModule;
