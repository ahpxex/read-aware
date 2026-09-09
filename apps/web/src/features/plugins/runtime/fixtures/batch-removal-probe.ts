import type { PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    const ids = JSON.parse(ctx.manifest.description!) as string[];
    const books = ctx.domains.library?.commands?.books;
    ctx.contributions.commands.register({ id: "inspect", title: "Inspect batch removal", run: () => ({ toast: JSON.stringify({
      read: !!ctx.domains.library, removeMany: !!books?.removeMany, retry: !!books?.retryRemovalCleanup,
    }) }) });
    ctx.contributions.commands.register({ id: "remove", title: "Remove synthetic batch", run: async () => ({ toast: JSON.stringify(await books!.removeMany(ids)) }) });
    ctx.contributions.commands.register({ id: "retry", title: "Retry synthetic file cleanup", run: async () => ({ toast: JSON.stringify(await books!.retryRemovalCleanup(ids)) }) });
    ctx.contributions.commands.register({ id: "invalid", title: "Invalid synthetic batch", run: async () => ({ toast: JSON.stringify(await books!.removeMany([])) }) });
  },
} satisfies PluginModule;
