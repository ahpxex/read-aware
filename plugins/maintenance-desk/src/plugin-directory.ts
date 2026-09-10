import type { PluginContext, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { adminCopy } from "./admin-strings";
import { liveView } from "./live-view";

type Directory = PluginContext["services"]["plugins"];
type Entry = Awaited<ReturnType<Directory["list"]>>["plugins"][number];
type Query = { search?: string; offset?: number; pluginId?: string };
const LIMIT = 40;

export function pluginDirectory(ctx: PluginContext, signal: AbortSignal) {
  const t = adminCopy(ctx.locale);
  const manage = { id: "manage", label: t.managePlugins, icon: "arrow-square-out",
    run: async (): Promise<PluginViewResult> => {
      signal.throwIfAborted();
      await ctx.services.maintenance.openSettings("plugins");
      return { close: true };
    } };
  const detail = (entry: Entry): PluginView => ({
    kind: "detail", title: entry.name, content: [{ kind: "keyValue", rows: [
      { label: "ID", value: entry.id }, { label: t.version, value: entry.version },
      { label: t.enabled, value: entry.enabled ? t.yes : t.no },
      { label: t.builtin, value: entry.builtin ? t.yes : t.no },
      { label: t.activationFailed, value: entry.activationFailed ? t.yes : t.no },
    ] }], actions: [
      { id: "contributions", label: t.contributions, icon: "list-bullets",
        run: async () => ({ view: await page("contributions", { pluginId: entry.id }) }) }, manage,
    ],
  });
  const form = (kind: "plugins" | "contributions", query: Query): PluginView => ({
    kind: "form", title: t[kind], submitLabel: t.browse,
    fields: [{ kind: "text", id: "search", label: t.search, value: query.search ?? "" }],
    onSubmit: async (values): Promise<PluginViewResult> => {
      if (typeof values.search !== "string" || values.search.length > 200) return { fieldErrors: { search: t.invalidSearch } };
      return { view: await page(kind, { ...(query.pluginId ? { pluginId: query.pluginId } : {}), search: values.search.trim() }) };
    },
  });
  const page = async (kind: "plugins" | "contributions" = "plugins", query: Query = {}): Promise<PluginView> => {
    signal.throwIfAborted();
    const request = { ...query, offset: query.offset ?? 0, limit: LIMIT };
    const actions = [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise",
        run: async (): Promise<PluginViewResult> => ({ view: await page(kind, { ...query, offset: 0 }), navigation: "replace" }) },
      { id: "search", label: t.filters, icon: "magnifying-glass", run: () => ({ view: form(kind, query) }) }, manage,
      ...(kind === "plugins" ? [{ id: "contributions", label: t.contributions, icon: "list-bullets",
        run: async () => ({ view: await page("contributions") }) }] : []),
    ];
    const pagination = (result: { offset: number; nextOffset: number | null }) => ({
      page: Math.floor(result.offset / LIMIT) + 1,
      ...(result.offset > 0 ? { onPrevious: async () => ({ view: await page(kind, { ...query, offset: Math.max(0, result.offset - LIMIT) }) }) } : {}),
      ...(result.nextOffset !== null ? { onNext: async () => ({ view: await page(kind, { ...query, offset: result.nextOffset! }) }) } : {}),
    });
    if (kind === "plugins") {
      const result = await ctx.services.plugins.list(request);
      signal.throwIfAborted();
      return liveView(ctx, signal, result, handler => ctx.services.plugins.observe(request, handler), value => ({
        kind: "list", title: `${t.plugins} (${value.total})`, emptyText: t.empty, actions, pagination: pagination(value),
        items: value.plugins.map(entry => ({ id: entry.id, title: entry.name, subtitle: `${entry.id} · ${entry.version}`,
          accessories: entry.activationFailed ? [{ kind: "text", text: t.activationFailed }] : [],
          onSelect: () => ({ view: detail(entry) }) })),
      }));
    }
    const result = await ctx.services.plugins.contributions(request);
    signal.throwIfAborted();
    return liveView(ctx, signal, result, handler => ctx.services.plugins.observeContributions(request, handler), value => ({
      kind: "list", title: `${t.contributions} (${value.total})`, emptyText: t.empty, actions, pagination: pagination(value),
      items: value.contributions.map(entry => ({ id: JSON.stringify([entry.point, entry.pluginId, entry.key]),
        title: entry.key, subtitle: `${entry.pluginId} · ${entry.point}` })),
    }));
  };
  return { page };
}
