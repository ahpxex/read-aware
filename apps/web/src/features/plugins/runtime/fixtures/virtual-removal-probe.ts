import type { PluginModule } from "@read-aware/plugin-types";

const binding = { providerId: "content", key: "synthetic-removal" };
export default {
  activate(ctx) {
    const books = ctx.domains.library!.commands!.books;
    const remove = async () => { await books.removeVirtualBook(binding); return { removed: true }; };
    ctx.contributions.commands.register({ id: "create", title: "Create virtual removal probe", run: async () => {
      const book = await books.addVirtualBook({ ...binding, title: "Virtual Removal Probe", author: "ReadAware Tests" });
      return { toast: JSON.stringify({ bookId: book.id }) };
    } });
    ctx.contributions.commands.register({ id: "remove", title: "Remove virtual removal probe", run: async () => ({ toast: JSON.stringify(await remove()) }) });
    ctx.contributions.agentTools!.register({ name: "remove", description: "Remove the synthetic book owned by this probe", execute: remove });
  },
} satisfies PluginModule;
