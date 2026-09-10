import type { AnnotationPage, AnnotationPageQuery, PluginListView, PluginView } from "@read-aware/plugin-types";
import { tr } from "./strings";
import type { DeskContext } from "./types";

const code = (error: unknown) => error && typeof error === "object" && "code" in error && typeof error.code === "string"
  ? error.code : "annotations/observation-failed";

/** Only browsing is live. Selecting/editing opens a separate, revision-frozen view. */
export async function liveAnnotationPage(ctx: DeskContext, input: AnnotationPageQuery,
  render: (page: AnnotationPage) => Promise<PluginListView>): Promise<PluginView> {
  const query = structuredClone(input);
  const failure = (errorCode: string): PluginView => ({ kind: "detail", title: tr(ctx.locale, "title"), content: [{ kind: "error", code: errorCode }] });
  const content = async (read: () => Promise<AnnotationPage>): Promise<{ view: PluginView; failed: boolean; error?: unknown }> => {
    try { return { view: await render(await read()), failed: false }; }
    catch (error) { return { view: failure(code(error)), failed: true, error }; }
  };
  return { ...(await content(() => ctx.domains.annotations.queries.page(query))).view, live: { subscribe(channel) {
    let disposed = false, revision = 0;
    const subscription = ctx.domains.annotations.events.observe({ kind: "page", query }, async event => {
      if (disposed) return;
      const result = event.status === "error" ? { view: failure(event.errorCode), failed: false } : await content(async () => {
        if (event.result.kind !== "page") throw Error("Expected annotation page observation");
        return event.result.page;
      });
      if (disposed) return;
      await ctx.services.ui.publishView(channel, { revision: ++revision, view: result.view });
      // A joined book read can fail even when the annotation page is unchanged.
      // Do not acknowledge it: the host retries delivery after the next settled read.
      if (result.failed) throw result.error;
    });
    return { dispose() { disposed = true; subscription.dispose(); } };
  } } };
}
