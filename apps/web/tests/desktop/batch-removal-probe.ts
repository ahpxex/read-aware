import type { PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    const ids = JSON.parse(ctx.manifest.description!) as string[];
    const books = ctx.domains.library?.commands?.books;
    ctx.contributions.commands.register({ id: "inspect", title: "Inspect batch removal", run: () => ({ toast: JSON.stringify({
      read: !!ctx.domains.library, removeMany: !!books?.removeMany, retry: !!books?.retryRemovalCleanup, cleanupQuery: !!ctx.domains.library?.queries.books.listRemovalCleanup,
    }) }) });
    ctx.contributions.commands.register({ id: "remove", title: "Remove synthetic batch", run: async () => ({ toast: JSON.stringify(await books!.removeMany(ids)) }) });
    ctx.contributions.commands.register({ id: "retry", title: "Retry synthetic file cleanup", run: async () => ({ toast: JSON.stringify(await books!.retryRemovalCleanup(ids)) }) });
    ctx.contributions.commands.register({ id: "invalid", title: "Invalid synthetic batch", run: async () => ({ toast: JSON.stringify(await books!.removeMany([])) }) });
    ctx.contributions.commands.register({ id: "cleanup-list", title: "List pending cleanup", run: async () => ({ toast: JSON.stringify(await ctx.domains.library?.queries.books.listRemovalCleanup({ limit: 1 }) ?? { unavailable: true }) }) });
    ctx.contributions.commands.register({ id: "cleanup-next", title: "Next cleanup page", run: async () => {
      const first = await ctx.domains.library!.queries.books.listRemovalCleanup({ limit: 1 });
      return { toast: JSON.stringify(await ctx.domains.library!.queries.books.listRemovalCleanup({ limit: 1, after: first.nextCursor! })) };
    } });
  },
} satisfies PluginModule;
