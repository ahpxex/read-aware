import type { PluginModule } from "@read-aware/plugin-types";
export default {
  activate(ctx) {
    const seed = JSON.parse(ctx.manifest.description!) as { bookId: string; marker: string };
    const report = async (run: () => unknown) => {
      try { return { toast: JSON.stringify({ status: "ok", value: await run() }) }; }
      catch (error) { return { toast: JSON.stringify({ status: "error", code: error && typeof error === "object" && "code" in error ? error.code : null }) }; }
    };
    ctx.contributions.commands.register({ id: "inspect", title: "Inspect memory", run: () => report(() => ({ memory: !!ctx.domains.memory, commands: ctx.domains.memory && "commands" in ctx.domains.memory })) });
    ctx.contributions.commands.register({ id: "graph", title: "Read graph", run: () => report(() => ctx.domains.memory?.queries.bookGraph(seed.bookId)) });
    ctx.contributions.commands.register({ id: "chapter", title: "Read hidden chapter", run: () => report(() => ctx.domains.memory?.queries.bookGraph(seed.bookId, { chapterIndex: 2 })) });
    ctx.contributions.commands.register({ id: "search", title: "Read memory", run: () => report(() => ctx.domains.memory?.queries.search({ scopes: [`book:${seed.bookId}`], query: seed.marker })) });
    ctx.contributions.commands.register({ id: "spoiler", title: "Reject self-authorized spoilers", run: () => report(() => ctx.domains.memory?.queries.bookGraph(seed.bookId, { confirmSpoiler: true } as never)) });
  },
} satisfies PluginModule;
