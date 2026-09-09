import type { BookTextSearch, PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    ctx.contributions.commands.register({ id: "inspect", title: "Inspect derived-text search", run: async () => {
      const library = ctx.domains.library;
      if (!library) return { toast: JSON.stringify({ hasLibrary: false }) };
      const bookId = ctx.manifest.description!;
      const query = ["Text preparation probe"];
      const result: Record<string, unknown> = { hasLibrary: true, hasWrite: !!library.commands };
      for (const [key, input] of Object.entries({
        single: { queries: query, bookId }, shelf: { queries: query },
        fenced: { queries: query, bookId, throughChapterIndex: -1 },
        invalid: { queries: query, limit: 0 }, missing: { queries: query, bookId: "capability-nonexistent-book" },
      } satisfies Record<string, BookTextSearch>)) {
        try { result[key] = { completed: true, hits: await library.queries.books.searchText(input) }; }
        catch (error) { result[key] = { completed: false, code: (error as { code?: string }).code }; }
      }
      return { toast: JSON.stringify(result) };
    } });
  },
} satisfies PluginModule;
