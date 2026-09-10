import type { PluginModule, ReadingEmphasisSnapshot } from "@read-aware/plugin-types";

export default { activate(ctx) {
  let last: ReadingEmphasisSnapshot | undefined, previous: ReadingEmphasisSnapshot | undefined, observed: ReadingEmphasisSnapshot[] = [];
  const reading = ctx.domains.reading;
  reading?.events.observeEmphasis(values => { observed = values; });
  const foreign = ctx.manifest.description ? JSON.parse(ctx.manifest.description) : null;
  for (const action of ["inspect", "put", "replace", "remove", "stale-remove", "foreign-remove"] as const) {
    ctx.contributions.commands.register({ id: action, title: `Emphasis ${action}`, run: async () => {
      if (action === "inspect") return { toast: JSON.stringify({ exposed: !!reading, writable: !!reading?.commands,
        values: await reading?.queries.emphasis(), observed }) };
      if (!reading?.commands) return { toast: JSON.stringify({ writable: false }) };
      const current = await reading.queries.session(), guard = { bookId: current.bookId!, sessionId: current.sessionId! };
      if (action === "put" || action === "replace") {
        const hits = await ctx.domains.library!.queries.books.searchLocations({ bookId: current.bookId!, query: "needle" });
        const result = await reading.commands.putEmphasis({ ranges: hits.hits.map(hit => hit.range),
          ...(action === "replace" ? { id: last!.id, expectedRevision: last!.revision, style: "underline" as const } : {}) }, guard);
        previous = last; last = result.emphasis;
        return { toast: JSON.stringify(result) };
      }
      const ref = action === "foreign-remove" ? foreign : action === "stale-remove" ? previous! : last!;
      return { toast: JSON.stringify(await reading.commands.removeEmphasis({ id: ref.id, expectedRevision: ref.revision }, guard)) };
    } });
  }
} } satisfies PluginModule;
