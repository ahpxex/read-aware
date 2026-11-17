import type { PluginAgentContextProvider, PluginContext, PluginModule } from "@read-aware/plugin-types";

/**
 * A reading-intent source with nested prepare/read callbacks over a private
 * document collection — the shape the retired Reading Goals plugin used, kept
 * here so the wire test still exercises nested source callbacks through RPC.
 */
function intentionSource(ctx: PluginContext): NonNullable<PluginAgentContextProvider["readingIntent"]> {
  type Record = { version: 1; goal: { text: string } | null };
  const storage = ctx.services.storage;
  const id = (scope: { kind: string; id?: string }) => {
    if (scope.kind !== "book" || typeof scope.id !== "string")
      throw Object.assign(Error("Book scope required"), { code: "plugin/invalid-input" });
    return scope.id;
  };
  return {
    scopes: ["book"],
    prepare: async (scope) => {
      const book = id(scope);
      await storage.collection("goals").get<Record>(book);
      if ((await storage.getDurable(`goal:${book}`)) !== null) await storage.remove(`goal:${book}`);
      await storage.flush();
    },
    read: async (scope) => {
      const doc = await storage.collection("goals").get<Record>(id(scope));
      if (!doc) return { revision: null, text: null };
      return { revision: doc.revision, text: doc.data.goal?.text ?? null };
    },
  };
}

export default {
  activate(ctx) {
    if (ctx.manifest.description === "intention-source")
      ctx.contributions.agentContextProviders!.register({
        id: "goal",
        provide: () => [],
        readingIntent: intentionSource(ctx),
      });
    ctx.contributions.commands.register({
      id: "test",
      title: "Wire probe",
      run: async () => {
        if (ctx.manifest.description === "grant-metadata") {
          const before = JSON.stringify(ctx.grants);
          try {
            (ctx.grants as unknown as { book: { mode: string } }).book.mode = "all";
          } catch {
            /* frozen metadata is expected */
          }
          return { toast: `${before}|${JSON.stringify(ctx.grants)}` };
        }
        if (ctx.manifest.description === "durable-storage")
          return { toast: (await ctx.services.storage.getDurable<string>("result")) ?? "missing" };
        const endpoint = ctx.services.storage.get<string>("endpoint");
        if (["pre-timeout", "live-timeout", "network-failure"].includes(ctx.manifest.description ?? "")) {
          const controller = new AbortController();
          if (ctx.manifest.description === "pre-timeout")
            controller.abort(new DOMException("private deadline", "TimeoutError"));
          try {
            await ctx.services.network!.fetch(endpoint ?? "https://example.test/", {
              signal: ctx.manifest.description === "live-timeout" ? AbortSignal.timeout(20) : controller.signal,
            });
          } catch (error) {
            if (error && typeof error === "object" && "code" in error && typeof error.code === "string")
              return { toast: error.code };
            throw error;
          }
        }
        if (ctx.manifest.description === "stream") {
          const stream = await ctx.services.network!.openStream(
            new Request(endpoint ?? "https://example.test/file", {
              method: "PUT",
              headers: { "x-token": "stream" },
              body: new Uint8Array([0, 255]),
            }),
          );
          let offset = 0;
          try {
            while (true) {
              const chunk = await ctx.services.network!.readStream(stream.id, offset, 1024);
              offset += chunk.bytes.byteLength;
              if (chunk.done) break;
            }
          } finally {
            await ctx.services.network!.closeStream(stream.id);
          }
          return { toast: `${stream.status}: ${offset} bytes` };
        }
        if (ctx.manifest.description === "request-storage") {
          const response = await ctx.services.network!.fetch(
            new Request(endpoint ?? "https://example.test/file", {
              method: "PUT",
              headers: { "x-token": "test" },
              body: new Uint8Array([0, 255]),
            }),
          );
          await ctx.services.storage.set("result", await response.text());
          return { toast: ctx.services.storage.get<string>("result") ?? "" };
        }
        if (ctx.manifest.description === "pre-abort") {
          const controller = new AbortController();
          controller.abort(new Error("already stopped"));
          try {
            await ctx.services.network!.fetch(
              new Request(endpoint ?? "https://example.test/", { signal: controller.signal }),
            );
          } catch (error) {
            if (!(error instanceof Error) || error.message !== "already stopped") throw error;
            return { toast: "already stopped" };
          }
        }
        if (ctx.manifest.description === "live-abort") {
          const controller = new AbortController();
          const request = ctx.services.network!.fetch(endpoint ?? "https://example.test/", {
            signal: controller.signal,
          });
          setTimeout(
            () => controller.abort(new Error("stopped")),
            ctx.services.storage.get<number>("abortAfterMs") ?? 20,
          );
          try {
            await request;
          } catch (error) {
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
  migrate(ctx) {
    void ctx.storage.set("schema", 2);
  },
} satisfies PluginModule;
