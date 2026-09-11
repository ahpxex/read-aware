import type { PluginDetailView, PluginListView, PluginDocumentObservationQuery, PluginDocumentObservationResult, PluginView } from "@read-aware/plugin-types";
import { bookmarkCopy } from "./bookmark-strings";
import type { JumperContext } from "./types";

export type BookmarkReadView = (PluginDetailView | PluginListView) & Pick<PluginView, "live">;

/** Only read views are live; editing/confirmation forms keep their seen revision. */
export async function liveBookmarks(ctx: JumperContext, query: PluginDocumentObservationQuery,
  read: () => Promise<PluginDocumentObservationResult>, render: (result: PluginDocumentObservationResult) => Promise<BookmarkReadView>): Promise<BookmarkReadView> {
  const failure = (errorCode: string): BookmarkReadView => ({ kind: "detail", title: bookmarkCopy(ctx.locale).title,
    content: [{ kind: "error", code: errorCode }], actions: [{ id: "refresh", label: bookmarkCopy(ctx.locale).refresh,
      icon: "arrows-clockwise", run: async () => ({ view: await liveBookmarks(ctx, query, read, render), navigation: "replace" }) }] });
  const code = (error: unknown) => error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "ipc/unknown";
  const content = async (result: PluginDocumentObservationResult) => {
    try { return await render(result); }
    catch (error) { return failure(code(error)); }
  };
  let initial: BookmarkReadView;
  try { initial = await content(await read()); }
  catch (error) { initial = failure(code(error)); }
  return { ...initial, live: { subscribe(channel) {
    let disposed = false, revision = 0;
    const subscription = ctx.services.storage.observeDocuments(query, async event => {
      if (disposed) return;
      const view = event.status === "ready" ? await content(event.result) : failure(event.errorCode);
      if (!disposed) await ctx.services.ui.publishView(channel, { revision: ++revision, view });
    });
    return { dispose() { disposed = true; subscription.dispose(); } };
  } } };
}
