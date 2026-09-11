import type { PluginDisposable, PluginModule, ReadingSessionSnapshot } from "@read-aware/plugin-types";
let stop: PluginDisposable | undefined;

export default {
  activate(ctx) {
    let observed: ReadingSessionSnapshot | null = null;
    const reading = ctx.domains.reading;
    let selectionId: string | undefined, previousId: string | undefined;
    if (reading) stop = reading.events.observeSession(snapshot => { observed = snapshot; });
    ctx.contributions.commands.register({ id: "inspect", title: "Selection probe", run: async () => {
      const snapshot = await reading?.queries.session();
      const page = snapshot?.selection?.range ? await ctx.domains.library!.queries.books.readRange({ range: snapshot.selection.range }) : null;
      return { toast: JSON.stringify({ exposed: !!reading, canWrite: !!reading?.commands, snapshot, observed, page }) };
    } });
    for (const action of ["select", "clear", "stale-clear"] as const) ctx.contributions.commands.register({
      id: action, title: `Selection probe ${action}`, run: async () => {
        if (!reading?.commands) return { toast: JSON.stringify({ exposed: false }) };
        const current = await reading.queries.session();
        if (!current.bookId || !current.sessionId) throw Error("Open a probe book first");
        const guard = { bookId: current.bookId, sessionId: current.sessionId };
        if (action === "select") {
          const results = await ctx.domains.library!.queries.books.searchLocations({ bookId: current.bookId, query: "needle" });
          const receipt = await reading.commands.selectRange(results.hits[0].range, guard);
          previousId = selectionId; selectionId = receipt.selection!.id;
          return { toast: JSON.stringify(receipt) };
        }
        return { toast: JSON.stringify(await reading.commands.clearSelection(action === "stale-clear" ? previousId! : selectionId!, guard)) };
      },
    });
  },
  deactivate() { stop?.dispose(); stop = undefined; },
} satisfies PluginModule;
