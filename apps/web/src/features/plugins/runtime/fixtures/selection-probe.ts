import type { PluginDisposable, PluginModule, ReadingSessionSnapshot } from "@read-aware/plugin-types";
let stop: PluginDisposable | undefined;

export default {
  activate(ctx) {
    let observed: ReadingSessionSnapshot | null = null;
    const reading = ctx.domains.reading;
    if (reading) stop = reading.events.observeSession(snapshot => { observed = snapshot; });
    ctx.contributions.commands.register({ id: "inspect", title: "Selection probe", run: async () => {
      const snapshot = await reading?.queries.session();
      const page = snapshot?.selection?.range ? await ctx.domains.library!.queries.books.readRange({ range: snapshot.selection.range }) : null;
      return { toast: JSON.stringify({ exposed: !!reading, canWrite: !!reading?.commands, snapshot, observed, page }) };
    } });
  },
  deactivate() { stop?.dispose(); stop = undefined; },
} satisfies PluginModule;
