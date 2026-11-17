import type { PluginModule } from "@read-aware/plugin-types";

let activated = false;
export default {
  activate(ctx) {
    activated = true;
    if (ctx.manifest.id !== "service-caller") return;
    ctx.contributions.commands.register({
      id: "transaction-denied",
      title: "Transaction denial",
      run: async () => {
        try {
          await ctx.services.transactions.preview([
            { kind: "book.metadata", bookId: "book", patch: { title: "Forbidden" } },
          ]);
        } catch (error) {
          return { toast: String((error as { code: string }).code) };
        }
        throw new Error("A read-only caller received a write preview");
      },
    });
    for (const bookId of ["book", "foreign"])
      ctx.contributions.commands.register({
        id: bookId,
        title: bookId,
        run: async () => {
          const service = (await ctx.services.plugins.listServices({ pluginId: "service-provider", id: "inspect" }))
            .services[0]!.ref;
          return {
            toast: JSON.stringify((await ctx.services.plugins.callService({ service, bookId, input: null })).value),
          };
        },
      });
  },
  services: {
    inspect: async (ctx) => {
      let foreignError = "",
        privateError = "";
      try {
        await ctx.domains.library!.queries.books.get("foreign");
      } catch (error) {
        foreignError = String((error as { code: string }).code);
      }
      try {
        ctx.services.storage.get("private");
      } catch (error) {
        privateError = String((error as { code: string }).code);
      }
      return {
        activated,
        canWrite: Boolean(ctx.domains.library?.commands),
        bookId: ctx.grants.book.mode === "book" ? ctx.grants.book.bookId : "all",
        foreignError,
        privateError,
      };
    },
    wait: async (ctx) => {
      await ctx.services.session.environment();
      return await new Promise<never>(() => {});
    },
    invalid: () => ({ callback: () => "must not escape" }),
  },
} satisfies PluginModule;
