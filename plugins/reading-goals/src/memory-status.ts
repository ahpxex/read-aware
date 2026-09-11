import type { PluginContext, PluginMemoryCandidateProvider, PluginMemoryCandidateReceipt, PluginView } from "@read-aware/plugin-types";
import { readGoalState } from "./goals";
import { memoryCopy } from "./memory-strings";

type Result = { requestId: string; revision: string | null; order: number;
  outcome?: PluginMemoryCandidateReceipt["results"][number]["outcome"] };

export function registerGoalMemory(ctx: PluginContext) {
  const results = new Map<string, Result>();
  let order = 0;
  const provider: PluginMemoryCandidateProvider = {
    id: "reading-goal", contexts: ["book"],
    async propose({ scope, requestId }) {
      const requested = ++order;
      if (scope.kind !== "book") return [];
      const state = await readGoalState(ctx, scope.bookId);
      if (!state.goal?.suggestMemory) return [];
      if ((results.get(scope.bookId)?.order ?? 0) < requested) {
        results.delete(scope.bookId);
        results.set(scope.bookId, { requestId, revision: state.revision, order: requested });
        if (results.size > 64) results.delete(results.keys().next().value!);
      }
      return [{ scope: "book", kind: "preference", content: state.goal.text }];
    },
    onResult(receipt) {
      const result = [...results.values()].find(value => value.requestId === receipt.requestId);
      if (result && !result.outcome) result.outcome = receipt.results.find(item => item.index === 0)?.outcome;
    },
  };
  const view = async (target?: string): Promise<PluginView> => {
    const t = memoryCopy(ctx.locale), bookId = target ?? (await ctx.domains.reading!.queries.session()).bookId;
    if (!bookId) return { kind: "detail", title: t.title, content: [{ kind: "text", text: t.noBook }] };
    const book = await ctx.domains.library!.queries.books.get(bookId);
    if (!book) return { kind: "detail", title: t.title, content: [{ kind: "error", code: "library/book-not-found" }] };
    const state = await readGoalState(ctx, bookId), result = results.get(bookId);
    const current = state.goal?.suggestMemory && state.revision === result?.revision ? result : undefined;
    const outcome = current?.outcome;
    const status = !current ? t.none : !outcome ? t.pending : t[outcome.status];
    return { kind: "detail", title: t.title, content: [{ kind: "text", text: book.title }, { kind: "text", text: status },
      ...(outcome?.status === "rejected" ? [{ kind: "text" as const, text: t[outcome.reason] }] : []),
      ...(outcome?.status === "failed" ? [{ kind: "error" as const, code: outcome.errorCode }] : []),
    ], actions: [{ id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await view(bookId), navigation: "replace" }) }] };
  };
  const title = memoryCopy(ctx.locale).title;
  ctx.contributions.memoryCandidateProviders!.register(provider);
  ctx.contributions.commands.register({ id: "memory-status", title, icon: "notebook", run: async () => ({ view: await view() }) });
  ctx.contributions.headerActions.register({ id: "memory-status", title, icon: "notebook", surface: "reader", presentation: "popup", view: () => view() });
  return { provider, view };
}
