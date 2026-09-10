import type { PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    const { bookId, pdfId } = JSON.parse(ctx.manifest.description!);
    const errorCode = async (run: () => unknown) => {
      try { await run(); return "unexpected-success"; }
      catch (error) { return error && typeof error === "object" && "code" in error ? error.code : "unknown"; }
    };
    ctx.contributions.commands.register({ id: "probe", title: "Range probe", run: async () => {
      if (!ctx.domains.library) return { toast: JSON.stringify({ libraryVisible: false }) };
      const books = ctx.domains.library.queries.books;
      const result: Record<string, unknown> = { libraryVisible: true, commandsVisible: !!ctx.domains.library.commands };
      for (const [label, id] of [["dom", bookId], ["pdf", pdfId]]) {
        const found = await books.searchLocations({ bookId: id, query: "needle", matchCase: true });
        const range = found.hits[0].range;
        result[label] = { found, read: await books.readRange({ range, limit: 3, contextChars: 12 }),
          continuation: await books.readRange({ range, offset: 3, limit: 3, contextChars: 0 }),
          parallel: await Promise.all(Array.from({ length: 8 }, () => books.readRange({ range, contextChars: 0 }))),
          stale: await errorCode(() => books.readRange({ range: { ...range, contentVersion: "old" } })),
          missing: await errorCode(() => books.readRange({ range: { ...range, bookId: "missing-range-probe" } })),
          offset: await errorCode(() => books.readRange({ range, offset: 9000 })),
          extra: await errorCode(() => books.readRange({ range, hrefs: ["all"] } as never)),
        };
        if (label === "pdf") result.ambiguous = await errorCode(() => books.readRange({ range: { ...range, textQuote: { exact: "needle" } } }));
      }
      return { toast: JSON.stringify(result) };
    } });
  },
} satisfies PluginModule;
