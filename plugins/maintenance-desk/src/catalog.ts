import type { PluginContext, PluginView, PluginViewResult } from "@read-aware/plugin-types";
import { failureCode } from "./operations";
import { copy } from "./strings";

// Public catalog IDs, not the user's active provider or retained model choices.
const providers = [
  ["openai", "OpenAI"], ["anthropic", "Anthropic"], ["openrouter", "OpenRouter"],
  ["google", "Google Gemini"], ["deepseek", "DeepSeek"], ["xai", "xAI (Grok)"],
  ["groq", "Groq"], ["mistral", "Mistral"], ["moonshotai", "Moonshot (Kimi)"],
  ["zai", "Z.ai Coding Plan"], ["zai-coding-cn", "Zhipu Coding Plan"], ["ollama-cloud", "Ollama Cloud"],
] as const;
type Query = { provider: string; search: string; offset?: number; revision?: number };

export function catalogViews(ctx: PluginContext, signal: AbortSignal) {
  const t = copy(ctx.locale), settings = ctx.domains.settings!;
  const form = (provider = "openai", search = ""): PluginView => ({
    kind: "form", title: t.catalog, submitLabel: t.browse,
    fields: [
      { kind: "select", id: "provider", label: t.provider, value: provider, options: providers.map(([value, label]) => ({ value, label })) },
      { kind: "text", id: "search", label: t.search, value: search },
    ],
    onSubmit: async (values): Promise<PluginViewResult> => {
      if (typeof values.provider !== "string" || !providers.some(([id]) => id === values.provider)) return { fieldErrors: { provider: t.invalidProvider } };
      if (typeof values.search !== "string" || values.search.length > 120) return { fieldErrors: { search: t.invalidSearch } };
      return { view: await page({ provider: values.provider, search: values.search.trim() }) };
    },
  });
  const page = async (query: Query): Promise<PluginView> => {
    const first = { provider: query.provider, search: query.search };
    const reload = async (): Promise<PluginViewResult> => ({ view: await page(first), navigation: "replace" });
    const common = [
      { id: "refresh", label: t.refresh, icon: "cloud-arrow-up", run: async (): Promise<PluginViewResult> => {
        try {
          signal.throwIfAborted();
          await settings.commands.refreshModelCatalog!(query.provider, { signal });
          return await reload();
        } catch (error) {
          return { view: { kind: "detail", title: t.catalog, content: [{ kind: "error", code: failureCode(error) }], actions: common }, navigation: "replace" };
        }
      } },
      { id: "reload", label: t.reload, icon: "arrows-clockwise", run: reload },
      { id: "filters", label: t.filters, icon: "magnifying-glass", run: () => ({ view: form(query.provider, query.search) }) },
    ];
    try {
      signal.throwIfAborted();
      const result = await settings.queries.modelCatalog({ ...query, limit: 25 });
      signal.throwIfAborted();
      if (result.errorCode && !result.models.length) return {
        kind: "detail", title: t.catalog, content: [{ kind: "error", code: result.errorCode }], actions: common,
      };
      return {
        kind: "list", title: `${t.catalog}: ${query.provider}`, emptyText: t.empty,
        items: result.models.map(model => ({ id: model.id, title: model.name, subtitle: model.id,
          onSelect: () => ({ view: { kind: "detail", title: model.name, content: [{ kind: "keyValue", rows: [
            { label: "ID", value: model.id }, { label: t.context, value: String(model.contextWindow) },
            { label: t.output, value: String(model.maxOutputTokens) }, { label: t.input, value: model.input.join(", ") },
            { label: t.reasoning, value: model.reasoning ? t.yes : t.no },
          ] }] } }),
        })),
        pagination: { page: Math.floor(result.offset / 25) + 1, pageCount: Math.max(1, Math.ceil(result.total / 25)),
          ...(result.offset > 0 ? { onPrevious: async () => ({ view: await page({ ...first, offset: Math.max(0, result.offset - 25), revision: result.revision }) }) } : {}),
          ...(result.nextOffset !== null ? { onNext: async () => ({ view: await page({ ...first, offset: result.nextOffset!, revision: result.revision }) }) } : {}),
        },
        actions: [
          { id: "status", label: t.metadata, icon: "clock", run: () => ({ view: { kind: "detail", title: t.metadata, content: [
            ...(result.errorCode ? [{ kind: "error" as const, code: result.errorCode }] : []),
            { kind: "keyValue", rows: [
              { label: t.checked, value: result.checkedAt === null ? t.never : new Date(result.checkedAt).toISOString() },
              { label: t.refreshing, value: result.refreshing ? t.yes : t.no }, { label: t.matches, value: String(result.total) },
            ] },
          ] } }) },
          ...(result.errorCode ? [{ id: "catalog-error", label: t.failed, icon: "file-text", run: () => ({ view: {
            kind: "detail" as const, title: t.catalog, content: [{ kind: "error" as const, code: result.errorCode! }], actions: common,
          } }) }] : []),
          ...common,
        ],
      };
    } catch (error) {
      return { kind: "detail", title: t.catalog, content: [{ kind: "error", code: failureCode(error) }], actions: common };
    }
  };
  return { form };
}
