import type { PluginContext, PluginDetailView, PluginListView } from "@read-aware/plugin-types";
import { contextWords } from "./context-strings";
import { pageActions, textPage } from "./context-pagination";

type Target = Parameters<NonNullable<PluginContext["domains"]["conversations"]>["queries"]["getInsights"]>[0];

export async function conversationSummaries(ctx: PluginContext, page = 0): Promise<PluginListView> {
  const t = contextWords(ctx.locale), threads = await ctx.domains.conversations!.queries.listThreads();
  const current = Math.min(Math.max(page, 0), Math.max(0, Math.ceil(threads.length / 40) - 1));
  return { kind: "list", title: t.conversations, searchable: true, emptyText: t.noThreads,
    items: threads.slice(current * 40, (current + 1) * 40).map(thread => ({
      id: thread.id, title: thread.title || t.untitled, subtitle: thread.updatedAt, icon: "chat-circle",
      onSelect: async () => ({ view: await conversationSummary(ctx, { kind: "global", id: thread.id }, thread.title || t.untitled) }),
    })), actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await conversationSummaries(ctx, current), navigation: "replace" }) },
    ], pagination: { page: current + 1, pageCount: Math.max(1, Math.ceil(threads.length / 40)),
      ...(current ? { onPrevious: async () => ({ view: await conversationSummaries(ctx, current - 1), navigation: "replace" as const }) } : {}),
      ...((current + 1) * 40 < threads.length ? { onNext: async () => ({ view: await conversationSummaries(ctx, current + 1), navigation: "replace" as const }) } : {}),
    },
  };
}

export async function conversationSummary(ctx: PluginContext, target: Target, title: string): Promise<PluginDetailView> {
  const summary = await ctx.domains.conversations!.queries.getInsights(target);
  const t = contextWords(ctx.locale);
  const render = (offsets: number[]): PluginDetailView => {
    const offset = offsets[offsets.length - 1]!;
    const page = textPage(summary ?? "", offset);
    return { kind: "detail", title: `${title} / ${t.bookSummary}`, content: [
      { kind: "text", text: summary === null ? t.noSummary : summary === "" ? t.emptySummary : page.text },
      { kind: "text", variant: "caption", text: `${summary?.length ? offset + 1 : 0}-${offset + page.text.length} / ${summary?.length ?? 0}` },
    ], actions: [
      { id: "refresh", label: t.refresh, icon: "arrows-clockwise", run: async () => ({ view: await conversationSummary(ctx, target, title), navigation: "replace" }) },
      ...pageActions(ctx.locale, offsets, page.nextOffset, render),
    ] };
  };
  return render([0]);
}
