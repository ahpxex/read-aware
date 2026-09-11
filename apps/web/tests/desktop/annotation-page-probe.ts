import type { AnnotationPage, AnnotationPageQuery, PluginModule } from "@read-aware/plugin-types";

export default {
  activate(ctx) {
    ctx.contributions.commands.register({ id: "pages", title: "Annotation page probe", run: async () => {
      const input = ctx.services.storage.get<{ bookId: string; query: string; cursor: string; expectedIds: string[] }>("input")!;
      const annotations = ctx.domains.annotations;
      if (!annotations) {
        await ctx.services.storage.set("result", { authorized: false });
        return;
      }
      if (annotations.commands) throw new Error("Read permission exposed annotation writes");
      const filter = { bookId: input.bookId, query: input.query, kind: "note" as const };
      const pages: AnnotationPage[] = [];
      let cursor: string | undefined;
      do {
        const page = await annotations.queries.page({ ...filter, limit: 2, cursor });
        if (page.consistency !== "live" || page.items.length > 2) throw new Error("Invalid page contract");
        pages.push(page);
        cursor = page.nextCursor ?? undefined;
        if (pages.length > 10) throw new Error("Pagination did not terminate");
      } while (cursor);
      const ids = pages.flatMap(page => page.items.map(item => item.id));
      if (JSON.stringify(ids) !== JSON.stringify(input.expectedIds)) throw new Error("Worker pagination missed, duplicated or reordered rows");
      const continued = await annotations.queries.page({ ...filter, cursor: input.cursor, limit: 100 });
      if (JSON.stringify(continued.items.map(item => item.id)) !== JSON.stringify(ids.slice(2))) throw new Error("Agent cursor did not continue in Worker");
      const failures: Record<string, string> = {};
      const cases: [string, AnnotationPageQuery, string][] = [
        ["book", { ...filter, cursor: input.cursor, bookId: "other-book" }, "annotations/invalid-cursor"],
        ["kind", { ...filter, cursor: input.cursor, kind: "highlight" }, "annotations/invalid-cursor"],
        ["query", { ...filter, cursor: input.cursor, query: "different" }, "annotations/invalid-cursor"],
        ["malformed", { ...filter, cursor: "malformed" }, "annotations/invalid-cursor"],
        ["limit", { ...filter, limit: 101 }, "annotations/invalid-input"],
      ];
      for (const [name, query, expected] of cases) {
        try { await annotations.queries.page(query); throw new Error("Invalid page request succeeded"); }
        catch (error) {
          const code = (error as { code?: string }).code;
          if (code !== expected) throw error;
          failures[name] = code;
        }
      }
      await ctx.services.storage.set("result", { authorized: true, pages, continued, failures });
    } });
  },
} satisfies PluginModule;
