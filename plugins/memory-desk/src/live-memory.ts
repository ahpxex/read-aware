import type { MemoryObservationQuery, MemoryObservationResult, PluginContext, PluginView, PluginDetailView, PluginListView } from "@read-aware/plugin-types";

export type MemoryDeskView = (PluginDetailView | PluginListView) & Pick<PluginView, "live">;

/** A failed read clears stale content/actions; forms are separate, frozen views. */
export async function liveMemoryView(ctx: PluginContext, query: MemoryObservationQuery, title: string,
  render: (result: MemoryObservationResult) => PluginDetailView | PluginListView): Promise<MemoryDeskView> {
  const memory = ctx.domains.memory!;
  let sample: MemoryObservationResult | undefined, failure: string | undefined;
  try {
    sample = query.kind === "search" ? { kind: query.kind, memories: await memory.queries.search(query.query) }
      : query.kind === "inspect" ? { kind: query.kind, snapshot: await memory.queries.inspect(query.memoryId) }
      : { kind: query.kind, graph: await memory.queries.bookGraph(query.bookId, query.query) };
  } catch (error) {
    // The host renders only the stable code, never the raw storage message.
    failure = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "memory/observation-failed";
  }
  const content = (): PluginDetailView | PluginListView => failure || !sample
    ? { kind: "detail", title, content: [{ kind: "error", code: failure ?? "memory/observation-failed" }] }
    : render(sample);
  return { ...content(), live: { subscribe(channel) {
    let disposed = false, revision = 0;
    const subscription = memory.events.observe(query, async event => {
      if (disposed) return;
      if (event.status === "ready") { sample = event.result; failure = undefined; }
      else { sample = undefined; failure = event.errorCode; }
      await ctx.services.ui.publishView(channel, { revision: ++revision, view: content() });
    });
    return { dispose() { disposed = true; subscription.dispose(); } };
  } } };
}
