import type { BookLocationSearch, PluginListView, PluginView, PluginViewChannel, PluginViewContent } from "@read-aware/plugin-types";
import { tr } from "./strings";
import type { JumperContext } from "./types";

export function textSearchView(ctx: JumperContext, input: BookLocationSearch): PluginView {
  const controller = new AbortController();
  let channel: PluginViewChannel | undefined, revision = 0, started = false, pending = true;
  const retry = { id: "retry", label: tr(ctx.locale, "search"), icon: "magnifying-glass",
    run: () => ({ view: textSearchView(ctx, input), navigation: "replace" as const }) };
  const cancelled = (): PluginViewContent => ({ kind: "list", title: input.query, items: [],
    emptyText: tr(ctx.locale, "cancelled"), actions: [retry] });
  const stop = () => {
    controller.abort();
    if (pending) { pending = false; current = cancelled(); }
  };
  let current: PluginViewContent = { kind: "blocks", title: input.query, blocks: [
    { kind: "progress", value: null, label: tr(ctx.locale, "searching"), cancel: {
      id: "cancel", label: tr(ctx.locale, "cancel"), run: async () => { stop(); await publish(); },
    } },
  ] };
  const publish = async () => {
    if (!channel) return;
    const target = channel;
    try {
      const receipt = await ctx.services.ui.publishView(target, { revision: ++revision, view: current });
      if (receipt.status === "inactive" && channel === target) { channel = undefined; stop(); }
    } catch (error) {
      // A retired channel cannot display an error; the host diagnostic log remains available.
      console.warn("Jumper search view publication failed", error);
      if (channel === target) { channel = undefined; stop(); }
    }
  };
  const search = async () => {
    await publish();
    if (controller.signal.aborted) return;
    try {
      const page = await ctx.domains.library.queries.books.searchLocations(input, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const result: PluginListView = { kind: "list", title: input.query,
        emptyText: tr(ctx.locale, page.nextCursor ? "pending" : page.textStatus === "textless" ? "textless"
          : page.textStatus === "unsupported" || page.textStatus === "partial" ? "unsupported" : "noHits"),
        items: page.hits.map(hit => ({ id: hit.id, title: hit.excerpt.pre + hit.excerpt.match + hit.excerpt.post,
          icon: "magnifying-glass", onSelect: async () => {
            await ctx.domains.reading.commands.goTo(hit.location);
            return { close: true };
          } })),
        actions: page.nextCursor ? [{ id: "more", label: tr(ctx.locale, "more"), icon: "arrow-right", run: () => ({
          view: textSearchView(ctx, { ...input, contentVersion: page.contentVersion, cursor: page.nextCursor! }),
        }) }] : [],
      };
      current = result;
    } catch (error) {
      if (controller.signal.aborted) return;
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code : "library/content-unavailable";
      const retryable = ["db/locked", "library/text-extraction-failed", "library/text-busy"].includes(code);
      current = { kind: "blocks", title: input.query, blocks: [{ kind: "error", code },
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
