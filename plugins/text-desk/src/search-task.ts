import type { BookTextHit, BookTextSearch, PluginContext, PluginListView, PluginView, PluginViewChannel, PluginViewContent } from "@read-aware/plugin-types";
import { tr } from "./strings";

export function textSearchTask(ctx: PluginContext, input: BookTextSearch,
  render: (hits: BookTextHit[]) => Promise<PluginListView>): PluginView {
  const controller = new AbortController(), title = tr(ctx.locale, "searchResults");
  let channel: PluginViewChannel | undefined, revision = 0, started = false, pending = true;
  const retry = { id: "retry", label: tr(ctx.locale, "search"), icon: "magnifying-glass",
    run: () => ({ view: textSearchTask(ctx, input, render), navigation: "replace" as const }) };
  const stop = () => {
    controller.abort();
    if (pending) {
      pending = false;
      current = { kind: "list", title, items: [], emptyText: tr(ctx.locale, "searchCancelled"), actions: [retry] };
    }
  };
  let current: PluginViewContent = { kind: "blocks", title, blocks: [
    { kind: "progress", value: null, label: tr(ctx.locale, "searching"), cancel: {
      id: "cancel", label: tr(ctx.locale, "cancelRequest"), run: async () => { stop(); await publish(); },
    } },
  ] };
  const publish = async () => {
    if (!channel) return;
    const target = channel;
    try {
      const receipt = await ctx.services.ui.publishView(target, { revision: ++revision, view: current });
      if (receipt.status === "inactive" && channel === target) { channel = undefined; stop(); }
    } catch (error) {
      // A retired channel cannot display an error; keep the publication failure in diagnostics.
      console.warn("Text Desk search view publication failed", error);
      if (channel === target) { channel = undefined; stop(); }
    }
  };
  const search = async () => {
    await publish();
    if (controller.signal.aborted) return;
    try {
      const hits = await ctx.domains.library!.queries.books.searchText(input, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const result = await render(hits);
      if (controller.signal.aborted) return;
      current = result;
    } catch (error) {
      if (controller.signal.aborted) return;
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code : "library/content-unavailable";
      const retryable = ["db/locked", "library/text-extraction-failed", "library/text-busy"].includes(code);
      current = { kind: "blocks", title, blocks: [{ kind: "error", code },
        ...(retryable ? [{ kind: "actions" as const, actions: [retry] }] : [])] };
    }
    pending = false;
    await publish();
  };
  return { ...current, onClose: stop, live: { subscribe(next) {
    channel = next;
    if (!started) { started = true; void search(); }
    else void publish();
    return { dispose() { if (channel === next) { channel = undefined; stop(); } } };
  } } };
}
